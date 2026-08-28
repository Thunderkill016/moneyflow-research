import test from 'node:test';
import assert from 'node:assert/strict';
import { selectHarvestCandidates } from '../src/body-harvester.mjs';
import { buildOfflineReviewArtifacts, selectReviewCandidates } from '../src/offline-review.mjs';

test('body harvest dedupes discovery candidates before browser work and honors limit', () => {
  const discovery = {
    candidates: [
      { key: 'facebook:g:1', postId: '1' },
      { key: 'facebook:g:1', postId: '1' },
      { key: 'facebook:g:2', postId: '2' },
    ],
  };
  assert.deepEqual(selectHarvestCandidates(discovery).map((item) => item.postId), ['1', '2']);
  assert.deepEqual(selectHarvestCandidates(discovery, 1).map((item) => item.postId), ['1']);
});

test('offline review prepares all selected trusted rows without browser navigation', () => {
  const candidates = selectReviewCandidates({
    candidates: [
      { key: 'facebook:g:1', postId: '1' },
      { key: 'facebook:g:2', postId: '2' },
    ],
  });
  assert.equal(candidates.length, 2);

  const rows = [
    { postId: '1', bodyContentHash: 'h1' },
    { postId: '2', bodyContentHash: 'h2' },
  ];
  const artifacts = buildOfflineReviewArtifacts({
    topicKey: 'personal-expense-management',
    topicLabel: 'PFM',
    rows,
    alreadyJudged: [],
  });
  assert.equal(artifacts.queue.items.length, 2);
  assert.equal(artifacts.queue.preparation.mode, 'offline-corpus-first');
  assert.equal(artifacts.queue.preparation.browserNavigations, 0);
  assert.deepEqual(artifacts.decisionsTemplate.decisions.map((row) => row.postId), ['1', '2']);
});
