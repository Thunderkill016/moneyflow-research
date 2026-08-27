import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchUrl, parseDiscoveryCli, selectCardPost } from '../src/topic-discovery.mjs';
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

test('global search accepts a comment-highlight timestamp link as post identity and canonicalizes it cleanly', () => {
  const href = 'https://www.facebook.com/groups/j2team.community/posts/3009676202697813/?comment_id=3009700299362070';
  const selected = selectCardPost({
    links: [{ href, text: '2 giờ', ariaLabel: '' }],
  });
  assert.ok(selected);
  assert.equal(selected.identity.groupIdentifier, 'j2team.community');
  assert.equal(selected.identity.postId, '3009676202697813');
  assert.equal(selected.identity.key, 'facebook:j2team.community:3009676202697813');
  assert.equal(selected.identity.canonicalUrl, 'https://www.facebook.com/groups/j2team.community/permalink/3009676202697813/');
  assert.equal(selected.sourceLinkKind, 'comment-highlight');
  assert.equal(selected.link.href, href);
});

test('global search preserves actual group identity across multiple live-observed groups', () => {
  const examples = [
    ['https://www.facebook.com/groups/j2team.community/posts/3009676202697813/?comment_id=3009700299362070', 'j2team.community', '3009676202697813'],
    ['https://www.facebook.com/groups/GoogleSpreadsheet/posts/28021574180865021/?comment_id=28027658456923260', 'GoogleSpreadsheet', '28021574180865021'],
    ['https://www.facebook.com/groups/j2team.community/posts/2716008002064636/?comment_id=2717489835249786', 'j2team.community', '2716008002064636'],
  ];
  for (const [href, groupIdentifier, postId] of examples) {
    const selected = selectCardPost({ links: [{ href, text: '1 ngày', ariaLabel: '' }] });
    assert.ok(selected);
    assert.equal(selected.identity.groupIdentifier, groupIdentifier);
    assert.equal(selected.identity.postId, postId);
    assert.equal(selected.identity.canonicalUrl.includes('comment_id='), false);
  }
});

test('clean post permalink is preferred over highlighted variants for the same identity', () => {
  const highlighted = 'https://www.facebook.com/groups/j2team.community/posts/3009676202697813/?comment_id=3009700299362070';
  const clean = 'https://www.facebook.com/groups/j2team.community/posts/3009676202697813/';
  const selected = selectCardPost({
    links: [
      { href: highlighted, text: '2 giờ', ariaLabel: '' },
      { href: clean, text: '2 giờ', ariaLabel: '' },
    ],
  });
  assert.ok(selected);
  assert.equal(selected.sourceLinkKind, 'clean-post-link');
  assert.equal(selected.link.href, clean);
});

test('reply-highlight links remain usable only as discovery identity fallback', () => {
  const href = 'https://www.facebook.com/groups/j2team.community/posts/3009676202697813/?comment_id=3009700299362070&reply_comment_id=3009709999361001';
  const selected = selectCardPost({ links: [{ href, text: '2 giờ', ariaLabel: '' }] });
  assert.ok(selected);
  assert.equal(selected.sourceLinkKind, 'reply-comment-highlight');
  assert.equal(selected.identity.canonicalUrl, 'https://www.facebook.com/groups/j2team.community/permalink/3009676202697813/');
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
