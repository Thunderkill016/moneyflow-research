import { parseFacebookPostIdentity } from './corpus.mjs';

export const ROOT_BODY_ACCEPTANCE_VERSION = 'v0.7-strict-root-body-v2';

function normalizeWhitespace(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizedPostId(value) {
  return value == null ? null : String(value);
}

function normalizedGroupIdentifier(value) {
  return value == null ? null : String(value).trim().toLowerCase();
}

export function classifyPostHref(href, targetPostId, targetGroupIdentifier = null) {
  if (!href) return null;
  const identity = parseFacebookPostIdentity(href);
  if (!identity?.postId || identity.postId !== normalizedPostId(targetPostId)) return null;
  const expectedGroup = normalizedGroupIdentifier(targetGroupIdentifier);
  const actualGroup = normalizedGroupIdentifier(identity.groupIdentifier);
  if (expectedGroup && actualGroup !== expectedGroup) return null;
  let highlightKind = 'clean-post-link';
  try {
    const url = new URL(href, 'https://www.facebook.com');
    if (url.searchParams.has('reply_comment_id')) highlightKind = 'reply-comment-highlight';
    else if (url.searchParams.has('comment_id')) highlightKind = 'comment-highlight';
  } catch {
    return null;
  }
  return {
    href,
    identity,
    highlightKind,
    clean: highlightKind === 'clean-post-link',
  };
}

export function selectStrictRootArticle(snapshots, targetPostId, targetGroupIdentifier = null) {
  const target = normalizedPostId(targetPostId);
  const expectedGroup = normalizedGroupIdentifier(targetGroupIdentifier);
  const diagnostics = [];
  const eligible = [];

  for (let index = 0; index < (snapshots ?? []).length; index += 1) {
    const snapshot = snapshots[index] ?? {};
    const allTargetPostEvidence = (snapshot.links ?? [])
      .map((link) => classifyPostHref(link?.href, target))
      .filter(Boolean);
    const evidence = expectedGroup
      ? allTargetPostEvidence.filter((item) => normalizedGroupIdentifier(item.identity.groupIdentifier) === expectedGroup)
      : allTargetPostEvidence;
    const cleanEvidence = evidence.filter((item) => item.clean);
    const highlightedEvidence = evidence.filter((item) => !item.clean);
    const foreignGroupEvidence = expectedGroup
      ? allTargetPostEvidence.filter((item) => normalizedGroupIdentifier(item.identity.groupIdentifier) !== expectedGroup)
      : [];
    const aria = normalizeWhitespace(snapshot.ariaLabel ?? '');
    const text = normalizeWhitespace(snapshot.text ?? '');
    const looksLikeComment = /\b(comment|reply|bình luận|phản hồi)\b/i.test(aria);
    const row = {
      index,
      cleanLinks: cleanEvidence.length,
      highlightedLinks: highlightedEvidence.length,
      foreignGroupLinks: foreignGroupEvidence.length,
      looksLikeComment,
      textChars: text.length,
      cleanHrefs: cleanEvidence.map((item) => item.href),
      cleanIdentities: cleanEvidence.map((item) => item.identity.key),
      foreignGroupIdentities: foreignGroupEvidence.map((item) => item.identity.key),
    };
    diagnostics.push(row);

    // A clean permalink for the exact target post AND source group is the hard
    // admission contract. Highlighted comment links contain the parent post id
    // and are therefore not sufficient evidence that an article is the root.
    if (cleanEvidence.length === 0 || looksLikeComment) continue;
    const distinctKeys = [...new Set(cleanEvidence.map((item) => item.identity.key))];
    if (distinctKeys.length !== 1) continue;
    const score = (cleanEvidence.length * 1000) + Math.min(text.length, 6000) - (highlightedEvidence.length * 10);
    eligible.push({
      index,
      score,
      text,
      cleanHref: cleanEvidence[0].href,
      identity: cleanEvidence[0].identity,
      distinctKeys,
      cleanLinks: cleanEvidence.length,
      highlightedLinks: highlightedEvidence.length,
    });
  }

  eligible.sort((a, b) => b.score - a.score || a.index - b.index);
  if (eligible.length === 0) {
    return {
      ok: false,
      reason: expectedGroup ? 'no-clean-target-post-permalink-for-group' : 'no-clean-target-post-permalink',
      diagnostics,
      eligibleCount: 0,
    };
  }

  const best = eligible[0];
  const tied = eligible.filter((item) => item.score === best.score);
  if (tied.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous-root-post-articles',
      diagnostics,
      eligibleCount: eligible.length,
      tiedIndexes: tied.map((item) => item.index),
    };
  }

  return {
    ok: true,
    reason: 'clean-target-post-permalink',
    diagnostics,
    eligibleCount: eligible.length,
    selection: best,
  };
}

export function isStrictBodyValidation(validation, expectedPostId = null, expectedGroupIdentifier = null) {
  if (!validation || validation.acceptanceVersion !== ROOT_BODY_ACCEPTANCE_VERSION) return false;
  if (validation.rootIdentityVerified !== true) return false;
  const targetPostId = normalizedPostId(validation.targetPostId);
  const rootPostId = normalizedPostId(validation.rootPostId);
  const finalPostId = normalizedPostId(validation.finalPostId);
  if (expectedPostId != null && targetPostId !== normalizedPostId(expectedPostId)) return false;
  if (rootPostId !== targetPostId) return false;
  if (finalPostId && finalPostId !== targetPostId) return false;

  const expectedGroup = normalizedGroupIdentifier(expectedGroupIdentifier);
  const targetGroup = normalizedGroupIdentifier(validation.targetGroupIdentifier);
  const rootGroup = normalizedGroupIdentifier(validation.rootGroupIdentifier);
  const finalGroup = normalizedGroupIdentifier(validation.finalGroupIdentifier);
  if (expectedGroup && targetGroup !== expectedGroup) return false;
  if (targetGroup && rootGroup !== targetGroup) return false;
  if (targetGroup && finalGroup && finalGroup !== targetGroup) return false;
  return true;
}

export function bodyTrust(record, acceptedCompleteVersions = []) {
  if (!record) return { trusted: false, reason: 'missing-record' };
  const postId = record?.source?.postId ?? null;
  const groupIdentifier = record?.source?.groupIdentifier ?? null;
  if (
    record.status === 'complete'
    && record.cacheFile
    && (acceptedCompleteVersions.length === 0 || acceptedCompleteVersions.includes(record.acceptanceVersion))
  ) {
    return {
      trusted: true,
      kind: 'complete-record',
      reason: `accepted-complete:${record.acceptanceVersion ?? 'unspecified'}`,
    };
  }
  if (
    record.body?.text
    && record.body?.acceptanceVersion === ROOT_BODY_ACCEPTANCE_VERSION
    && isStrictBodyValidation(record.body?.validation, postId, groupIdentifier)
  ) {
    return {
      trusted: true,
      kind: 'strict-preflight',
      reason: ROOT_BODY_ACCEPTANCE_VERSION,
    };
  }
  if (record.body?.text) return { trusted: false, reason: 'legacy-or-unvalidated-body-cache' };
  return { trusted: false, reason: 'missing-body-cache' };
}

export function classificationTrust(record, classification, acceptedCompleteVersions = []) {
  if (!classification) return { trusted: false, reason: 'missing-classification' };
  const bodyState = bodyTrust(record, acceptedCompleteVersions);
  if (!bodyState.trusted) return { trusted: false, reason: `body-untrusted:${bodyState.reason}` };
  if (bodyState.kind === 'complete-record') {
    // Historical strict-complete records already passed the deep collector's root
    // and comment acceptance gates. Preserve their prior topic judgments.
    return { trusted: true, reason: bodyState.reason };
  }
  if (!classification.bodyContentHash || classification.bodyContentHash !== record.body?.contentHash) {
    return { trusted: false, reason: 'classification-body-hash-mismatch' };
  }
  if (classification.bodyAcceptanceVersion !== record.body?.acceptanceVersion) {
    return { trusted: false, reason: 'classification-body-version-mismatch' };
  }
  return { trusted: true, reason: 'classification-bound-to-strict-body' };
}

export function stampStrictBody(record, validation) {
  if (!record?.body) throw new Error('Cannot stamp strict body validation without record.body');
  if (!isStrictBodyValidation(validation, record?.source?.postId, record?.source?.groupIdentifier)) {
    throw new Error('Invalid strict body validation stamp');
  }
  record.body.acceptanceVersion = ROOT_BODY_ACCEPTANCE_VERSION;
  record.body.validation = structuredClone(validation);
  return record;
}
