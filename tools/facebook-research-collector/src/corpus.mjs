import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const CORPUS_SCHEMA_VERSION = 1;

function normalizeWhitespace(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeForFingerprint(value = '') {
  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

export function hashText(value = '') {
  return crypto.createHash('sha256').update(normalizeForFingerprint(value)).digest('hex');
}

function tokenFeatures(value = '') {
  const words = normalizeForFingerprint(value)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 2);
  const features = [...words];
  for (let i = 0; i + 1 < words.length; i += 1) features.push(`${words[i]}_${words[i + 1]}`);
  return features;
}

export function simHash64(value = '') {
  const features = tokenFeatures(value);
  if (features.length === 0) return null;
  const counts = new Map();
  for (const feature of features) counts.set(feature, (counts.get(feature) ?? 0) + 1);
  const vector = new Array(64).fill(0);
  for (const [feature, weight] of counts.entries()) {
    const digest = crypto.createHash('sha256').update(feature).digest();
    const bits = digest.readBigUInt64BE(0);
    for (let i = 0; i < 64; i += 1) {
      const bit = (bits >> BigInt(i)) & 1n;
      vector[i] += bit === 1n ? weight : -weight;
    }
  }
  let result = 0n;
  for (let i = 0; i < 64; i += 1) {
    if (vector[i] >= 0) result |= 1n << BigInt(i);
  }
  return result.toString(16).padStart(16, '0');
}

export function hammingDistance64(a, b) {
  if (!a || !b) return null;
  let x;
  try {
    x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  } catch {
    return null;
  }
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

export function parseFacebookPostIdentity(input) {
  if (!input) return null;
  let url;
  try {
    url = new URL(input, 'https://www.facebook.com');
  } catch {
    return null;
  }
  if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return null;
  const pathValue = url.pathname.replace(/\/+$/, '');
  const pathMatch = pathValue.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)$/i);
  let groupIdentifier = pathMatch?.[1] ?? null;
  let postId = pathMatch?.[2] ?? null;
  if (!postId) {
    const multi = url.searchParams.get('multi_permalinks');
    const groupMatch = pathValue.match(/^\/groups\/([^/]+)/i);
    if (multi && /^\d+$/.test(multi) && groupMatch?.[1]) {
      postId = multi;
      groupIdentifier = groupMatch[1];
    }
  }
  if (!postId) return null;
  return {
    platform: 'facebook',
    postId,
    groupIdentifier,
    key: groupIdentifier ? `facebook:${groupIdentifier}:${postId}` : `facebook:post:${postId}`,
    canonicalUrl: groupIdentifier
      ? `https://www.facebook.com/groups/${groupIdentifier}/permalink/${postId}/`
      : url.toString(),
  };
}

export function emptyRegistry() {
  return {
    schemaVersion: CORPUS_SCHEMA_VERSION,
    updatedAt: null,
    posts: {},
  };
}

export async function loadCorpusRegistry(indexPath) {
  try {
    const parsed = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    if (parsed?.schemaVersion !== CORPUS_SCHEMA_VERSION || typeof parsed.posts !== 'object' || !parsed.posts) {
      throw new Error(`Unsupported corpus index schema at ${indexPath}`);
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyRegistry();
    throw error;
  }
}

export async function atomicWriteJson(filePath, value) {
  return atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function atomicWriteFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  let handle;
  try {
    handle = await fs.open(tempPath, 'wx');
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle?.close();
  }
  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

export async function saveCorpusRegistry(indexPath, registry) {
  registry.updatedAt = new Date().toISOString();
  await atomicWriteJson(indexPath, registry);
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

export function findCorpusRecord(registry, candidate) {
  if (!candidate) return null;
  const directKeys = [candidate.corpusKey, candidate.key].filter(Boolean);
  for (const key of directKeys) {
    if (registry.posts[key]) return registry.posts[key];
  }
  // A post id alone is not a reusable source identity. Treating a unique local
  // match as an alias can silently merge provenance from a different group.
  // Configured aliases may authorize browser validation, but the final observed
  // group-plus-post key remains the corpus reuse boundary.
  return null;
}

export function isReusableRecord(record, acceptedAcceptanceVersions = []) {
  if (!record || record.status !== 'complete' || !record.cacheFile) return false;
  if (acceptedAcceptanceVersions.length === 0) return true;
  return acceptedAcceptanceVersions.includes(record.acceptanceVersion);
}

export function upsertDiscovery(registry, candidate, queries = [], now = new Date().toISOString()) {
  const existing = findCorpusRecord(registry, candidate);
  const sourceKey = existing?.sourceKey ?? candidate.corpusKey ?? candidate.key ?? `facebook:post:${candidate.postId}`;
  const record = existing ?? {
    sourceKey,
    status: 'seen',
    firstSeenAt: now,
    source: {
      platform: 'facebook',
      postId: candidate.postId ?? null,
      groupIdentifier: candidate.groupId ?? candidate.groupIdentifier ?? null,
      canonicalUrl: candidate.canonicalUrl ?? null,
    },
    queries: [],
    discoveredUrls: [],
    topicClassifications: {},
  };
  record.lastSeenAt = now;
  record.queries = uniqueStrings([...(record.queries ?? []), ...queries, ...(candidate.queries ?? [])]);
  record.discoveredUrls = uniqueStrings([...(record.discoveredUrls ?? []), ...(candidate.discoveredUrls ?? [])]);
  if (candidate.canonicalUrl) record.source.canonicalUrl = candidate.canonicalUrl;
  if (candidate.groupId || candidate.groupIdentifier) {
    record.source.groupIdentifier = candidate.groupId ?? candidate.groupIdentifier;
  }
  registry.posts[sourceKey] = record;
  return record;
}

export function recordBodyPreflight(registry, candidate, preflight, query) {
  const record = upsertDiscovery(registry, candidate, query ? [query] : []);
  const body = preflight.body ?? '';
  record.body = {
    capturedAt: preflight.capturedAt ?? new Date().toISOString(),
    finalPageUrl: preflight.finalPageUrl ?? null,
    contentHash: hashText(body),
    simHash64: simHash64(body),
    text: body,
  };
  if (preflight.identity) {
    record.source = {
      ...record.source,
      ...preflight.identity,
      canonicalUrl: preflight.identity.canonicalUrl ?? record.source.canonicalUrl,
    };
  }
  if (query && preflight.classification) {
    record.topicClassifications ??= {};
    record.topicClassifications[query] = preflight.classification;
  }
  return record;
}

export function findNearDuplicate(registry, body, { maxHamming = 4, minChars = 120, excludeSourceKey = null } = {}) {
  const normalized = normalizeForFingerprint(body);
  if (normalized.length < minChars) return null;
  const exactHash = hashText(normalized);
  const sim = simHash64(normalized);
  let best = null;
  for (const [sourceKey, record] of Object.entries(registry.posts)) {
    if (sourceKey === excludeSourceKey || !record?.body) continue;
    if (record.body.contentHash === exactHash) {
      return { sourceKey, kind: 'exact-content', hammingDistance: 0 };
    }
    const distance = hammingDistance64(sim, record.body.simHash64);
    if (distance == null || distance > maxHamming) continue;
    if (!best || distance < best.hammingDistance) {
      best = { sourceKey, kind: 'near-content', hammingDistance: distance };
    }
  }
  return best;
}

function cacheNameForSourceKey(sourceKey) {
  return `${crypto.createHash('sha256').update(sourceKey).digest('hex')}.json`;
}

export async function cacheCompleteRecord({ registry, indexPath, cacheDir, normalizedRecord, candidate }) {
  const sourceKey = candidate?.corpusKey ?? normalizedRecord?.source?.key ?? candidate?.key ?? `facebook:post:${normalizedRecord?.source?.postId}`;
  const cacheFile = path.join(cacheDir, cacheNameForSourceKey(sourceKey));
  await atomicWriteJson(cacheFile, normalizedRecord);
  const relativeCache = path.relative(path.dirname(indexPath), cacheFile);
  const record = upsertDiscovery(registry, {
    ...candidate,
    key: sourceKey,
    postId: normalizedRecord?.source?.postId ?? candidate?.postId,
    canonicalUrl: normalizedRecord?.source?.canonicalUrl ?? candidate?.canonicalUrl,
    discoveredUrls: normalizedRecord?.source?.discoveredUrls ?? candidate?.discoveredUrls,
    queries: normalizedRecord?.source?.discoveryQueries ?? candidate?.queries,
  });
  record.status = 'complete';
  record.acceptanceVersion = normalizedRecord?.extraction?.acceptanceVersion ?? null;
  record.cacheFile = relativeCache;
  record.commentCount = normalizedRecord?.comments?.length ?? 0;
  record.lastCapturedAt = normalizedRecord?.capturedAt ?? new Date().toISOString();
  const bodyText = normalizedRecord?.post?.text ?? '';
  record.body ??= {};
  record.body.contentHash = hashText(bodyText);
  record.body.simHash64 = simHash64(bodyText);
  record.body.text = bodyText;
  record.body.acceptanceVersion = normalizedRecord?.extraction?.bodyAcceptanceVersion ?? null;
  record.body.validation = normalizedRecord?.extraction?.rootValidation ?? null;
  return record;
}

export async function loadCachedRecord(indexPath, record) {
  if (!record?.cacheFile) return null;
  const cacheFile = path.resolve(path.dirname(indexPath), record.cacheFile);
  try {
    return JSON.parse(await fs.readFile(cacheFile, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function reuseRecordForCandidate(normalizedRecord, candidate, query) {
  const clone = structuredClone(normalizedRecord);
  clone.source ??= {};
  clone.source.discoveryQueries = uniqueStrings([
    ...(clone.source.discoveryQueries ?? []),
    ...(candidate?.queries ?? []),
    ...(query ? [query] : []),
  ]);
  clone.source.discoveredUrls = uniqueStrings([
    ...(clone.source.discoveredUrls ?? []),
    ...(candidate?.discoveredUrls ?? []),
  ]);
  clone.extraction ??= {};
  clone.extraction.reusedFromCorpus = true;
  clone.extraction.reusedAt = new Date().toISOString();
  return clone;
}
