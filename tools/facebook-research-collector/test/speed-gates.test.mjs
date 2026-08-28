import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  hasReachedDiscoveryLimit,
  parseDiscoveryCli,
} from '../src/topic-discovery.mjs';
import {
  ROOT_BODY_ACCEPTANCE_VERSION,
  selectUrlAnchoredRootArticle,
} from '../src/root-body.mjs';

const POST_ID = '2184476925673201';
const GROUP = 'indiehackervn';
const ROOT = `https://www.facebook.com/groups/${GROUP}/permalink/${POST_ID}/`;
const COMMENT = `${ROOT}?comment_id=999`;
const FINAL_IDENTITY = {
  platform: 'facebook',
  postId: POST_ID,
  groupIdentifier: GROUP,
  key: `facebook:${GROUP}:${POST_ID}`,
  canonicalUrl: ROOT,
};

test('discovery CLI parses a positive total candidate limit', () => {
  const cli = parseDiscoveryCli(['discover', '--limit', '1']);
  assert.equal(cli.limit, 1);
  assert.equal(hasReachedDiscoveryLimit(0, cli.limit), false);
  assert.equal(hasReachedDiscoveryLimit(1, cli.limit), true);
  assert.throws(() => parseDiscoveryCli(['discover', '--limit', '0']), /positive integer/);
});

test('default collect forwards --limit into discovery instead of scanning every query first', async () => {
  const collectPath = path.resolve(import.meta.dirname, '../src/collect.mjs');
  const source = await fs.readFile(collectPath, 'utf8');
  assert.match(source, /runTopicDiscovery\(\{[\s\S]*?limit:\s*cli\.limit,/);
});

test('url-anchored root fallback accepts exactly one non-comment article with root actions', () => {
  const selected = selectUrlAnchoredRootArticle([
    {
      text: 'Full root body without a rendered self permalink',
      ariaLabel: '',
      links: [],
      actionTexts: ['Thích', 'Bình luận', 'Chia sẻ'],
    },
    {
      text: 'A comment sibling',
      ariaLabel: 'Bình luận',
      links: [{ href: COMMENT }],
      actionTexts: ['Thích', 'Trả lời'],
    },
  ], POST_ID, [GROUP], FINAL_IDENTITY);

  assert.equal(selected.ok, true);
  assert.equal(selected.evidenceMode, 'final-url-plus-unique-root-actions');
  assert.equal(selected.selection.index, 0);
  assert.equal(selected.selection.identity.key, `facebook:${GROUP}:${POST_ID}`);
});

test('url-anchored root fallback fails closed when two root-like articles are present', () => {
  const selected = selectUrlAnchoredRootArticle([
    { text: 'root a', ariaLabel: '', links: [], actionTexts: ['Like', 'Comment', 'Share'] },
    { text: 'root b', ariaLabel: '', links: [], actionTexts: ['Like', 'Comment', 'Share'] },
  ], POST_ID, [GROUP], FINAL_IDENTITY);

  assert.equal(selected.ok, false);
  assert.equal(selected.reason, 'ambiguous-url-anchored-root-articles');
  assert.deepEqual(selected.fallbackEligibleIndexes, [0, 1]);
});

test('url-anchored fallback is disabled when final URL identity is not the allowed source', () => {
  const selected = selectUrlAnchoredRootArticle([
    { text: 'root', ariaLabel: '', links: [], actionTexts: ['Like', 'Comment', 'Share'] },
  ], POST_ID, [GROUP], { ...FINAL_IDENTITY, groupIdentifier: 'other.group' });

  assert.equal(selected.ok, false);
  assert.equal(selected.fallbackReason, 'final-url-identity-not-proven');
});

test('root-body v5 source no longer contains the hard 8-second clean permalink readiness gate', async () => {
  assert.equal(ROOT_BODY_ACCEPTANCE_VERSION, 'v0.9-strict-root-body-v5');
  const rootBodyPath = path.resolve(import.meta.dirname, '../src/root-body.mjs');
  const source = await fs.readFile(rootBodyPath, 'utf8');
  assert.doesNotMatch(source, /cleanTargetLinkSelector/);
  assert.match(source, /rootReadyTimeoutMs\s*=\s*2_500/);
  assert.match(source, /final-url-plus-unique-root-actions/);
});
