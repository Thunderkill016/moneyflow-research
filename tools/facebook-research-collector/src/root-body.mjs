import { cleanFacebookPostText } from './core.mjs';
import { hashText, parseFacebookPostIdentity } from './corpus.mjs';

// v4 requires a unique root article and binds all deep-comment UI work to the
// root-derived surface. Deep collection may re-prove identity, but it must not
// recapture the full root body after the assessor has already reviewed it.
export const ROOT_BODY_ACCEPTANCE_VERSION = 'v0.8-strict-root-body-v4';
export const DEEP_COLLECTION_ACCEPTANCE_VERSION = 'v0.8-strict-deep-collection-v2';

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

  if (eligible.length === 0) {
    return {
      ok: false,
      reason: expectedGroups.size > 0 ? 'no-clean-target-post-permalink-for-group' : 'no-clean-target-post-permalink',
      diagnostics,
      eligibleCount: 0,
    };
  }

  // Scores are diagnostics only. A score must never choose one candidate when
  // multiple articles independently claim to be the same root post.
  if (eligible.length !== 1) {
    return {
      ok: false,
      reason: 'ambiguous-root-post-articles',
      diagnostics,
      eligibleCount: eligible.length,
      eligibleIndexes: eligible.map((item) => item.index),
    };
  }

  const best = eligible[0];

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
    return finalGroup === targetGroup;
  }
  if (!allowedGroups.has(targetGroup) || !allowedGroups.has(finalGroup)) return false;
  return true;
}

function cleanTargetLinkSelector(postId) {
  const id = String(postId).replace(/[^0-9]/g, '');
  if (!id) throw new Error(`Invalid Facebook post id: ${postId}`);
  return [
    `a[href*="/posts/${id}"]:not([href*="comment_id="]):not([href*="reply_comment_id="])`,
    `a[href*="/permalink/${id}"]:not([href*="comment_id="]):not([href*="reply_comment_id="])`,
  ].join(', ');
}

async function snapshotVisibleArticles(page, { includeText = true } = {}) {
  return page.locator('[role="article"]:visible').evaluateAll((articles, options) => articles.map((article) => ({
    text: options.includeText ? (article.innerText || article.textContent || '').replace(/\s+/g, ' ').trim() : '',
    ariaLabel: article.getAttribute('aria-label') || '',
    links: [...article.querySelectorAll('a[href]')].map((a) => ({ href: a.href })),
  })), { includeText });
}

function strictRootSelectionError(message, selected) {
  const error = new Error(message);
  error.code = 'STRICT_ROOT_SURFACE_UNAVAILABLE';
  error.selection = selected ?? null;
  return error;
}

/**
 * Re-resolve the one verified root and derive its containing UI surface.
 * This is identity-only: deep collection does not need to read the post body
 * again just to prove that it is operating on the correct post surface.
 */
export async function resolveStrictRootSurface(page, validation) {
  if (!isStrictBodyValidation(validation)) {
    throw strictRootSelectionError('Cannot resolve a surface from invalid strict root validation');
  }

  const targetPostId = validation.targetPostId;
  const expectedGroupIdentifier = validation.rootGroupIdentifier;
  const snapshots = await snapshotVisibleArticles(page, { includeText: false });
  const selected = selectStrictRootArticle(snapshots, targetPostId, [expectedGroupIdentifier]);
  if (!selected.ok) {
    throw strictRootSelectionError(
      `Cannot resolve one strict root surface for ${targetPostId}: ${selected.reason}`,
      selected,
    );
  }

  const identity = selected.selection.identity;
  if (
    identity.postId !== String(targetPostId)
    || normalizedGroupIdentifier(identity.groupIdentifier) !== normalizedGroupIdentifier(expectedGroupIdentifier)
  ) {
    throw strictRootSelectionError(`Resolved root identity changed for ${targetPostId}`, selected);
  }

  const articles = page.locator('[role="article"]:visible');
  if (selected.selection.index >= await articles.count()) {
    throw strictRootSelectionError(`Resolved strict root disappeared for ${targetPostId}`, selected);
  }
  const root = articles.nth(selected.selection.index);
  await root.waitFor({ state: 'visible', timeout: 5_000 });

  // The nearest dialog/main ancestor is an observable relationship to the
  // verified root. Never fall back to an unrelated dialog or document body.
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
    identity,
    selectionDiagnostics: selected.diagnostics,
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
    await root.page().waitForTimeout(200);
  }
  return clicked;
}

/**
 * Validate the body artifact already captured during review before it is
 * carried into deep collection. This checks local evidence integrity only;
 * it deliberately does not read the live DOM body a second time.
 */
export function reviewedBodyForCollection(candidate) {
  const strictBody = candidate?.strictBody;
  if (!strictBody) return null;
  const body = String(strictBody.body ?? '');
  if (!body.trim()) {
    const error = new Error(`Candidate ${candidate?.postId ?? 'unknown'} is missing its reviewed root body`);
    error.code = 'REVIEWED_BODY_MISSING';
    throw error;
  }
  if (strictBody.bodyAcceptanceVersion !== ROOT_BODY_ACCEPTANCE_VERSION) {
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
 * Capture one root body during review. During deep collection, when the
 * candidate already carries the verified reviewed body, this function switches
 * to an identity-only path: navigate, prove the same unique root/group, and
 * reuse the reviewed body without expanding or reading the root text again.
 */
export async function captureStrictRootBody(page, candidate, {
  attempt = 1,
  allowedGroupIdentifiers = [],
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
  if (reviewedBody) {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.locator(cleanTargetLinkSelector(targetPostId)).first().waitFor({ state: 'attached', timeout: 8_000 });
    await page.waitForTimeout(200);

    const expectedRootGroup = reviewedBody.validation.rootGroupIdentifier;
    const snapshots = await snapshotVisibleArticles(page, { includeText: false });
    const selected = selectStrictRootArticle(snapshots, targetPostId, [expectedRootGroup]);
    if (!selected.ok) {
      const error = new Error(`Strict collection identity selection failed for ${targetPostId}: ${selected.reason}`);
      error.code = 'COLLECTION_ROOT_IDENTITY_FAILED';
      error.selection = selected;
      throw error;
    }

    const articles = page.locator('[role="article"]:visible');
    if (selected.selection.index >= await articles.count()) {
      const error = new Error(`Strict collection root disappeared for post ${targetPostId}`);
      error.code = 'COLLECTION_ROOT_DISAPPEARED';
      error.selection = selected;
      throw error;
    }
    const root = articles.nth(selected.selection.index);
    await root.waitFor({ state: 'visible', timeout: 5_000 });

    const rootIdentity = selected.selection.identity;
    const finalPageUrl = page.url();
    const finalIdentity = parseFacebookPostIdentity(finalPageUrl);
    if (!finalIdentity?.postId || !finalIdentity?.groupIdentifier) {
      const error = new Error(`Final collection page identity is not verifiable for post ${targetPostId}`);
      error.code = 'COLLECTION_FINAL_IDENTITY_UNVERIFIABLE';
      throw error;
    }
    if (finalIdentity.postId !== targetPostId || !allowedGroups.has(normalizedGroupIdentifier(finalIdentity.groupIdentifier))) {
      const error = new Error(`Final collection page identity changed from the allowed source for post ${targetPostId}`);
      error.code = 'COLLECTION_FINAL_IDENTITY_MISMATCH';
      throw error;
    }

    const validation = {
      ...reviewedBody.validation,
      collectionBodyPolicy: 'single-review-capture',
      bodyRevalidation: 'not-performed-single-capture-policy',
      fullBodyCaptures: 1,
      collectionIdentityVerifiedAt: new Date().toISOString(),
      collectionFinalPageUrl: finalPageUrl,
      collectionRootCleanHref: selected.selection.cleanHref,
      collectionEligibleRootArticles: selected.eligibleCount,
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

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.locator(cleanTargetLinkSelector(targetPostId)).first().waitFor({ state: 'attached', timeout: 8_000 });
  await page.waitForTimeout(400);

  const snapshots = await snapshotVisibleArticles(page, { includeText: true });
  const selected = selectStrictRootArticle(snapshots, targetPostId, [...allowedGroups]);
  if (!selected.ok) {
    const error = new Error(`Strict root-body selection failed for ${targetPostId}: ${selected.reason}`);
    error.code = 'ROOT_BODY_SELECTION_FAILED';
    error.selection = selected;
    throw error;
  }

  const articles = page.locator('[role="article"]:visible');
  const articleCount = await articles.count();
  if (selected.selection.index >= articleCount) {
    const error = new Error(`Strict root article disappeared for post ${targetPostId}`);
    error.code = 'ROOT_BODY_DISAPPEARED';
    error.selection = selected;
    throw error;
  }
  const root = articles.nth(selected.selection.index);
  await root.waitFor({ state: 'visible', timeout: 5_000 });
  const clickedSeeMore = await expandRootSeeMore(root);
  const body = cleanFacebookPostText(await root.innerText(), '');
  if (!body.trim()) {
    const error = new Error(`Strict root article for ${targetPostId} produced an empty body`);
    error.code = 'ROOT_BODY_EMPTY';
    throw error;
  }

  const rootIdentity = selected.selection.identity;
  const finalPageUrl = page.url();
  const finalIdentity = parseFacebookPostIdentity(finalPageUrl);
  if (!finalIdentity?.postId || !finalIdentity?.groupIdentifier) {
    const error = new Error(`Final page identity is not verifiable for post ${targetPostId}`);
    error.code = 'ROOT_BODY_FINAL_IDENTITY_UNVERIFIABLE';
    throw error;
  }
  if (finalIdentity.postId !== targetPostId || !allowedGroups.has(normalizedGroupIdentifier(finalIdentity.groupIdentifier))) {
    const error = new Error(`Final page identity changed from the allowed source for post ${targetPostId}`);
    error.code = 'ROOT_BODY_FINAL_IDENTITY_MISMATCH';
    throw error;
  }

  const validation = {
    acceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
    rootIdentityVerified: true,
    targetPostId,
    // Canonical source identity is always what the root article proves. The
    // configured aliases only authorize an observed numeric/vanity transition.
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
  };
}

export function strictCompleteRecordTrust(normalizedRecord, expectedPostId = null, expectedGroupIdentifier = null) {
  const extraction = normalizedRecord?.extraction;
  if (extraction?.acceptanceVersion !== DEEP_COLLECTION_ACCEPTANCE_VERSION) {
    return { trusted: false, reason: 'unsupported-deep-collection-acceptance-version' };
  }
  if (extraction.bodyAcceptanceVersion !== ROOT_BODY_ACCEPTANCE_VERSION) {
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
