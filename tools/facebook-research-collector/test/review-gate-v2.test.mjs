import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { hashText } from '../src/corpus.mjs';
import { assertReviewedBodyIsCurrent } from '../src/index.mjs';
import { assertReviewRowStillCurrent } from '../src/review-topic-runner-v2.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import {
  DEEP_COLLECTION_ACCEPTANCE_VERSION,
  ROOT_BODY_ACCEPTANCE_VERSION,
  bodyTrust,
  classificationTrust,
  resolveStrictRootSurface,
  selectStrictRootArticle,
  stampStrictBody,
  strictCompleteRecordTrust,
} from '../src/root-body.mjs';

const POST_ID = '123456789';
const GROUP = 'example.group';
const ROOT = `https://www.facebook.com/groups/${GROUP}/posts/${POST_ID}/`;
const COMMENT = `${ROOT}?comment_id=999`;
const REPLY = `${ROOT}?comment_id=999&reply_comment_id=888`;
const execFileAsync = promisify(execFile);

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
    ...overrides,
  };
}

function record({ status = 'seen', acceptanceVersion = null, cacheFile = null, body = null } = {}) {
  return {
    sourceKey: `facebook:${GROUP}:${POST_ID}`,
    status,
    acceptanceVersion,
    cacheFile,
    source: {
      platform: 'facebook',
      postId: POST_ID,
      groupIdentifier: GROUP,
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
  ], POST_ID, GROUP);
  assert.equal(selected.ok, true);
  assert.equal(selected.selection.identity.postId, POST_ID);
  assert.equal(selected.selection.identity.groupIdentifier, GROUP);
  assert.equal(selected.selection.cleanHref, ROOT);
});

test('strict root selection allows only explicitly configured numeric/vanity aliases', () => {
  const numericAlias = `https://www.facebook.com/groups/1569314343856132/posts/${POST_ID}/`;
  const selected = selectStrictRootArticle([
    { text: 'Verified root through configured alias', ariaLabel: '', links: [{ href: numericAlias }] },
  ], POST_ID, [GROUP, '1569314343856132']);
  assert.equal(selected.ok, true);
  assert.equal(selected.selection.identity.groupIdentifier, '1569314343856132');
});

test('strict root selection fails closed when only the same post id from another group is present', () => {
  const foreignRoot = `https://www.facebook.com/groups/other.group/posts/${POST_ID}/`;
  const selected = selectStrictRootArticle([
    { text: 'Wrong group root', ariaLabel: '', links: [{ href: foreignRoot }] },
  ], POST_ID, GROUP);
  assert.equal(selected.ok, false);
  assert.equal(selected.reason, 'no-clean-target-post-permalink-for-group');
  assert.equal(selected.diagnostics[0].foreignGroupLinks, 1);
});

test('strict root selection fails closed when two equally strong roots are ambiguous', () => {
  const selected = selectStrictRootArticle([
    { text: 'same body', ariaLabel: '', links: [{ href: ROOT }] },
    { text: 'same body', ariaLabel: '', links: [{ href: ROOT }] },
  ], POST_ID, GROUP);
  assert.equal(selected.ok, false);
  assert.equal(selected.reason, 'ambiguous-root-post-articles');
});

test('strict root selection fails closed when clean roots have different scores', () => {
  const selected = selectStrictRootArticle([
    { text: 'Short clean root', ariaLabel: '', links: [{ href: ROOT }] },
    { text: 'A second clean root with more surrounding content'.repeat(20), ariaLabel: '', links: [{ href: ROOT }] },
  ], POST_ID, GROUP);
  assert.equal(selected.ok, false);
  assert.equal(selected.reason, 'ambiguous-root-post-articles');
  assert.deepEqual(selected.eligibleIndexes, [0, 1]);
});

test('strict deep scope stays on the verified root surface when another dialog shares the post id', async (t) => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    t.skip(`Chromium unavailable for offline surface fixture: ${error.message}`);
    return;
  }
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`
    <main id="verified-main" role="main">
      <article role="article"><a href="${ROOT}">Verified root</a><p>Root post body</p></article>
      <article role="article"><p>Verified post comment</p></article>
    </main>
    <div id="wrong-dialog" role="dialog">
      <article role="article"><a href="${COMMENT}">Highlighted comment for ${POST_ID}</a></article>
      <button>View more comments</button>
    </div>
  `);
  const scope = await resolveStrictRootSurface(page, strictValidation());
  assert.equal(await scope.surface.getAttribute('id'), 'verified-main');
  assert.equal(scope.surfaceType, 'main');
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
  stampStrictBody(r, strictValidation());
  const trust = bodyTrust(r, ['v0.3.0-strict']);
  assert.equal(trust.trusted, true);
  assert.equal(trust.kind, 'strict-preflight');
});

test('strict body stamp rejects cross-group provenance mismatch', () => {
  const text = 'verified root post body';
  const r = record({ body: { text, contentHash: hashText(text) } });
  assert.throws(
    () => stampStrictBody(r, strictValidation({ rootGroupIdentifier: 'other.group' })),
    /Invalid strict body validation stamp/,
  );
});

test('classification on a seen record is trusted only when bound to body hash and acceptance version', () => {
  const text = 'verified root post body';
  const r = record({ body: { text, contentHash: hashText(text) } });
  stampStrictBody(r, strictValidation());
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

test('legacy complete records cannot become reusable evidence under the strict deep contract', () => {
  const r = record({
    status: 'complete',
    acceptanceVersion: 'v0.3.0-strict',
    cacheFile: 'posts/example.json',
    body: { text: 'accepted complete body', contentHash: hashText('accepted complete body') },
  });
  const bodyState = bodyTrust(r, ['v0.3.0-strict']);
  assert.equal(bodyState.trusted, false);

  const judgmentState = classificationTrust(r, { relevant: false }, ['v0.3.0-strict']);
  assert.equal(judgmentState.trusted, false);
});

test('strict deep records retain the root validation that makes reuse safe', () => {
  const normalized = {
    source: { postId: POST_ID, groupIdentifier: GROUP },
    post: { text: 'Verified root body' },
    extraction: {
      acceptanceVersion: DEEP_COLLECTION_ACCEPTANCE_VERSION,
      bodyAcceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
      rootValidation: strictValidation(),
    },
  };
  const trust = strictCompleteRecordTrust(normalized, POST_ID, GROUP);
  assert.equal(trust.trusted, true);

  normalized.extraction.rootValidation.finalGroupIdentifier = 'unconfigured.group';
  assert.equal(strictCompleteRecordTrust(normalized, POST_ID, GROUP).trusted, false);
});

test('deep collection fails instead of persisting a body changed after review', () => {
  const candidate = {
    postId: POST_ID,
    strictBody: {
      bodyAcceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
      bodyContentHash: hashText('Reviewed root body'),
    },
  };
  assert.doesNotThrow(() => assertReviewedBodyIsCurrent(candidate, { body: 'Reviewed root body' }));
  assert.throws(
    () => assertReviewedBodyIsCurrent(candidate, { body: 'A changed root body' }),
    /Verified root body changed after review/,
  );
});

test('apply-time reuse rejects a strict cache whose reviewed body changed', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moneyflow-reuse-toctou-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const reviewedBody = 'Reviewed strict root body';
  const cachedBody = 'Cache changed after the assessor reviewed it';
  const cacheFile = 'cached.json';
  const indexPath = path.join(dir, 'index.json');
  const cachePath = path.join(dir, cacheFile);
  const complete = record({
    status: 'complete',
    acceptanceVersion: DEEP_COLLECTION_ACCEPTANCE_VERSION,
    cacheFile,
    body: { text: reviewedBody, contentHash: hashText(reviewedBody) },
  });
  await fs.writeFile(cachePath, JSON.stringify({
    source: { postId: POST_ID, groupIdentifier: GROUP },
    post: { text: cachedBody },
    extraction: {
      acceptanceVersion: DEEP_COLLECTION_ACCEPTANCE_VERSION,
      bodyAcceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
      rootValidation: strictValidation(),
    },
  }));

  await assert.rejects(
    assertReviewRowStillCurrent(indexPath, complete, {
      postId: POST_ID,
      sourceGroupIdentifier: GROUP,
      body: reviewedBody,
      bodyContentHash: hashText(reviewedBody),
    }, [DEEP_COLLECTION_ACCEPTANCE_VERSION]),
    /Complete record body changed after review preparation/,
  );
});

test('default collect entrypoint routes a review application through the strict v2 gate', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moneyflow-collector-entrypoint-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outputDir = path.join(root, 'output');
  const configPath = path.join(root, 'config.json');
  const reviewPath = path.join(root, 'review-queue.json');
  const decisionsPath = path.join(root, 'decisions.json');
  await fs.writeFile(configPath, JSON.stringify({
    group: { id: GROUP, name: 'Example group' },
    collection: { outputDir },
    corpus: {
      indexPath: './corpus/index.json',
      cacheDir: './corpus/posts',
      acceptedAcceptanceVersions: [DEEP_COLLECTION_ACCEPTANCE_VERSION],
    },
    review: { topicKey: 'personal-expense-management', topicLabel: 'PFM' },
  }));
  await fs.writeFile(reviewPath, JSON.stringify({
    schemaVersion: 2,
    bodyAcceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
    topicKey: 'personal-expense-management',
    items: [],
    alreadyJudged: [],
  }));
  await fs.writeFile(decisionsPath, JSON.stringify({
    schemaVersion: 2,
    bodyAcceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
    topicKey: 'personal-expense-management',
    decisions: [],
  }));

  const collectorDir = path.resolve(import.meta.dirname, '..');
  await execFileAsync('npm', [
    'run', 'collect', '--',
    '--config', configPath,
    '--from-review', reviewPath,
    '--decisions', decisionsPath,
    '--output-dir', outputDir,
  ], { cwd: collectorDir });

  const run = JSON.parse(await fs.readFile(path.join(outputDir, 'TOPIC_RUN.json'), 'utf8'));
  assert.equal(run.status, 'completed');
  assert.equal(run.reconciliation.bodyAcceptanceVersion, ROOT_BODY_ACCEPTANCE_VERSION);
});

test('collect:review package command cannot bypass the strict default entrypoint', async () => {
  const packageJson = JSON.parse(await fs.readFile(path.resolve(import.meta.dirname, '..', 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['collect:review'], 'node src/collect.mjs collect');
});
