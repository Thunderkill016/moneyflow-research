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

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function cleanFacebookText(raw = '', author = '') {
  const authorNorm = normalizeWhitespace(author);
  let working = String(raw).replace(/\u00a0/g, ' ').trim();

  // Facebook sometimes exposes textContent without visual separators, producing
  // strings such as "Author · 9 tuầnBody...ThíchTrả lờiChia sẻ1".
  if (authorNorm) working = working.replace(new RegExp(`^${escapeRegExp(authorNorm)}\\s*`, 'i'), '');
  working = working
    .replace(/^\s*·?\s*(?:\d+\s*(?:phút|phut|giờ|gio|ngày|ngay|tuần|tuan|tháng|thang|năm|nam)|vừa xong|just now)\s*/i, '')
    .replace(/\s*(?:Thích|Like)\s*(?:Trả lời|Reply)\s*(?:Chia sẻ|Share)\s*\d*\s*$/i, '')
    .trim();

  const lines = working
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .filter((line) => !UI_ONLY_LINES.some((re) => re.test(line)));

  if (authorNorm && lines[0] === authorNorm) lines.shift();
  return normalizeWhitespace(lines.join('\n'));
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
