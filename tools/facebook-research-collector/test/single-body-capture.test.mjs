import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { hashText } from '../src/corpus.mjs';
import {
  ROOT_BODY_ACCEPTANCE_VERSION,
  captureStrictRootBody,
  reviewedBodyForCollection,
} from '../src/root-body.mjs';

const POST_ID = '123456789';
const GROUP = 'example.group';
const ROOT = `https://www.facebook.com/groups/${GROUP}/posts/${POST_ID}/`;
const BODY = 'Reviewed root body captured exactly once.';

function strictValidation(overrides = {}) {
  return {
    acceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
    rootIdentityVerified: true,
    targetPostId: POST_ID,
    targetGroupIdentifier: GROUP,
    rootPostId: POST_ID,
    rootGroupIdentifier: GROUP,
    finalPostId: POST_ID,
    finalGroupIdentifier: GROUP,
    allowedGroupIdentifiers: [GROUP],
    rootCleanHref: ROOT,
    eligibleRootArticles: 1,
    capturedAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

function reviewedCandidate(overrides = {}) {
  return {
    postId: POST_ID,
    groupId: GROUP,
    groupIdentifier: GROUP,
    canonicalUrl: ROOT,
    allowedGroupIdentifiers: [GROUP],
    strictBody: {
      body: BODY,
      bodyContentHash: hashText(BODY),
      bodyAcceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
      capturedAt: '2026-08-28T00:00:00.000Z',
      fullBodyCaptures: 1,
      validation: strictValidation(),
    },
    ...overrides,
  };
}

test('reviewed body is locally integrity-checked before collection reuse', () => {
  const result = reviewedBodyForCollection(reviewedCandidate());
  assert.equal(result.body, BODY);
  assert.equal(result.bodyContentHash, hashText(BODY));
  assert.equal(result.validation.targetPostId, POST_ID);

  const tampered = reviewedCandidate();
  tampered.strictBody.body = `${BODY} tampered`;
  assert.throws(
    () => reviewedBodyForCollection(tampered),
    (error) => error?.code === 'REVIEWED_BODY_HASH_MISMATCH',
  );
});

test('review apply carries the verified body into the deep child candidate', async () => {
  const runnerPath = path.resolve(import.meta.dirname, '../src/review-topic-runner-v2.mjs');
  const source = await fs.readFile(runnerPath, 'utf8');
  assert.match(source, /strictBody:\s*\{[\s\S]*?body:\s*row\.body,/);
  assert.match(source, /fullBodyCaptures:\s*1,/);
});

test('deep collection proves identity without reading or expanding the root body again', async () => {
  const calls = {
    goto: 0,
    snapshotIncludeText: null,
    rootWait: 0,
  };

  const rootLocator = {
    waitFor: async () => { calls.rootWait += 1; },
    // Deliberately no innerText(), filter(), click(), or page(). If the deep
    // path attempts full-body extraction/expansion, this fixture will fail.
  };

  const articlesLocator = {
    evaluateAll: async (_fn, options) => {
      calls.snapshotIncludeText = options?.includeText;
      return [{
        text: options?.includeText ? BODY : '',
        ariaLabel: '',
        links: [{ href: ROOT }],
      }];
    },
    count: async () => 1,
    nth: () => rootLocator,
  };

  const cleanLinkLocator = {
    first: () => ({ waitFor: async () => {} }),
  };

  const page = {
    goto: async (url) => {
      calls.goto += 1;
      assert.equal(url, ROOT);
    },
    locator: (selector) => {
      if (selector === '[role="article"]:visible') return articlesLocator;
      if (selector.includes(`/posts/${POST_ID}`) || selector.includes(`/permalink/${POST_ID}`)) return cleanLinkLocator;
      throw new Error(`Unexpected locator in identity-only path: ${selector}`);
    },
    waitForTimeout: async () => {},
    url: () => ROOT,
  };

  const result = await captureStrictRootBody(page, reviewedCandidate(), {
    allowedGroupIdentifiers: [GROUP],
  });

  assert.equal(calls.goto, 1);
  assert.equal(calls.snapshotIncludeText, false);
  assert.equal(calls.rootWait, 1);
  assert.equal(result.body, BODY);
  assert.equal(result.fullBodyCaptures, 1);
  assert.equal(result.bodyRevalidation, 'not-performed-single-capture-policy');
  assert.equal(result.validation.bodyRevalidation, 'not-performed-single-capture-policy');
  assert.equal(result.validation.collectionBodyPolicy, 'single-review-capture');
});
