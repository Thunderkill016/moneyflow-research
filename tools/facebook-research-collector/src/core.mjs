import crypto from 'node:crypto';

export function normalizeWhitespace(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function normalizeForMatch(value = '') {
  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/gi, (m) => (m === 'Đ' ? 'D' : 'd'))
    .toLowerCase();
}

export function canonicalizeFacebookPostUrl(input, fallbackGroupId = null) {
  if (!input) return null;
  let url;
  try {
    url = new URL(input, 'https://www.facebook.com');
  } catch {
    return null;
  }

  if (!/^(www\.)?facebook\.com$/i.test(url.hostname)) return null;

  const path = url.pathname.replace(/\/+$/, '');
  const pathMatch = path.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)$/i);
  const pathGroupId = pathMatch?.[1] ?? null;
  let groupId = fallbackGroupId ?? pathGroupId;
  let postId = pathMatch?.[2] ?? null;

  if (!postId) {
    const multi = url.searchParams.get('multi_permalinks');
    if (multi && /^\d+$/.test(multi)) {
      postId = multi;
      const groupMatch = path.match(/^\/groups\/([^/]+)/i);
      groupId = fallbackGroupId ?? groupMatch?.[1] ?? groupId;
    }
  }

  if (!postId || !groupId) return null;
  const canonicalUrl = `https://www.facebook.com/groups/${groupId}/permalink/${postId}/`;
  return {
    groupId,
    postId,
    canonicalUrl,
    key: `facebook:${groupId}:${postId}`,
  };
}

/**
 * Returns true when `href` is a comment/reply permalink that happens to
 * contain `postId` in its path but is NOT the canonical post URL.
 *
 * Facebook comment timestamps link to:
 *   /groups/{slug}/posts/{postId}/?comment_id={commentId}
 *   /groups/{slug}/posts/{postId}/?comment_id=X&reply_comment_id=Y
 *
 * These match a naive "contains postId" check but must not be treated
 * as evidence that the surrounding article is the original post.
 */
export function isCommentPermalink(href, postId) {
  if (!href || !postId) return false;
  try {
    const url = new URL(href, 'https://www.facebook.com');
    if (!/facebook\.com$/i.test(url.hostname)) return false;
    // Must reference this post in its path
    if (!url.pathname.includes(postId)) return false;
    // It's a comment permalink if it carries comment_id or reply_comment_id
    return url.searchParams.has('comment_id') || url.searchParams.has('reply_comment_id');
  } catch {
    return false;
  }
}

export function scoreRelevance(text, relevance = {}) {
  const normalized = normalizeForMatch(text);
  let score = 0;
  const matched = [];
  const include = Array.isArray(relevance.include) ? relevance.include : [];
  const exclude = Array.isArray(relevance.exclude) ? relevance.exclude : [];

  for (const rule of include) {
    const term = normalizeForMatch(rule.term ?? '');
    if (!term || !normalized.includes(term)) continue;
    const weight = Number(rule.weight ?? 1);
    score += Number.isFinite(weight) ? weight : 1;
    matched.push({ term: rule.term, weight: Number.isFinite(weight) ? weight : 1, kind: 'include' });
  }

  for (const rule of exclude) {
    const term = normalizeForMatch(rule.term ?? '');
    if (!term || !normalized.includes(term)) continue;
    const weight = Math.abs(Number(rule.weight ?? 1));
    score -= Number.isFinite(weight) ? weight : 1;
    matched.push({ term: rule.term, weight: -(Number.isFinite(weight) ? weight : 1), kind: 'exclude' });
  }

  return {
    score,
    matched,
    threshold: Number(relevance.threshold ?? 5),
    relevant: score >= Number(relevance.threshold ?? 5),
  };
}

const UI_ONLY_LINES = [
  /^(thích|like)$/i,
  /^(trả lời|reply)$/i,
  /^(chia sẻ|share)$/i,
  /^(xem bản dịch|see translation)$/i,
  /^(đã chỉnh sửa|edited)$/i,
  /^\d+\s*(phản hồi|replies)$/i,
  /^(theo dõi|follow)$/i,
];

/**
 * Conservative trailing UI patterns to strip from end of lines.
 * Handles single or multi-button controls without destroying user sentences.
 */
const TRAILING_UI_PATTERNS = [
  // Pair/multi UI controls with optional separators and trailing count
  /(?:[·\s]+|(?<=[.!?…])|^)?(?:Thích|Like)[·\s]*(?:Trả lời|Reply)[·\s]*(?:Xem bản dịch|See translation)?[·\s]*(?:Chia sẻ|Share)?[·\s]*(?:Đã chỉnh sửa|Edited)?[·\s]*\d*$/i,
  /(?:[·\s]+|(?<=[.!?…])|^)?(?:Trả lời|Reply)[·\s]*(?:Xem bản dịch|See translation|Chia sẻ|Share|Đã chỉnh sửa|Edited)[·\s]*(?:Chia sẻ|Share)?[·\s]*(?:Đã chỉnh sửa|Edited)?[·\s]*\d*$/i,
  /(?:[·\s]+|(?<=[.!?…])|^)?(?:Xem bản dịch|See translation)[·\s]*(?:Chia sẻ|Share|Đã chỉnh sửa|Edited)[·\s]*(?:Đã chỉnh sửa|Edited)?[·\s]*\d*$/i,
  /(?:[·\s]+|(?<=[.!?…])|^)?(?:Chia sẻ|Share)[·\s]*(?:Đã chỉnh sửa|Edited)[·\s]*\d*$/i,
  // Middle-dot prefixed single action button: · Thích, · Trả lời, · Chia sẻ, · Đã chỉnh sửa
  /[·\s]*·[·\s]*(?:Thích|Like|Trả lời|Reply|Chia sẻ|Share|Xem bản dịch|See translation|Đã chỉnh sửa|Edited)[·\s]*\d*$/i,
];

/** Leading badges or actions like "· Theo dõi", "Tác giả", "Top fan" */
const LEADING_UI_PREFIX = /^(?:[·\s]*(?:Theo dõi|Follow|Tác giả|Author|Quản trị viên|Admin|Người kiểm duyệt|Moderator|Người đóng góp nổi bật|Top fan)[·\s]*)+/i;

/**
 * Trailing "Author · Ntimeunit" prefix that Facebook prepends to comment
 * text when innerText flattens the header into the body.
 * Example: "Thái Duy Anh · 9 tuần" or "Nguyen Xuan GiengTài khoản đã xác minh · 9 tuần"
 */
const AUTHOR_TIMESTAMP_PREFIX = /^(.+?)(?:\s*Tài khoản đã xác minh|\s*Verified account)?\s+·\s+\d+\s*(?:giây|phút|giờ|ngày|tuần|tháng|năm|second|minute|hour|day|week|month|year)s?/i;

export function cleanFacebookText(raw = '', author = '') {
  const authorNorm = normalizeWhitespace(author);
  let lines = String(raw)
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .filter((line) => !UI_ONLY_LINES.some((re) => re.test(line)));

  // Strip trailing UI controls from each line
  lines = lines.map((line) => {
    let cleaned = line;
    for (const pat of TRAILING_UI_PATTERNS) {
      if (pat.test(cleaned)) {
        cleaned = cleaned.replace(pat, '').trim();
      }
    }
    return cleaned;
  }).filter(Boolean);

  // Strip leading UI prefix like "· Theo dõi"
  lines = lines.map((line) => line.replace(LEADING_UI_PREFIX, '').trim()).filter(Boolean);

  // Strip author name prefix
  if (authorNorm && lines[0] === authorNorm) lines.shift();

  // Strip "Author · Ntimeunit" prefix from the first remaining line
  if (authorNorm && lines[0]) {
    const prefixMatch = lines[0].match(AUTHOR_TIMESTAMP_PREFIX);
    if (prefixMatch && normalizeWhitespace(prefixMatch[1]).includes(authorNorm)) {
      lines[0] = lines[0].slice(prefixMatch[0].length).trim();
      if (!lines[0]) lines.shift();
    }
  }

  return normalizeWhitespace(lines.join('\n'));
}

/**
 * Clean root post body text by stripping dialog header noise, privacy strings,
 * and trailing reaction bars before applying standard line cleanup.
 */
export function cleanFacebookPostText(raw = '', author = '') {
  let cleaned = String(raw);
  // Remove dialog header 'Bài viết của ...' / 'Post by ...'
  cleaned = cleaned.replace(/^Bài viết của .+?(?=(?:Facebook|Build|[A-Z]))/i, '');
  // Remove repeated Facebook branding words
  cleaned = cleaned.replace(/(?:Facebook)+/g, '');
  // Remove group header, obfuscated timestamp, and privacy metadata block
  cleaned = cleaned.replace(/^.*?(?:Đã chia sẻ với Nhóm công khai|Đã chia sẻ với nhóm công khai|Đã chia sẻ với Thành viên trong nhóm|Đã chia sẻ với công khai|Shared with Public group|Shared with Members).*?\n*/is, '');
  // Remove trailing reaction count and action controls on post body
  cleaned = cleaned.replace(/Tất cả cảm xúc:.*?$/is, '');
  // Remove trailing video player timestamps and photo album text
  cleaned = cleaned.replace(/\d+:\d+\s*\/\s*\d+:\d+.*$/is, '');
  cleaned = cleaned.replace(/Ảnh từ bài viết của.*$/is, '');
  return cleanFacebookText(cleaned, author);
}

export function fingerprintComment({ postKey, author = '', text = '', parentFingerprint = '' }) {
  const stable = [postKey, normalizeForMatch(author), normalizeForMatch(text), parentFingerprint].join('|');
  return crypto.createHash('sha256').update(stable).digest('hex');
}

export function uniqueBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}
