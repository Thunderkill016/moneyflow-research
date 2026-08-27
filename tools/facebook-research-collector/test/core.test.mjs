import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeFacebookPostUrl,
  cleanFacebookText,
  fingerprintComment,
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
