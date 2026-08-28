import { cleanFacebookPostText } from './core.mjs';
import { hashText, parseFacebookPostIdentity } from './corpus.mjs';

// v5 keeps the clean-permalink proof as the strongest signal, but no longer
// blocks for a self-permalink anchor that Facebook may omit. When the final URL
// already proves the exact post/group, one unique non-comment article with an
// explicit root Comment action may prove the root instead. Ambiguity still
// fails closed. Historical v4 evidence remains reusable.
export const ROOT_BODY_ACCEPTANCE_VERSION = 'v0.9-strict-root-body-v5';
export const DEEP_COLLECTION_ACCEPTANCE_VERSION = 'v0.8-strict-deep-collection-v2';
const SUPPORTED_ROOT_BODY_ACCEPTANCE_VERSIONS = new Set([
  'v0.8-strict-root-body-v4',
  ROOT_BODY_ACCEPTANCE_VERSION,
]);

function normalizeWhitespace(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizedPostId(value) {
  return value == null ? null : String(value);
}

function normalizedGroupIdentifier(value) {
  return value == null ? null : String(value).trim().toLowerCase();
}

function normalizedGroupIdentifiers(value) {
  const values = value == null ? [] : (Array.isArray(value) ? value : [value]);
  return new Set(values.map(normalizedGroupIdentifier).filter(Boolean));
}

function isSupportedRootBodyAcceptanceVersion(value) {
  return SUPPORTED_ROOT_BODY_ACCEPTANCE_VERSIONS.has(String(value ?? ''));
}

export function classifyPostHref(href, targetPostId, targetGroupIdentifiers = null) {
  if (!href) return null;
  const identity = parseFacebookPostIdentity(href);
  if (!identity?.postId || identity.postId !== normalizedPostId(targetPostId)) return null;
  const expectedGroups = normalizedGroupIdentifiers(targetGroupIdentifiers);
  const actualGroup = normalizedGroupIdentifier(identity.groupIdentifier);
  if (expectedGroups.size > 0 && !expectedGroups.has(actualGroup)) return null;
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

export function selectStrictRootArticle(snapshots, targetPostId, targetGroupIdentifiers = null) {
  const target = normalizedPostId(targetPostId);
  const expectedGroups = normalizedGroupIdentifiers(targetGroupIdentifiers);
  const diagnostics = [];
  const eligible = [];

  for (let index = 0; index < (snapshots ?? []).length; index += 1) {
    const snapshot = snapshots[index] ?? {};
    const allTargetPostEvidence = (snapshot.links ?? [])
      .map((link) => classifyPostHref(link?.href, target))
      .filter(Boolean);
    const evidence = expectedGroups.size > 0
      ? allTargetPostEvidence.filter((item) => expectedGroups.has(normalizedGroupIdentifier(item.identity.groupIdentifier)))
      : allTargetPostEvidence;
    const cleanEvidence = evidence.filter((item) => item.clean);
    const highlightedEvidence = evidence.filter((item) => !item.clean);
    const foreignGroupEvidence = expectedGroups.size > 0
      ? allTargetPostEvidence.filter((item) => !expectedGroups.has(normalizedGroupIdentifier(item.identity.groupIdentifier)))
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

  if (eligible.length === 0) {
    return {
      ok: false,
      reason: expectedGroups.size > 0 ? 'no-clean-target-post-permalink-for-group' : 'no-clean-target-post-permalink',
      diagnostics,
      eligibleCount: 0,
    };
  }

  if (eligible.length !== 1) {
    return {
      ok: false,
      reason: 'ambiguous-root-post-articles',
      diagnostics,
      eligibleCount: eligible.length,
      eligibleIndexes: eligible.map((item) => item.index),
    };
  }

  return {
    ok: true,
    reason: 'clean-target-post-permalink',
    diagnostics,
    eligibleCount: 1,
    selection: eligible[0],
    evidenceMode: 'clean-target-post-permalink',
  };
}

function rootActionSignals(snapshot = {}) {
  const actions = (snapshot.actionTexts ?? []).map(normalizeWhitespace).filter(Boolean);
  const hasComment = actions.some((text) => /^(?:comment|bình luận)$/i.test(text));
  const hasShare = actions.some((text) => /^(?:share|chia sẻ)$/i.test(text));
  const hasLike = actions.some((text) => /^(?:like|thích)$/i.test(text));
  return { actions, hasComment, hasShare, hasLike };
}

/**
 * Fallback admission is allowed only after the browser URL itself has proven
 * the exact target post/group. It never chooses the longest/first article.
 * The fallback requires exactly one visible non-comment article with a root
 * Comment action and no target comment/reply-highlight evidence.
 */
export function selectUrlAnchoredRootArticle(
  snapshots,
  targetPostId,
  targetGroupIdentifiers,
  finalIdentity,
) {
  const strict = selectStrictRootArticle(snapshots, targetPostId, targetGroupIdentifiers);
  if (strict.ok) return strict;

  const expectedGroups = normalizedGroupIdentifiers(targetGroupIdentifiers);
  const finalPostId = normalizedPostId(finalIdentity?.postId);
  const finalGroup = normalizedGroupIdentifier(finalIdentity?.groupIdentifier);
  if (
    finalPostId !== normalizedPostId(targetPostId)
    || !finalGroup
    || (expectedGroups.size > 0 && !expectedGroups.has(finalGroup))
  ) {
    return {
      ...strict,
      fallbackReason: 'final-url-identity-not-proven',
      fallbackEligibleCount: 0,
    };
  }

  const fallback = [];
  const fallbackDiagnostics = [];
  for (let index = 0; index < (snapshots ?? []).length; index += 1) {
    const snapshot = snapshots[index] ?? {};
    const aria = normalizeWhitespace(snapshot.ariaLabel ?? '');
    const looksLikeComment = /\b(comment|reply|bình luận|phản hồi)\b/i.test(aria);
    const targetEvidence = (snapshot.links ?? [])
      .map((link) => classifyPostHref(link?.href, targetPostId, targetGroupIdentifiers))
      .filter(Boolean);
    const highlightedEvidence = targetEvidence.filter((item) => !item.clean);
    const actions = rootActionSignals(snapshot);
    const eligible = !looksLikeComment && highlightedEvidence.length === 0 && actions.hasComment;
    fallbackDiagnostics.push({
      index,
      looksLikeComment,
      highlightedLinks: highlightedEvidence.length,
      hasCommentAction: actions.hasComment,
      hasShareAction: actions.hasShare,
      hasLikeAction: actions.hasLike,
      actionTexts: actions.actions.slice(0, 20),
      eligible,
    });
    if (!eligible) continue;
    fallback.push({
      index,
      score: 100 + (actions.hasShare ? 10 : 0) + (actions.hasLike ? 5 : 0),
      text: normalizeWhitespace(snapshot.text ?? ''),
      cleanHref: null,
      identity: {
        ...finalIdentity,
        postId: String(finalIdentity.postId),
        groupIdentifier: finalIdentity.groupIdentifier,
        key: `facebook:${finalIdentity.groupIdentifier}:${finalIdentity.postId}`,
        canonicalUrl: `https://www.facebook.com/groups/${finalIdentity.groupIdentifier}/permalink/${finalIdentity.postId}/`,
      },
      distinctKeys: [`facebook:${finalIdentity.groupIdentifier}:${finalIdentity.postId}`],
      cleanLinks: 0,
      highlightedLinks: 0,
    });
  }

  if (fallback.length !== 1) {
    return {
      ok: false,
      reason: fallback.length === 0 ? 'no-url-anchored-root-article' : 'ambiguous-url-anchored-root-articles',
      diagnostics: strict.diagnostics,
      fallbackDiagnostics,
      eligibleCount: strict.eligibleCount ?? 0,
      fallbackEligibleCount: fallback.length,
      fallbackEligibleIndexes: fallback.map((item) => item.index),
    };
  }

  return {
    ok: true,
    reason: 'final-url-plus-unique-root-actions',
    diagnostics: strict.diagnostics,
    fallbackDiagnostics,
    eligibleCount: 1,
    selection: fallback[0],
    evidenceMode: 'final-url-plus-unique-root-actions',
  };
}

export function isStrictBodyValidation(validation, expectedPostId = null, expectedGroupIdentifier = null) {
  if (!validation || !isSupportedRootBodyAcceptanceVersion(validation.acceptanceVersion)) return false;
  if (validation.rootIdentityVerified !== true) return false;
  const targetPostId = normalizedPostId(validation.targetPostId);
  const rootPostId = normalizedPostId(validation.rootPostId);
  const finalPostId = normalizedPostId(validation.finalPostId);
  if (expectedPostId != null && targetPostId !== normalizedPostId(expectedPostId)) return false;
  if (!targetPostId || rootPostId !== targetPostId || finalPostId !== targetPostId) return false;

  const expectedGroup = normalizedGroupIdentifier(expectedGroupIdentifier);
  const targetGroup = normalizedGroupIdentifier(validation.targetGroupIdentifier);
  const rootGroup = normalizedGroupIdentifier(validation.rootGroupIdentifier);
  const finalGroup = normalizedGroupIdentifier(validation.finalGroupIdentifier);
  const allowedGroups = normalizedGroupIdentifiers(validation.allowedGroupIdentifiers);
  if (!targetGroup || !rootGroup || !finalGroup) return false;
  if (expectedGroup && targetGroup !== expectedGroup) return false;
  if (rootGroup !== targetGroup) return false;
  if (allowedGroups.size === 0) {
    if (finalGroup !== targetGroup) return false;
  } else if (!allowedGroups.has(targetGroup) || !allowedGroups.has(finalGroup)) {
    return false;
  }

  // Production v5 captures always stamp this field. Treat its absence as a
  // compatibility case for pre-existing offline fixtures, but reject an
  // explicitly unknown evidence mode.
  if (
    validation.acceptanceVersion === ROOT_BODY_ACCEPTANCE_VERSION
    && validation.rootIdentityEvidence != null
    && !['clean-target-post-permalink', 'final-url-plus-unique-root-actions'].includes(validation.rootIdentityEvidence)
  ) return false;
  return true;
}

async function snapshotVisibleArticles(page, { includeText = true } = {}) {
  return page.locator('[role="article"]:visible').evaluateAll((articles, options) => articles.map((article) => ({
    text: options.includeText ? (article.innerText || article.textContent || '').replace(/\s+/g, ' ').trim() : '',
    ariaLabel: article.getAttribute('aria-label') || '',
    links: [...article.querySelectorAll('a[href]')].map((a) => ({ href: a.href })),
    actionTexts: [...article.querySelectorAll('button, [role="button"]')].map((el) => {
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      const aria = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      return text || aria;
    }).filter(Boolean),
  })), { includeText });
}

function strictRootSelectionError(message, selected, code = 'STRICT_ROOT_SURFACE_UNAVAILABLE') {
  const error = new Error(message);
  error.code = code;
  error.selection = selected ?? null;
  return error;
}

async function waitForVerifiedRootSelection(page, {
  targetPostId,
  allowedGroupIdentifiers,
  finalIdentity,
  includeText,
  timeoutMs = 2_500,
  pollMs = 125,
  errorCode = 'ROOT_BODY_SELECTION_FAILED',
} = {}) {
  const startedAt = Date.now();
  const timeout = Math.max(250, Number(timeoutMs ?? 2_500));
  const interval = Math.max(50, Number(pollMs ?? 125));
  let last = null;
  let attempts = 0;
  do {
    attempts += 1;
    const snapshots = await snapshotVisibleArticles(page, { includeText });
    last = selectUrlAnchoredRootArticle(snapshots, targetPostId, allowedGroupIdentifiers, finalIdentity);
    if (last.ok) {
      return {
        ...last,
        readyAttempts: attempts,
        readyElapsedMs: Date.now() - startedAt,
      };
    }
    if (Date.now() - startedAt >= timeout) break;
    await page.waitForTimeout(interval);
  } while (true);

  throw strictRootSelectionError(
    `Verified root did not become uniquely resolvable for ${targetPostId} within ${timeout}ms: ${last?.reason ?? 'unknown'}`,
    last,
    errorCode,
  );
}

function assertFinalPageIdentity(page, targetPostId, allowedGroups, phase = 'root body') {
  const finalPageUrl = page.url();
  const finalIdentity = parseFacebookPostIdentity(finalPageUrl);
  if (!finalIdentity?.postId || !finalIdentity?.groupIdentifier) {
    const error = new Error(`Final page identity is not verifiable during ${phase} for post ${targetPostId}`);
    error.code = phase === 'collection' ? 'COLLECTION_FINAL_IDENTITY_UNVERIFIABLE' : 'ROOT_BODY_FINAL_IDENTITY_UNVERIFIABLE';
    throw error;
  }
  if (finalIdentity.postId !== targetPostId || !allowedGroups.has(normalizedGroupIdentifier(finalIdentity.groupIdentifier))) {
    const error = new Error(`Final page identity changed from the allowed source during ${phase} for post ${targetPostId}`);
    error.code = phase === 'collection' ? 'COLLECTION_FINAL_IDENTITY_MISMATCH' : 'ROOT_BODY_FINAL_IDENTITY_MISMATCH';
    throw error;
  }
  return { finalPageUrl, finalIdentity };
}

function currentAllowedPageIdentity(page, targetPostId, allowedGroups) {
  const identity = parseFacebookPostIdentity(page.url());
  if (!identity?.postId || !identity?.groupIdentifier) return null;
  if (identity.postId !== String(targetPostId)) return null;
  if (!allowedGroups.has(normalizedGroupIdentifier(identity.groupIdentifier))) return null;
  return identity;
}

/**
 * Re-resolve the verified root and derive its containing collection surface.
 * Clean-link evidence works even in offline DOM fixtures. The URL-anchored
 * fallback is enabled only when the current page URL independently proves the
 * same post/group.
 */
export async function resolveStrictRootSurface(page, validation) {
  if (!isStrictBodyValidation(validation)) {
    throw strictRootSelectionError('Cannot resolve a surface from invalid strict root validation');
  }

  const targetPostId = String(validation.targetPostId);
  const allowedGroups = normalizedGroupIdentifiers([
    validation.rootGroupIdentifier,
    ...(validation.allowedGroupIdentifiers ?? []),
  ]);
  const finalIdentity = currentAllowedPageIdentity(page, targetPostId, allowedGroups);
  const selected = await waitForVerifiedRootSelection(page, {
    targetPostId,
    allowedGroupIdentifiers: [...allowedGroups],
    finalIdentity,
    includeText: false,
    timeoutMs: 2_500,
    errorCode: 'STRICT_ROOT_SURFACE_UNAVAILABLE',
  });

  const articles = page.locator('[role="article"]:visible');
  if (selected.selection.index >= await articles.count()) {
    throw strictRootSelectionError(`Resolved strict root disappeared for ${targetPostId}`, selected);
  }
  const root = articles.nth(selected.selection.index);
  await root.waitFor({ state: 'visible', timeout: 5_000 });

  const surface = root.locator('xpath=ancestor-or-self::*[self::main or @role="dialog" or @aria-modal="true" or @role="main"][1]');
  if (await surface.count() !== 1 || !(await surface.isVisible().catch(() => false))) {
    throw strictRootSelectionError(`Verified root has no visible collection surface for ${targetPostId}`, selected);
  }
  const surfaceType = await surface.evaluate((node) => {
    if (node.getAttribute('role') === 'dialog' || node.getAttribute('aria-modal') === 'true') return 'dialog';
    if (node.getAttribute('role') === 'main' || node.tagName.toLowerCase() === 'main') return 'main';
    return 'unknown';
  });

  return {
    root,
    surface,
    surfaceType,
    identity: selected.selection.identity,
    identityEvidence: selected.evidenceMode,
    selectionDiagnostics: selected.diagnostics,
    rootReadyElapsedMs: selected.readyElapsedMs,
  };
}

async function expandRootSeeMore(root) {
  let clicked = 0;
  for (let round = 0; round < 12; round += 1) {
    const controls = root.locator('button, [role="button"]').filter({ hasText: /^(?:\s*xem thêm\s*|\s*see more\s*)$/i });
    const count = await controls.count();
    if (count === 0) break;
    const control = controls.first();
    if (!(await control.isVisible().catch(() => false))) break;
    await control.click({ timeout: 4_000 });
    clicked += 1;
    await root.page().waitForTimeout(150);
  }
  return clicked;
}

export function reviewedBodyForCollection(candidate) {
  const strictBody = candidate?.strictBody;
  if (!strictBody) return null;
  const body = String(strictBody.body ?? '');
  if (!body.trim()) {
    const error = new Error(`Candidate ${candidate?.postId ?? 'unknown'} is missing its reviewed root body`);
    error.code = 'REVIEWED_BODY_MISSING';
    throw error;
  }
  if (!isSupportedRootBodyAcceptanceVersion(strictBody.bodyAcceptanceVersion)) {
    const error = new Error(`Candidate ${candidate?.postId ?? 'unknown'} has a stale reviewed-body acceptance version`);
    error.code = 'REVIEWED_BODY_VERSION_MISMATCH';
    throw error;
  }
  if (!strictBody.bodyContentHash || hashText(body) !== strictBody.bodyContentHash) {
    const error = new Error(`Candidate ${candidate?.postId ?? 'unknown'} reviewed body hash does not match its carried body`);
    error.code = 'REVIEWED_BODY_HASH_MISMATCH';
    throw error;
  }
  const expectedPostId = candidate?.postId ?? strictBody.validation?.targetPostId ?? null;
  const expectedGroup = candidate?.groupIdentifier ?? candidate?.groupId ?? strictBody.validation?.targetGroupIdentifier ?? null;
  if (!isStrictBodyValidation(strictBody.validation, expectedPostId, expectedGroup)) {
    const error = new Error(`Candidate ${candidate?.postId ?? 'unknown'} reviewed body validation is no longer trusted`);
    error.code = 'REVIEWED_BODY_VALIDATION_MISMATCH';
    throw error;
  }
  return {
    body,
    bodyContentHash: strictBody.bodyContentHash,
    capturedAt: strictBody.capturedAt ?? strictBody.validation?.capturedAt ?? null,
    validation: structuredClone(strictBody.validation),
  };
}

/**
 * Review phase captures the body once. Collection phase reopens the post only
 * to prove identity/surface and reuses that reviewed body.
 */
export async function captureStrictRootBody(page, candidate, {
  attempt = 1,
  allowedGroupIdentifiers = [],
  rootReadyTimeoutMs = 2_500,
} = {}) {
  const targetUrl = candidate?.canonicalUrl ?? candidate?.discoveredUrls?.[0];
  const targetIdentity = parseFacebookPostIdentity(targetUrl);
  const targetPostId = String(candidate?.postId ?? targetIdentity?.postId ?? '');
  if (!targetUrl) throw new Error(`Post ${candidate?.postId ?? 'unknown'} has no target URL`);
  if (!/^\d+$/.test(targetPostId)) throw new Error(`Invalid Facebook post id: ${candidate?.postId}`);

  const allowedGroups = normalizedGroupIdentifiers([
    candidate?.groupId,
    candidate?.groupIdentifier,
    targetIdentity?.groupIdentifier,
    ...allowedGroupIdentifiers,
  ]);
  if (allowedGroups.size === 0) throw new Error(`Post ${targetPostId} has no source group identity`);

  const reviewedBody = reviewedBodyForCollection(candidate);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const { finalPageUrl, finalIdentity } = assertFinalPageIdentity(
    page,
    targetPostId,
    allowedGroups,
    reviewedBody ? 'collection' : 'root body',
  );

  const selected = await waitForVerifiedRootSelection(page, {
    targetPostId,
    allowedGroupIdentifiers: [...allowedGroups],
    finalIdentity,
    includeText: !reviewedBody,
    timeoutMs: rootReadyTimeoutMs,
    errorCode: reviewedBody ? 'COLLECTION_ROOT_IDENTITY_FAILED' : 'ROOT_BODY_SELECTION_FAILED',
  });

  const articles = page.locator('[role="article"]:visible');
  if (selected.selection.index >= await articles.count()) {
    const error = new Error(`Strict root article disappeared for post ${targetPostId}`);
    error.code = reviewedBody ? 'COLLECTION_ROOT_DISAPPEARED' : 'ROOT_BODY_DISAPPEARED';
    error.selection = selected;
    throw error;
  }
  const root = articles.nth(selected.selection.index);
  await root.waitFor({ state: 'visible', timeout: 5_000 });
  const rootIdentity = selected.selection.identity;

  if (reviewedBody) {
    const validation = {
      ...reviewedBody.validation,
      collectionBodyPolicy: 'single-review-capture',
      bodyRevalidation: 'not-performed-single-capture-policy',
      fullBodyCaptures: 1,
      collectionIdentityVerifiedAt: new Date().toISOString(),
      collectionFinalPageUrl: finalPageUrl,
      collectionRootIdentityEvidence: selected.evidenceMode,
      collectionRootCleanHref: selected.selection.cleanHref,
      collectionEligibleRootArticles: selected.eligibleCount,
      collectionRootReadyElapsedMs: selected.readyElapsedMs,
    };
    return {
      body: reviewedBody.body,
      root,
      finalPageUrl,
      identity: rootIdentity,
      capturedAt: reviewedBody.capturedAt,
      validation,
      selectionDiagnostics: selected.diagnostics,
      bodyRevalidation: 'not-performed-single-capture-policy',
      fullBodyCaptures: 1,
    };
  }

  const clickedSeeMore = await expandRootSeeMore(root);
  const body = cleanFacebookPostText(await root.innerText(), '');
  if (!body.trim()) {
    const error = new Error(`Strict root article for ${targetPostId} produced an empty body`);
    error.code = 'ROOT_BODY_EMPTY';
    throw error;
  }

  const validation = {
    acceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
    rootIdentityVerified: true,
    rootIdentityEvidence: selected.evidenceMode,
    targetPostId,
    targetGroupIdentifier: rootIdentity.groupIdentifier,
    rootPostId: rootIdentity.postId,
    rootGroupIdentifier: rootIdentity.groupIdentifier,
    finalPostId: finalIdentity.postId,
    finalGroupIdentifier: finalIdentity.groupIdentifier,
    allowedGroupIdentifiers: [...allowedGroups].sort(),
    rootCleanHref: selected.selection.cleanHref,
    eligibleRootArticles: selected.eligibleCount,
    clickedSeeMore,
    attempt,
    bodyChars: body.length,
    rootReadyElapsedMs: selected.readyElapsedMs,
    rootReadyAttempts: selected.readyAttempts,
    capturedAt: new Date().toISOString(),
  };
  if (!isStrictBodyValidation(validation, targetPostId, rootIdentity.groupIdentifier)) {
    throw new Error(`Strict root validation could not be stamped for post ${targetPostId}`);
  }

  return {
    body,
    root,
    finalPageUrl,
    identity: rootIdentity,
    capturedAt: validation.capturedAt,
    validation,
    selectionDiagnostics: selected.diagnostics,
    fullBodyCaptures: 1,
  };
}

export function strictCompleteRecordTrust(normalizedRecord, expectedPostId = null, expectedGroupIdentifier = null) {
  const extraction = normalizedRecord?.extraction;
  if (extraction?.acceptanceVersion !== DEEP_COLLECTION_ACCEPTANCE_VERSION) {
    return { trusted: false, reason: 'unsupported-deep-collection-acceptance-version' };
  }
  if (!isSupportedRootBodyAcceptanceVersion(extraction.bodyAcceptanceVersion)) {
    return { trusted: false, reason: 'unsupported-root-body-acceptance-version' };
  }
  if (!String(normalizedRecord?.post?.text ?? '').trim()) return { trusted: false, reason: 'missing-verified-root-body' };
  const source = normalizedRecord?.source ?? {};
  const postId = expectedPostId ?? source.postId;
  const groupIdentifier = expectedGroupIdentifier ?? source.groupIdentifier ?? source.groupId;
  if (!isStrictBodyValidation(extraction.rootValidation, postId, groupIdentifier)) {
    return { trusted: false, reason: 'invalid-root-validation' };
  }
  return { trusted: true, reason: DEEP_COLLECTION_ACCEPTANCE_VERSION };
}

export function bodyTrust(record, acceptedCompleteVersions = []) {
  if (!record) return { trusted: false, reason: 'missing-record' };
  const postId = record?.source?.postId ?? null;
  const groupIdentifier = record?.source?.groupIdentifier ?? null;
  if (
    record.status === 'complete'
    && record.cacheFile
    && record.acceptanceVersion === DEEP_COLLECTION_ACCEPTANCE_VERSION
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
    && isSupportedRootBodyAcceptanceVersion(record.body?.acceptanceVersion)
    && isStrictBodyValidation(record.body?.validation, postId, groupIdentifier)
  ) {
    return {
      trusted: true,
      kind: 'strict-preflight',
      reason: record.body.acceptanceVersion,
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
  record.body.acceptanceVersion = validation.acceptanceVersion ?? ROOT_BODY_ACCEPTANCE_VERSION;
  record.body.validation = structuredClone(validation);
  return record;
}
