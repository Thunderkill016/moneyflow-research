import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchUrl, parseDiscoveryCli } from '../src/topic-discovery.mjs';
import { parseCollectCli } from '../src/collect.mjs';

test('topic discovery uses Facebook global Posts search and does not inject a group id', () => {
  const url = buildSearchUrl({ scope: 'topic', groupId: '1569314343856132', query: 'quản lý chi tiêu' });
  assert.equal(url, 'https://www.facebook.com/search/posts/?q=qu%E1%BA%A3n%20l%C3%BD%20chi%20ti%C3%AAu');
  assert.equal(url.includes('/groups/'), false);
  assert.equal(url.includes('1569314343856132'), false);
});

test('group discovery remains available only as an explicit debug scope', () => {
  const url = buildSearchUrl({ scope: 'group', groupId: '1569314343856132', query: 'quản lý chi tiêu' });
  assert.equal(url, 'https://www.facebook.com/groups/1569314343856132/search/?q=qu%E1%BA%A3n%20l%C3%BD%20chi%20ti%C3%AAu');
});

test('group discovery refuses to run without a group id', () => {
  assert.throws(() => buildSearchUrl({ scope: 'group', query: 'quản lý chi tiêu' }), /groupId is required/);
});

test('collect entrypoint preserves assessor review arguments', () => {
  const parsed = parseCollectCli([
    'collect', '--config', 'config.json', '--from-review', 'queue.json', '--decisions', 'decisions.json', '--output-dir', 'out',
  ]);
  assert.equal(parsed.fromReview, 'queue.json');
  assert.equal(parsed.decisions, 'decisions.json');
  assert.equal(parsed.outputDir, 'out');
});

test('collect entrypoint rejects unknown flags instead of silently ignoring them', () => {
  assert.throws(() => parseCollectCli(['collect', '--made-up-flag']), /Unknown option/);
});

test('discovery CLI keeps one-query mode explicit', () => {
  const parsed = parseDiscoveryCli(['discover', '--query', 'quản lý thu chi', '--output-dir', 'out']);
  assert.equal(parsed.query, 'quản lý thu chi');
  assert.equal(parsed.outputDir, 'out');
});
