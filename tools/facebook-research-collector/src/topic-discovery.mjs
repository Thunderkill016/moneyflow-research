import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { atomicWriteJson, parseFacebookPostIdentity } from './corpus.mjs';

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function normalizeWhitespace(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseDiscoveryCli(rawArgs = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: rawArgs,
    allowPositionals: true,
    strict: true,
    options: {
      config: { type: 'string', default: 'config.json' },
      query: { type: 'string' },
      'output-dir': { type: 'string' },
    },
  });
  return {
    command: positionals[0] ?? 'discover',
    config: values.config ?? 'config.json',
    query: values.query ?? null,
    outputDir: values['output-dir'] ?? null,
  };
}

export function resolveDiscoveryTargets(parsed, scope) {
  if (scope === 'topic') return [{ id: null, name: 'Facebook global Posts search' }];
  const configured = Array.isArray(parsed.groups) ? parsed.groups : [];
  const targets = configured
    .filter((group) => group && group.id)
    .map((group) => ({ id: String(group.id), name: group.name ?? String(group.id) }));
  if (!targets.length && parsed.group?.id) {
    targets.push({ id: String(parsed.group.id), name: parsed.group.name ?? String(parsed.group.id) });
  }
  if (!targets.length) throw new Error('discovery.scope="group" requires config.groups[] or config.group.id');
  return targets;
}

async function loadConfig(configArg, cliQuery = null) {
  const configPath = path.resolve(process.cwd(), configArg);
  const parsed = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const baseDir = path.dirname(configPath);
  const queries = cliQuery ? [cliQuery] : parsed.queries;
  if (!Array.isArray(queries) || queries.length === 0) throw new Error('config.queries must contain at least one query');
  const scope = parsed.discovery?.scope ?? 'group';
  if (!['topic', 'group'].includes(scope)) throw new Error(`Unsupported discovery.scope: ${scope}`);
  const discoveryTargets = resolveDiscoveryTargets(parsed, scope);
  return {
    ...parsed,
    _configPath: configPath,
    _baseDir: baseDir,
    queries,
    discoveryTargets,
    browser: { headless: false, profileDir: './profile', locale: 'vi-VN', ...parsed.browser },
    collection: { outputDir: './output', ...parsed.collection },
    discovery: {
      scope,
      safetyCapRounds: 150,
      scrollPixels: 1400,
      stableBottomRounds: 3,
      bottomTolerancePx: 100,
      settleMs: 700,
      maxCandidatesPerQuery: 500,
      ...parsed.discovery,
    },
  };
}

function resolveFromConfig(config, value) {
  return path.resolve(config._baseDir, value);
}

export function buildSearchUrl({ scope = 'group', groupId = null, query }) {
  if (scope === 'group') {
    if (!groupId) throw new Error('groupId is required for group-scoped discovery');
    return `https://www.facebook.com/groups/${encodeURIComponent(groupId)}/search/?q=${encodeURIComponent(query)}`;
  }
  return `https://www.facebook.com/search/posts/?q=${encodeURIComponent(query)}`;
}

function permalinkLikelihood(link) {
  const label = normalizeWhitespace(`${link.text ?? ''} ${link.ariaLabel ?? ''}`);
  let score = 0;
  if (/\/(?:posts|permalink)\/\d+/i.test(link.href ?? '')) score += 4;
  if (/\b(?:vừa xong|just now|\d+\s*(?:giây|phút|giờ|ngày|tuần|tháng|năm|s|m|h|d|w))\b/i.test(label)) score += 8;
  if (/^\d{1,2}[/:.-]\d{1,2}/.test(label)) score += 5;
  if (!label) score += 1;
  return score;
}

function highlightKind(href = '') {
  try {
    const url = new URL(href, 'https://www.facebook.com');
    if (url.searchParams.has('reply_comment_id')) return 'reply-comment-highlight';
    if (url.searchParams.has('comment_id')) return 'comment-highlight';
  } catch {}
  return 'clean-post-link';
}

function highlightPenalty(kind) {
  if (kind === 'reply-comment-highlight') return -3;
  if (kind === 'comment-highlight') return -1;
  return 0;
}

async function extractSearchResultCards(page) {
  return page.evaluate(() => {
    const visible = (el) => Boolean(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    const articles = [...document.querySelectorAll('[role="article"]')].filter(visible);
    return articles.map((article, articleIndex) => {
      const preview = (article.innerText || article.textContent || '').replace(/\s+/g, ' ').trim();
      const links = [...article.querySelectorAll('a[href]')].map((a) => ({
        href: a.href,
        text: (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim(),
        ariaLabel: a.getAttribute('aria-label') || '',
      }));
      return { articleIndex, preview: preview.slice(0, 12000), links };
    });
  });
}

export function selectCardPost(card) {
  const byIdentity = new Map();
  for (const link of card.links ?? []) {
    if (!link.href) continue;
    const identity = parseFacebookPostIdentity(link.href);
    if (!identity?.postId || !identity?.groupIdentifier) continue;
    const kind = highlightKind(link.href);
    const existing = byIdentity.get(identity.key);
    const candidate = {
      identity,
      link,
      sourceLinkKind: kind,
      score: permalinkLikelihood(link) + highlightPenalty(kind),
    };
    if (!existing || candidate.score > existing.score) byIdentity.set(identity.key, candidate);
  }
  const ranked = [...byIdentity.values()].sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;
  const best = ranked[0];
  return {
    ...best,
    alternativePostKeys: ranked.slice(1).map((item) => item.identity.key),
  };
}

async function scrollMetrics(page) {
  return page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    const scrollTop = root.scrollTop || window.scrollY || 0;
    const scrollHeight = root.scrollHeight || document.documentElement.scrollHeight || 0;
    const clientHeight = root.clientHeight || window.innerHeight || 0;
    return {
      scrollTop,
      scrollHeight,
      clientHeight,
      maxScrollTop: Math.max(0, scrollHeight - clientHeight),
      remainingPx: Math.max(0, scrollHeight - clientHeight - scrollTop),
    };
  });
}

async function discoverQuery(page, config, query, globalCandidates, target) {
  const scope = config.discovery.scope;
  const groupId = scope === 'group' ? target?.id ?? null : null;
  const url = buildSearchUrl({ scope, groupId, query });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(Math.max(250, Number(config.discovery.settleMs ?? 700)));

  const roundLogs = [];
  let stableBottom = 0;
  let previousHeight = 0;
  let completionReason = 'safety-cap';
  let cardsObserved = 0;
  const maxRounds = Number(config.discovery.safetyCapRounds ?? 150);
  const cap = Number(config.discovery.maxCandidatesPerQuery ?? 500);
  const tolerance = Number(config.discovery.bottomTolerancePx ?? 100);
  const requiredStable = Number(config.discovery.stableBottomRounds ?? 3);
  const queryKeys = new Set();

  for (let round = 1; round <= maxRounds; round += 1) {
    const cards = await extractSearchResultCards(page);
    cardsObserved = Math.max(cardsObserved, cards.length);
    let newThisRound = 0;
    let ambiguousCards = 0;

    for (const card of cards) {
      const selected = selectCardPost(card);
      if (!selected) continue;
      if (selected.alternativePostKeys.length) ambiguousCards += 1;
      const { identity, link, alternativePostKeys, sourceLinkKind } = selected;
      if (scope === 'group' && identity.groupIdentifier !== groupId) continue;
      queryKeys.add(identity.key);
      const existing = globalCandidates.get(identity.key);
      if (!existing) {
        globalCandidates.set(identity.key, {
          platform: 'facebook',
          key: identity.key,
          corpusKey: identity.key,
          postId: identity.postId,
          groupId: identity.groupIdentifier,
          groupIdentifier: identity.groupIdentifier,
          canonicalUrl: identity.canonicalUrl,
          preview: normalizeWhitespace(card.preview),
          queries: new Set([query]),
          discoveredUrls: new Set([link.href]),
          provenance: {
            discoverySurface: scope === 'topic' ? 'facebook-global-posts-search' : 'facebook-group-search',
            discoveryScopeGroupId: groupId,
            discoveryScopeGroupName: target?.name ?? groupId,
            originalHref: link.href,
            originalHrefKind: sourceLinkKind,
            originalHrefHadCommentHighlight: sourceLinkKind !== 'clean-post-link',
            originalGroupIdentifier: identity.groupIdentifier,
            canonicalGroupIdentifier: identity.groupIdentifier,
            canonicalPostId: identity.postId,
            finalPageUrl: null,
            redirectChangedGroup: false,
            searchResultArticleIndex: card.articleIndex,
            alternativePostKeys,
          },
        });
        newThisRound += 1;
      } else {
        existing.queries.add(query);
        existing.discoveredUrls.add(link.href);
        if ((card.preview?.length ?? 0) > (existing.preview?.length ?? 0)) existing.preview = normalizeWhitespace(card.preview);
      }
      if (queryKeys.size >= cap) break;
    }

    const before = await scrollMetrics(page);
    const atBottomBefore = before.remainingPx <= tolerance;
    const heightStable = before.scrollHeight === previousHeight;
    if (atBottomBefore && newThisRound === 0 && heightStable) stableBottom += 1;
    else stableBottom = 0;

    roundLogs.push({
      round,
      groupId,
      groupName: target?.name ?? null,
      cards: cards.length,
      queryCandidateCount: queryKeys.size,
      newThisRound,
      ambiguousCards,
      ...before,
      atBottom: atBottomBefore,
      stableBottomRounds: stableBottom,
    });

    if (queryKeys.size >= cap) {
      completionReason = 'candidate-cap';
      break;
    }
    if (stableBottom >= requiredStable) {
      completionReason = 'bottom-stable';
      break;
    }

    previousHeight = before.scrollHeight;
    await page.evaluate((pixels) => window.scrollBy(0, pixels), Number(config.discovery.scrollPixels ?? 1400));
    await page.waitForTimeout(Math.max(250, Number(config.discovery.settleMs ?? 700)));
  }

  const finalMetrics = await scrollMetrics(page);
  const extractionFailed = completionReason === 'bottom-stable' && cardsObserved > 0 && queryKeys.size === 0;
  if (extractionFailed) completionReason = 'candidate-extraction-failed';
  return {
    query,
    scope,
    groupId,
    groupName: target?.name ?? null,
    searchUrl: url,
    candidateCount: queryKeys.size,
    cardsObserved,
    completionReason,
    completeness: completionReason === 'bottom-stable' ? 'complete' : (extractionFailed ? 'failed' : 'truncated'),
    finalMetrics: { ...finalMetrics, atBottom: finalMetrics.remainingPx <= tolerance },
    rounds: roundLogs,
  };
}

export async function runTopicDiscovery({ configPath = 'config.json', query = null, outputDir = null } = {}) {
  const config = await loadConfig(configPath, query);
  const runDir = outputDir
    ? path.resolve(process.cwd(), outputDir)
    : path.join(resolveFromConfig(config, config.collection.outputDir), timestampSlug());
  await fs.mkdir(runDir, { recursive: true });
  const profileDir = resolveFromConfig(config, config.browser.profileDir);
  await fs.mkdir(profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: Boolean(config.browser.headless),
    locale: config.browser.locale ?? 'vi-VN',
    viewport: config.browser.viewport ?? null,
  });
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(8_000);
  const candidates = new Map();
  const diagnostics = [];
  try {
    for (const q of config.queries) {
      for (const target of config.discoveryTargets) {
        diagnostics.push(await discoverQuery(page, config, q, candidates, target));
      }
    }
  } finally {
    await context.close();
  }

  const serialized = [...candidates.values()].map((candidate) => ({
    ...candidate,
    queries: [...candidate.queries],
    discoveredUrls: [...candidate.discoveredUrls],
  }));
  const discovery = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    discoveryScope: config.discovery.scope,
    discoverySurface: config.discovery.scope === 'topic' ? 'facebook-global-posts-search' : 'facebook-group-search',
    discoveryTargets: config.discoveryTargets,
    queries: config.queries,
    candidateCount: serialized.length,
    relevantCount: null,
    candidates: serialized,
    diagnostics,
  };
  await atomicWriteJson(path.join(runDir, 'discovery.json'), discovery);
  await atomicWriteJson(path.join(runDir, 'DISCOVERY_RUN.json'), {
    status: diagnostics.every((item) => item.completeness === 'complete') ? 'completed' : (diagnostics.some((item) => item.completeness === 'failed') ? 'failed' : 'truncated'),
    generatedAt: new Date().toISOString(),
    discoveryScope: config.discovery.scope,
    discoveryTargets: config.discoveryTargets,
    candidateCount: serialized.length,
    diagnostics: diagnostics.map(({ rounds, ...item }) => ({ ...item, roundCount: rounds.length })),
  });
  return { runDir, discovery };
}

async function main() {
  const cli = parseDiscoveryCli();
  if (!['discover', 'collect'].includes(cli.command)) throw new Error('Usage: topic-discovery.mjs discover [--config config.json] [--query topic] [--output-dir dir]');
  const result = await runTopicDiscovery({ configPath: cli.config, query: cli.query, outputDir: cli.outputDir });
  console.log(`[topic-discovery] scope=${result.discovery.discoveryScope} targets=${result.discovery.discoveryTargets.length} candidates=${result.discovery.candidateCount}`);
  console.log(`[topic-discovery] output=${result.runDir}`);
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isEntry) main().catch((error) => { console.error(error?.stack ?? error); process.exitCode = 1; });
