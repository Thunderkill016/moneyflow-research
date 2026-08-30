import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeFacebookPostUrl,
  cleanFacebookPostText,
  cleanFacebookText,
  fingerprintComment,
  isCommentPermalink,
  isExpandButtonText,
  isSuspiciousUnmatchedButton,
  scoreRelevance,
} from '../src/core.mjs';

test('canonicalizes posts and permalink URLs to the same key', () => {
  const a = canonicalizeFacebookPostUrl('https://www.facebook.com/groups/indiehackervn/posts/2234480620672831/?__cft__=x');
  const b = canonicalizeFacebookPostUrl('https://www.facebook.com/groups/indiehackervn/permalink/2234480620672831/');
  assert.equal(a.key, 'facebook:indiehackervn:2234480620672831');
  assert.equal(a.key, b.key);
});

test('uses the configured group id to dedupe slug and numeric URL variants', () => {
  const a = canonicalizeFacebookPostUrl('https://www.facebook.com/groups/indiehackervn/posts/2234480620672831/', '1569314343856132');
  const b = canonicalizeFacebookPostUrl('https://www.facebook.com/groups/1569314343856132/?multi_permalinks=2234480620672831', '1569314343856132');
  assert.equal(a.key, b.key);
  assert.equal(a.key, 'facebook:1569314343856132:2234480620672831');
});

test('canonicalizes multi_permalinks group URLs', () => {
  const result = canonicalizeFacebookPostUrl('https://www.facebook.com/groups/1569314343856132/?multi_permalinks=2186842225436671');
  assert.equal(result.key, 'facebook:1569314343856132:2186842225436671');
});

test('scores Vietnamese relevance without depending on accents', () => {
  const result = scoreRelevance('Bot quản lý tài chính cá nhân, ghi chép chi tiêu qua Telegram', {
    threshold: 5,
    include: [
      { term: 'tài chính cá nhân', weight: 3 },
      { term: 'chi tieu', weight: 3 },
    ],
  });
  assert.equal(result.score, 6);
  assert.equal(result.relevant, true);
});

test('removes common Facebook UI-only lines conservatively', () => {
  const text = cleanFacebookText('Văn Chiến\nCó quản lý nhiều tài khoản không?\nThích\nTrả lời\nChia sẻ', 'Văn Chiến');
  assert.equal(text, 'Có quản lý nhiều tài khoản không?');
});

test('cleans concatenated author age and action chrome from live Facebook DOM text', () => {
  const raw = 'Thái Duy Anh · 9 tuầnVẫn là app thu chi mà có đầu tư tư duy nghiên cứu chức năng vào như này nó khác liền.ThíchTrả lờiChia sẻ1';
  const text = cleanFacebookText(raw, 'Thái Duy Anh');
  assert.equal(text, 'Vẫn là app thu chi mà có đầu tư tư duy nghiên cứu chức năng vào như này nó khác liền.');
});

test('comment fingerprints are deterministic', () => {
  const input = { postKey: 'facebook:g:1', author: 'A', text: '50k ăn sáng', parentFingerprint: '' };
  assert.equal(fingerprintComment(input), fingerprintComment(input));
});

// --- Regression: comment permalink with same post ID must not be treated as canonical ---

test('isCommentPermalink identifies comment permalinks containing the post ID', () => {
  const postId = '2186835792103981';
  const commentUrl = `https://www.facebook.com/groups/indiehackervn/posts/${postId}/?comment_id=2186914872096073&__cft__[0]=AZY`;
  assert.equal(isCommentPermalink(commentUrl, postId), true);
});

test('isCommentPermalink returns false for canonical post permalink', () => {
  const postId = '2186835792103981';
  const canonicalUrl = `https://www.facebook.com/groups/indiehackervn/posts/${postId}/`;
  assert.equal(isCommentPermalink(canonicalUrl, postId), false);
});

test('isCommentPermalink identifies reply_comment_id links', () => {
  const postId = '2186835792103981';
  const replyUrl = `https://www.facebook.com/groups/indiehackervn/posts/${postId}/?comment_id=123&reply_comment_id=456`;
  assert.equal(isCommentPermalink(replyUrl, postId), true);
});

test('isCommentPermalink returns false for unrelated URLs', () => {
  assert.equal(isCommentPermalink('https://www.facebook.com/', '12345'), false);
  assert.equal(isCommentPermalink('', '12345'), false);
  assert.equal(isCommentPermalink(null, '12345'), false);
});

// --- Regression: concatenated "ThíchTrả lờiChia sẻ1" ---

test('strips concatenated Vietnamese UI controls from end of text', () => {
  const raw = 'Vẫn là app thu chi mà có đầu tư.ThíchTrả lờiChia sẻ1';
  const result = cleanFacebookText(raw, '');
  assert.equal(result, 'Vẫn là app thu chi mà có đầu tư.');
});

test('strips concatenated English UI controls from end of text', () => {
  const raw = 'This is a great app!LikeReplyShare2';
  const result = cleanFacebookText(raw, '');
  assert.equal(result, 'This is a great app!');
});

test('strips UI controls with dot separators', () => {
  const raw = 'Good feedback.Thích · Trả lời · Chia sẻ · 1';
  const result = cleanFacebookText(raw, '');
  assert.equal(result, 'Good feedback.');
});

test('strips partial UI control pairs (ThíchTrả lời)', () => {
  const raw = 'Vừa thương vừa mắc cười ThíchTrả lời';
  const result = cleanFacebookText(raw, '');
  assert.equal(result, 'Vừa thương vừa mắc cười');
});

test('strips multi-action UI tail with translation and edited flag', () => {
  const raw = 'great idea ThíchTrả lờiXem bản dịchChia sẻĐã chỉnh sửa';
  const result = cleanFacebookText(raw, '');
  assert.equal(result, 'great idea');
});

test('preserves legitimate user text containing UI-like words in middle and end', () => {
  // "Thích" (like) appears in the middle of legitimate text — must NOT be stripped
  const raw1 = 'Tôi thích ứng dụng này vì nó rất tiện lợi';
  assert.equal(cleanFacebookText(raw1, ''), 'Tôi thích ứng dụng này vì nó rất tiện lợi');

  // "thích" at the end of sentence — must NOT be stripped
  const raw2 = 'App này tôi rất thích';
  assert.equal(cleanFacebookText(raw2, ''), 'App này tôi rất thích');

  const raw3 = 'I really like';
  assert.equal(cleanFacebookText(raw3, ''), 'I really like');
});

test('strips leading badge/follow prefixes', () => {
  const raw = '· Theo dõiHay quá';
  const result = cleanFacebookText(raw, '');
  assert.equal(result, 'Hay quá');
});

// --- Regression: author + timestamp prefix stripping ---

test('strips author name and timestamp prefix from comment text', () => {
  const raw = 'Thái Duy Anh  · 9 tuầnVẫn là app thu chi mà có đầu tư.ThíchTrả lờiChia sẻ1';
  const result = cleanFacebookText(raw, 'Thái Duy Anh');
  assert.equal(result, 'Vẫn là app thu chi mà có đầu tư.');
});

test('strips verified account author timestamp prefix', () => {
  const raw = 'Nguyen Xuan GiengTài khoản đã xác minh · 9 tuầnHà Bảo Khanh Love it!';
  const result = cleanFacebookText(raw, 'Nguyen Xuan Gieng');
  assert.equal(result, 'Hà Bảo Khanh Love it!');
});

test('strips English author timestamp prefix', () => {
  const raw = 'John Doe · 3 weeksGreat app!LikeReplyShare';
  const result = cleanFacebookText(raw, 'John Doe');
  assert.equal(result, 'Great app!');
});

// --- Regression: post text cleaning ---

test('cleanFacebookPostText strips dialog headers, Facebook noise, and public group share metadata', () => {
  const raw = 'Bài viết của Hà Bảo KhanhFacebookFacebookFacebookBuild in Public VNHà Bảo Khanh · 9 tuần · Đã chia sẻ với Nhóm công khai\nChào anh chị em BIP VN, đây là app Finny.\nTất cả cảm xúc:80 80 27 bình luận 6 lượt chia sẻ Thích Bình luận Chia sẻ';
  const result = cleanFacebookPostText(raw, 'Hà Bảo Khanh');
  assert.equal(result, 'Chào anh chị em BIP VN, đây là app Finny.');
});

// --- Expansion buttons & convergence tests ---

test('isExpandButtonText matches all common Vietnamese and English variations', () => {
  const cases = [
    'Xem thêm',
    'See more',
    'Xem thêm bình luận',
    'View more comments',
    'Xem thêm 3 bình luận',
    'View 3 more comments',
    'Hiển thị thêm bình luận',
    'Show more comments',
    'Xem các bình luận trước',
    'View previous comments',
    'Xem thêm phản hồi',
    'View more replies',
    'Xem thêm 3 phản hồi',
    'View 3 more replies',
    'Xem 2 phản hồi',
    'View 2 replies',
    'Xem thêm câu trả lời',
    'Xem thêm 5 câu trả lời',
    'Xem 2 câu trả lời',
    'Xem 4 câu trả lời',
    'Xem 1 câu trả lời',
    'Xem 3 câu trả lời khác',
    'Xem 2 bình luận khác',
    '2 phản hồi',
    '4 câu trả lời',
  ];

  for (const text of cases) {
    assert.equal(isExpandButtonText(text), true, `Expected "${text}" to match isExpandButtonText`);
  }

  // Non-expand controls must return false
  assert.equal(isExpandButtonText('Thích'), false);
  assert.equal(isExpandButtonText('Trả lời'), false);
  assert.equal(isExpandButtonText('Chia sẻ'), false);
  assert.equal(isExpandButtonText('Tất cả bình luận'), false);
  assert.equal(isExpandButtonText('Phù hợp nhất'), false);
  assert.equal(isExpandButtonText('Viết bình luận công khai…'), false);
});

test('isSuspiciousUnmatchedButton identifies unrecognized comment/reply buttons without false positives on standard controls', () => {
  assert.equal(isSuspiciousUnmatchedButton('Xem danh sách phản hồi chưa đọc'), true);
  assert.equal(isSuspiciousUnmatchedButton('Tải lại bình luận'), true);
  // Standard expand buttons already matched -> false
  assert.equal(isSuspiciousUnmatchedButton('Xem 2 câu trả lời'), false);
  // Standard UI buttons -> false
  assert.equal(isSuspiciousUnmatchedButton('Tất cả bình luận'), false);
  assert.equal(isSuspiciousUnmatchedButton('Phù hợp nhất'), false);
  assert.equal(isSuspiciousUnmatchedButton('Viết bình luận công khai…'), false);
});

// --- CLI Option Validation & Strictness tests ---

test('parseCli parses single query and discovery-only flags accurately', async () => {
  const { parseCli } = await import('../src/index.mjs');
  const result = parseCli(['collect', '--config', 'custom.json', '--query', 'quản lý chi tiêu', '--discovery-only']);
  assert.equal(result.command, 'collect');
  assert.equal(result.config, 'custom.json');
  assert.equal(result.query, 'quản lý chi tiêu');
  assert.equal(result.discoveryOnly, true);
  assert.equal(result.postUrl, null);
});

test('parseCli parses direct post-url and post-id flags accurately', async () => {
  const { parseCli } = await import('../src/index.mjs');
  const result = parseCli(['collect', '--post-url', 'https://www.facebook.com/groups/1569314343856132/permalink/2186835792103981/']);
  assert.equal(result.command, 'collect');
  assert.equal(result.postUrl, 'https://www.facebook.com/groups/1569314343856132/permalink/2186835792103981/');
  assert.equal(result.discoveryOnly, false);
});

test('parseCli throws on unknown CLI option', async () => {
  const { parseCli } = await import('../src/index.mjs');
  assert.throws(() => {
    parseCli(['collect', '--unknown-argument']);
  }, /Unknown option/);
});

test('parseCli throws on invalid --limit value', async () => {
  const { parseCli } = await import('../src/index.mjs');
  assert.throws(() => {
    parseCli(['collect', '--limit', 'invalid']);
  }, /Invalid --limit value/);
});

test('configured collection.maxPosts bounds the default deep collection while explicit limit overrides it', async () => {
  const { resolveCollectionPostLimit } = await import('../src/index.mjs');
  assert.equal(resolveCollectionPostLimit(null, 25, 80), 25);
  assert.equal(resolveCollectionPostLimit(3, 25, 80), 3);
  assert.equal(resolveCollectionPostLimit(null, 0, 80), 80);
});

test('parseCli parses from-discovery, resume, and output-dir options accurately', async () => {
  const { parseCli } = await import('../src/index.mjs');
  const result = parseCli([
    'collect',
    '--from-discovery',
    'output/run-123/discovery.json',
    '--resume',
    '--output-dir',
    'output/custom-run',
  ]);
  assert.equal(result.command, 'collect');
  assert.equal(result.fromDiscovery, 'output/run-123/discovery.json');
  assert.equal(result.resume, true);
  assert.equal(result.outputDir, 'output/custom-run');
});

