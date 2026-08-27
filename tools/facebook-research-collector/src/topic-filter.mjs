function normalizeWhitespace(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeForTopicMatch(value = '') {
  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

function searchableText(value = '') {
  return ` ${normalizeForTopicMatch(value).replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()} `;
}

function containsTerm(normalizedBody, term) {
  const haystack = searchableText(normalizedBody);
  const needle = searchableText(term);
  return needle.trim().length > 0 && haystack.includes(needle);
}

function matchWeightedRules(normalizedBody, rules = [], sign = 1) {
  let score = 0;
  const matched = [];
  for (const rule of rules) {
    const term = normalizeForTopicMatch(rule?.term ?? '');
    if (!term || !containsTerm(normalizedBody, term)) continue;
    const rawWeight = Number(rule?.weight ?? 1);
    const weight = Number.isFinite(rawWeight) ? Math.abs(rawWeight) : 1;
    score += sign * weight;
    matched.push({ term: rule.term, weight: sign * weight, strong: Boolean(rule.strong) });
  }
  return { score, matched };
}

export function classifyFullBody({ body = '', query = '', relevance = {}, topicFilter = {} }) {
  const normalizedBody = normalizeForTopicMatch(body);
  const normalizedQuery = normalizeForTopicMatch(query);
  const include = matchWeightedRules(normalizedBody, relevance.include ?? [], 1);
  const exclude = matchWeightedRules(normalizedBody, relevance.exclude ?? [], -1);
  const anchors = matchWeightedRules(normalizedBody, topicFilter.anchors ?? [], 1);
  const negatives = matchWeightedRules(normalizedBody, topicFilter.negativeAnchors ?? [], -1);
  const exactQuery = Boolean(normalizedQuery && containsTerm(normalizedBody, normalizedQuery));
  const queryBoost = exactQuery ? Number(topicFilter.queryBoost ?? 5) : 0;
  const score = include.score + exclude.score + anchors.score + negatives.score + queryBoost;
  const strongHits = anchors.matched.filter((item) => item.strong || item.weight >= 3).length;
  const inTopicThreshold = Number(topicFilter.inTopicThreshold ?? relevance.threshold ?? 5);
  const adjacentThreshold = Number(topicFilter.adjacentThreshold ?? Math.max(1, inTopicThreshold - 3));
  const minBodyChars = Number(topicFilter.minBodyChars ?? 80);

  let classification;
  if (exactQuery || (score >= inTopicThreshold && strongHits >= 1)) {
    classification = 'in-topic';
  } else if (score >= adjacentThreshold || strongHits >= 1) {
    classification = 'adjacent';
  } else if (normalizedBody.length < minBodyChars) {
    classification = 'ambiguous';
  } else {
    classification = 'out-of-topic';
  }

  return {
    classification,
    score,
    exactQuery,
    strongHits,
    thresholds: { inTopic: inTopicThreshold, adjacent: adjacentThreshold, minBodyChars },
    matched: [...include.matched, ...exclude.matched, ...anchors.matched, ...negatives.matched],
  };
}

export function shouldCollectComments(classification, topicFilter = {}) {
  const allowed = topicFilter.commentClasses ?? ['in-topic', 'adjacent', 'ambiguous'];
  return allowed.includes(classification);
}
