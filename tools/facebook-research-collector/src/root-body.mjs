import { parseFacebookPostIdentity } from './corpus.mjs';

export const ROOT_BODY_ACCEPTANCE_VERSION = 'v0.7-strict-root-body-v1';

function normalizeWhitespace(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizedPostId(value) {
  return value == null ? null : String(value);
}

export function classifyPostHref(href, targetPostId) {
  if (!href) return null;
  const identity = parseFacebookPostIdentity(href);
  if (!identity?.postId || identity.postId !== normalizedPostId(targetPostId)) return null;
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

export function selectStrictRootArticle(snapshots, targetPostId) {
  const target = normalizedPostId(targetPostId);
  const diagnostics = [];
  const eligible = [];

  for (let index = 0; index < (snapshots ?? []).length; index += 1) {
    const snapshot = snapshots[index] ?? {};
    const evidence = (snapshot.links ?? [])
      .map((link) => classifyPostHref(link?.href, target))
      .filter(Boolean);
    const cleanEvidence = evidence.filter((item) => item.clean);
    const highlightedEvidence = evidence.filter((item) => !item.clean);
    const aria = normalizeWhitespace(snapshot.ariaLabel ?? '');
    const text = normalizeWhitespace(snapshot.text ?? '');
    const looksLikeComment = /\b(comment|reply|bình luận|phản hồi)\b/i.test(aria);
    const row = {
      index,
      cleanLinks: cleanEvidence.length,
      highlightedLinks: highlightedEvidence.length,
      looksLikeComment,
      textChars: text.length,
      cleanHrefs: cleanEvidence.map((item) => item.href),
      cleanIdentities: cleanEvidence.map((item) => item.identity.key),
    };
    diagnostics.push(row);

    // A clean permalink for the exact target post is the hard admission contract.
    // Highlighted comment links contain the parent post id and are therefore not
    // sufficient evidence that an article is the root post.
    if (cleanEvidence.length === 0 || looksLikeComment) continue;
    const distinctKeys = [...new Set(cleanEvidence.map((item) => item.identity.key))];
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
      reason: 'no-clean-target-post-permalink',
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

export function isStrictBodyValidation(validation, expectedPostId = null) {
  if (!validation || validation.acceptanceVersion !== ROOT_BODY_ACCEPTANCE_VERSION) return false;
  if (validation.rootIdentityVerified !== true) return false;
  if (expectedPostId != null && normalizedPostId(validation.targetPostId) !== normalizedPostId(expectedPostId)) return false;
  if (normalizedPostId(validation.rootPostId) !== normalizedPostId(validation.targetPostId)) return false;
  if (validation.finalPostId && normalizedPostId(validation.finalPostId) !== normalizedPostId(validation.targetPostId)) return false;
  return true;
}

export function bodyTrust(record, acceptedCompleteVersions = []) {
  if (!record) return { trusted: false, reason: 'missing-record' };
  const postId = record?.source?.postId ?? null;
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
    && isStrictBodyValidation(record.body?.validation, postId)
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
  if (!isStrictBodyValidation(validation, record?.source?.postId)) {
    throw new Error('Invalid strict body validation stamp');
  }
  record.body.acceptanceVersion = ROOT_BODY_ACCEPTANCE_VERSION;
  record.body.validation = structuredClone(validation);
  return record;
}
