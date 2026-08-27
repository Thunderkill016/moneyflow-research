import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  cacheCompleteRecord,
  findCorpusRecord,
  findNearDuplicate,
  hammingDistance64,
  isReusableRecord,
  loadCachedRecord,
  loadCorpusRegistry,
  parseFacebookPostIdentity,
  recordBodyPreflight,
  saveCorpusRegistry,
  simHash64,
  upsertDiscovery,
} from '../src/corpus.mjs';
import { classifyFullBody, shouldCollectComments } from '../src/topic-filter.mjs';

test('parses the actual group from a Facebook URL without fallback rewriting', () => {
  const result = parseFacebookPostIdentity('https://www.facebook.com/groups/other-group/posts/2211870376267189/?x=1');
  assert.equal(result.groupIdentifier, 'other-group');
  assert.equal(result.postId, '2211870376267189');
  assert.equal(result.key, 'facebook:other-group:2211870376267189');
});

test('corpus lookup reuses one prior post across a new topic by post id', () => {
  const registry = { schemaVersion: 1, posts: {} };
  const first = upsertDiscovery(registry, { key: 'facebook:group-a:123', postId: '123', queries: ['topic-a'] }, ['topic-a']);
  first.status = 'complete';
  first.cacheFile = 'posts/a.json';
  first.acceptanceVersion = 'v0.3.0-strict';
  const found = findCorpusRecord(registry, { key: 'facebook:group-alias:123', postId: '123', queries: ['topic-b'] });
  assert.equal(found.sourceKey, 'facebook:group-a:123');
  assert.equal(isReusableRecord(found, ['v0.3.0-strict']), true);
});

test('near duplicate is flagged but remains a separate source key', () => {
  const registry = { schemaVersion: 1, posts: {} };
  const oldBody = 'Ứng dụng quản lý chi tiêu tự động đồng bộ giao dịch ngân hàng và vẫn hỗ trợ tiền mặt.';
  const old = upsertDiscovery(registry, { key: 'facebook:g:1', postId: '1' });
  recordBodyPreflight(registry, { key: 'facebook:g:1', postId: '1' }, { body: oldBody, classification: { classification: 'in-topic' } }, 'topic-a');
  const near = findNearDuplicate(registry, `${oldBody} Bản cập nhật mới.`, { maxHamming: 12, excludeSourceKey: 'facebook:g:2', minChars: 40 });
  assert.ok(near);
  assert.equal(near.sourceKey, old.sourceKey);
});

test('simhash hamming distance is zero for identical text', () => {
  const a = simHash64('quản lý chi tiêu ngân hàng tiền mặt');
  assert.equal(hammingDistance64(a, a), 0);
});

test('full-body filter keeps PFM core and rejects obvious unrelated gaming content', () => {
  const topicFilter = {
    inTopicThreshold: 9,
    adjacentThreshold: 3,
    commentClasses: ['in-topic', 'adjacent', 'ambiguous'],
    anchors: [
      { term: 'quản lý chi tiêu', weight: 6, strong: true },
      { term: 'quản lí chi tiêu', weight: 6, strong: true },
      { term: 'tài chính cá nhân', weight: 6, strong: true },
      { term: 'thu chi', weight: 5, strong: true },
      { term: 'sao kê', weight: 4, strong: true },
      { term: 'ngân sách', weight: 4, strong: true },
      { term: 'expense', weight: 3, strong: true },
    ],
    negativeAnchors: [
      { term: 'cloud gaming', weight: 8 },
      { term: 'game', weight: 5 },
      { term: 'quản lý bán hàng', weight: 8 },
    ],
  };
  const relevance = { threshold: 5, include: [{ term: 'chi tiêu', weight: 3 }], exclude: [] };
  const pfm = classifyFullBody({ body: 'Mình làm app quản lí chi tiêu vì hay quên ghi lại tiền ăn và muốn đồng bộ giao dịch.', query: 'quản lý chi tiêu', relevance, topicFilter });
  const game = classifyFullBody({ body: 'Indie game chiến thuật theo lượt, quản lý tài nguyên và cloud gaming cho nhiều thiết bị.', query: 'quản lý chi tiêu', relevance, topicFilter });
  assert.notEqual(pfm.classification, 'out-of-topic');
  assert.equal(game.classification, 'out-of-topic');
  assert.equal(shouldCollectComments(game.classification, topicFilter), false);
});

test('corpus index and normalized cache survive atomic round trip', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moneyflow-corpus-'));
  const indexPath = path.join(dir, 'index.json');
  const cacheDir = path.join(dir, 'posts');
  const registry = await loadCorpusRegistry(indexPath);
  const candidate = { key: 'facebook:g:42', corpusKey: 'facebook:g:42', postId: '42', queries: ['topic-a'] };
  const normalizedRecord = {
    capturedAt: new Date().toISOString(),
    source: { key: 'facebook:g:42', postId: '42', canonicalUrl: 'https://www.facebook.com/groups/g/permalink/42/', discoveryQueries: ['topic-a'] },
    post: { text: 'quản lý chi tiêu và sao kê ngân hàng' },
    comments: [{ text: 'ok' }],
    extraction: { acceptanceVersion: 'v0.3.0-strict' },
  };
  const record = await cacheCompleteRecord({ registry, indexPath, cacheDir, normalizedRecord, candidate });
  await saveCorpusRegistry(indexPath, registry);
  const loadedRegistry = await loadCorpusRegistry(indexPath);
  const loaded = await loadCachedRecord(indexPath, loadedRegistry.posts[record.sourceKey]);
  assert.equal(loaded.source.postId, '42');
  assert.equal(loaded.comments.length, 1);
});
