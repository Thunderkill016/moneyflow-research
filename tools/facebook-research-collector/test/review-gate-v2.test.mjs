import test from 'node:test';
import assert from 'node:assert/strict';
import { hashText } from '../src/corpus.mjs';
import {
  ROOT_BODY_ACCEPTANCE_VERSION,
  bodyTrust,
  classificationTrust,
  selectStrictRootArticle,
  stampStrictBody,
} from '../src/root-body.mjs';

const POST_ID = '123456789';
const ROOT = `https://www.facebook.com/groups/example.group/posts/${POST_ID}/`;
const COMMENT = `${ROOT}?comment_id=999`;
const REPLY = `${ROOT}?comment_id=999&reply_comment_id=888`;

function record({ status = 'seen', acceptanceVersion = null, cacheFile = null, body = null } = {}) {
  return {
    sourceKey: `facebook:example.group:${POST_ID}`,
    status,
    acceptanceVersion,
    cacheFile,
    source: {
      platform: 'facebook',
      postId: POST_ID,
      groupIdentifier: 'example.group',
      canonicalUrl: ROOT,
    },
    body,
    topicClassifications: {},
  };
}

test('strict root selection rejects comment-highlight-only articles', () => {
  const selected = selectStrictRootArticle([
    { text: 'A reply that happens to mention the parent post', ariaLabel: 'Bình luận', links: [{ href: COMMENT }, { href: REPLY }] },
  ], POST_ID);
  assert.equal(selected.ok, false);
  assert.equal(selected.reason, 'no-clean-target-post-permalink');
});

test('strict root selection chooses clean target permalink over a much longer comment', () => {
  const selected = selectStrictRootArticle([
    { text: 'x'.repeat(5000), ariaLabel: 'Comment', links: [{ href: COMMENT }] },
    { text: 'Short but real post body', ariaLabel: '', links: [{ href: ROOT }] },
  ], POST_ID);
  assert.equal(selected.ok, true);
  assert.equal(selected.selection.identity.postId, POST_ID);
  assert.equal(selected.selection.identity.groupIdentifier, 'example.group');
  assert.equal(selected.selection.cleanHref, ROOT);
});

test('strict root selection fails closed when two equally strong roots are ambiguous', () => {
  const selected = selectStrictRootArticle([
    { text: 'same body', ariaLabel: '', links: [{ href: ROOT }] },
    { text: 'same body', ariaLabel: '', links: [{ href: ROOT }] },
  ], POST_ID);
  assert.equal(selected.ok, false);
  assert.equal(selected.reason, 'ambiguous-root-post-articles');
});

test('legacy seen body cache is untrusted', () => {
  const r = record({
    body: {
      text: 'legacy body',
      contentHash: hashText('legacy body'),
    },
  });
  const trust = bodyTrust(r, ['v0.3.0-strict']);
  assert.equal(trust.trusted, false);
  assert.equal(trust.reason, 'legacy-or-unvalidated-body-cache');
});

test('strictly stamped seen body cache is trusted', () => {
  const text = 'verified root post body';
  const r = record({ body: { text, contentHash: hashText(text) } });
  stampStrictBody(r, {
    acceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
    rootIdentityVerified: true,
    targetPostId: POST_ID,
    rootPostId: POST_ID,
    finalPostId: POST_ID,
  });
  const trust = bodyTrust(r, ['v0.3.0-strict']);
  assert.equal(trust.trusted, true);
  assert.equal(trust.kind, 'strict-preflight');
});

test('classification on a seen record is trusted only when bound to body hash and acceptance version', () => {
  const text = 'verified root post body';
  const r = record({ body: { text, contentHash: hashText(text) } });
  stampStrictBody(r, {
    acceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
    rootIdentityVerified: true,
    targetPostId: POST_ID,
    rootPostId: POST_ID,
    finalPostId: POST_ID,
  });
  const stale = classificationTrust(r, { relevant: true }, ['v0.3.0-strict']);
  assert.equal(stale.trusted, false);
  assert.equal(stale.reason, 'classification-body-hash-mismatch');

  const current = classificationTrust(r, {
    relevant: true,
    bodyContentHash: r.body.contentHash,
    bodyAcceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
  }, ['v0.3.0-strict']);
  assert.equal(current.trusted, true);
});

test('accepted complete records preserve legacy topic judgments without forcing body recapture', () => {
  const r = record({
    status: 'complete',
    acceptanceVersion: 'v0.3.0-strict',
    cacheFile: 'posts/example.json',
    body: { text: 'accepted complete body', contentHash: hashText('accepted complete body') },
  });
  const bodyState = bodyTrust(r, ['v0.3.0-strict']);
  assert.equal(bodyState.trusted, true);
  assert.equal(bodyState.kind, 'complete-record');

  const judgmentState = classificationTrust(r, { relevant: false }, ['v0.3.0-strict']);
  assert.equal(judgmentState.trusted, true);
});
