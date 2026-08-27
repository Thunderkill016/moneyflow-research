import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchUrl, isCandidateAllowedForTarget, parseDiscoveryCli, resolveDiscoveryTargets, selectCardPost } from '../src/topic-discovery.mjs';
import { parseCollectCli } from '../src/collect.mjs';

test('topic discovery uses Facebook global Posts search and does not inject a group id', () => {
  const url = buildSearchUrl({ scope: 'topic', groupId: '1569314343856132', query: 'quản lý chi tiêu' });
  assert.equal(url, 'https://www.facebook.com/search/posts/?q=qu%E1%BA%A3n%20l%C3%BD%20chi%20ti%C3%AAu');
  assert.equal(url.includes('/groups/'), false);
});

test('group discovery builds a scoped search URL', () => {
  const url = buildSearchUrl({ scope: 'group', groupId: 'j2team.community', query: 'quản lý chi tiêu' });
  assert.equal(url, 'https://www.facebook.com/groups/j2team.community/search/?q=qu%E1%BA%A3n%20l%C3%BD%20chi%20ti%C3%AAu');
});

test('focused group discovery resolves Build in Public VN and J2TEAM targets with aliases', () => {
  const targets = resolveDiscoveryTargets({
    groups: [
      { id: '1569314343856132', name: 'Build in Public VN', aliases: ['1569314343856132', 'indiehackervn'] },
      { id: 'j2team.community', name: 'J2TEAM Community', aliases: ['j2team.community'] },
    ],
  }, 'group');
  assert.deepEqual(targets, [
    { id: '1569314343856132', name: 'Build in Public VN', aliases: ['1569314343856132', 'indiehackervn'] },
    { id: 'j2team.community', name: 'J2TEAM Community', aliases: ['j2team.community'] },
  ]);
});

test('candidate target filter accepts configured aliases for Build in Public and rejects foreign slugs', () => {
  const bipTarget = { id: '1569314343856132', name: 'Build in Public VN', aliases: ['1569314343856132', 'indiehackervn'] };
  const j2Target = { id: 'j2team.community', name: 'J2TEAM Community', aliases: ['j2team.community'] };

  // 1569314343856132 <-> indiehackervn => same allowed target
  assert.equal(isCandidateAllowedForTarget({ groupIdentifier: '1569314343856132' }, bipTarget, 'group'), true);
  assert.equal(isCandidateAllowedForTarget({ groupIdentifier: 'indiehackervn' }, bipTarget, 'group'), true);

  // j2team.community => allowed only for J2TEAM target
  assert.equal(isCandidateAllowedForTarget({ groupIdentifier: 'j2team.community' }, j2Target, 'group'), true);
  assert.equal(isCandidateAllowedForTarget({ groupIdentifier: 'j2team.community' }, bipTarget, 'group'), false);

  // foreign group slug => rejected
  assert.equal(isCandidateAllowedForTarget({ groupIdentifier: 'GoogleSpreadsheet' }, bipTarget, 'group'), false);
  assert.equal(isCandidateAllowedForTarget({ groupIdentifier: 'GoogleSpreadsheet' }, j2Target, 'group'), false);
});

test('group discovery falls back to legacy config.group with aliases', () => {
  const targets = resolveDiscoveryTargets({ group: { id: '1569314343856132', name: 'Build in Public VN', aliases: ['indiehackervn'] } }, 'group');
  assert.deepEqual(targets, [{ id: '1569314343856132', name: 'Build in Public VN', aliases: ['1569314343856132', 'indiehackervn'] }]);
});

test('group discovery refuses to run without any configured group', () => {
  assert.throws(() => resolveDiscoveryTargets({}, 'group'), /requires config\.groups/);
});

test('global search accepts a comment-highlight timestamp link as post identity and canonicalizes it cleanly', () => {
  const href = 'https://www.facebook.com/groups/j2team.community/posts/3009676202697813/?comment_id=3009700299362070';
  const selected = selectCardPost({ links: [{ href, text: '2 giờ', ariaLabel: '' }] });
  assert.ok(selected);
  assert.equal(selected.identity.groupIdentifier, 'j2team.community');
  assert.equal(selected.identity.postId, '3009676202697813');
  assert.equal(selected.identity.canonicalUrl, 'https://www.facebook.com/groups/j2team.community/permalink/3009676202697813/');
  assert.equal(selected.sourceLinkKind, 'comment-highlight');
});

test('clean post permalink is preferred over highlighted variants for the same identity', () => {
  const highlighted = 'https://www.facebook.com/groups/j2team.community/posts/3009676202697813/?comment_id=3009700299362070';
  const clean = 'https://www.facebook.com/groups/j2team.community/posts/3009676202697813/';
  const selected = selectCardPost({ links: [
    { href: highlighted, text: '2 giờ', ariaLabel: '' },
    { href: clean, text: '2 giờ', ariaLabel: '' },
  ] });
  assert.ok(selected);
  assert.equal(selected.sourceLinkKind, 'clean-post-link');
  assert.equal(selected.link.href, clean);
});

test('collect entrypoint preserves assessor review arguments', () => {
  const parsed = parseCollectCli(['collect', '--config', 'config.json', '--from-review', 'queue.json', '--decisions', 'decisions.json', '--output-dir', 'out']);
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
