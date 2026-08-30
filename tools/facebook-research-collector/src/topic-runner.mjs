import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs as utilParseArgs } from 'node:util';
import { chromium } from 'playwright';
import { cleanFacebookPostText } from './core.mjs';
import {
  cacheCompleteRecord,
  findCorpusRecord,
  findNearDuplicate,
  isReusableRecord,
  loadCachedRecord,
  loadCorpusRegistry,
  parseFacebookPostIdentity,
  recordBodyPreflight,
  reuseRecordForCandidate,
  saveCorpusRegistry,
  upsertDiscovery,
  atomicWriteJson,
} from './corpus.mjs';
import { classifyFullBody, shouldCollectComments } from './topic-filter.mjs';

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function parseTopicCli(rawArgs = process.argv.slice(2)) {
  const { values, positionals } = utilParseArgs({
    args: rawArgs,
    allowPositionals: true,
    strict: true,
    options: {
      config: { type: 'string', default: 'config.json' },
      limit: { type: 'string' },
      query: { type: 'string' },
      'discovery-only': { type: 'boolean', default: false },
      'post-url': { type: 'string' },
      'post-id': { type: 'string' },
      'test-sort-switch': { type: 'boolean', default: false },
      'from-discovery': { type: 'string' },
      resume: { type: 'boolean', default: false },
      'output-dir': { type: 'string' },
      'corpus-index': { type: 'string' },
      'recollect-known': { type: 'boolean', default: false },
      'ignore-corpus': { type: 'boolean', default: false },
      'skip-topic-filter': { type: 'boolean', default: false },
    },
  });
  const command = positionals[0] ?? 'collect';
  let limit = null;
  if (values.limit) {
    limit = Number.parseInt(values.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) throw new Error(`Invalid --limit value: "${values.limit}". Must be a positive integer.`);
  }
  return {
    command,
    config: values.config ?? 'config.json',
    limit,
    query: values.query ?? null,
    discoveryOnly: Boolean(values['discovery-only']),
    postUrl: values['post-url'] ?? null,
    postId: values['post-id'] ?? null,
    testSortSwitch: Boolean(values['test-sort-switch']),
    fromDiscovery: values['from-discovery'] ?? null,
    resume: Boolean(values.resume),
    outputDir: values['output-dir'] ?? null,
    corpusIndex: values['corpus-index'] ?? null,
    recollectKnown: Boolean(values['recollect-known']),
    ignoreCorpus: Boolean(values['ignore-corpus']),
    skipTopicFilter: Boolean(values['skip-topic-filter']),
  };
}

async function loadConfig(configArg) {
  const configPath = path.resolve(process.cwd(), configArg);
  const parsed = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const baseDir = path.dirname(configPath);
  return {
    ...parsed,
    _configPath: configPath,
    _baseDir: baseDir,
    browser: { headless: false, profileDir: './profile', locale: 'vi-VN', ...parsed.browser },
    collection: { outputDir: './output', ...parsed.collection },
    corpus: {
      indexPath: './corpus/index.json',
      cacheDir: './corpus/posts',
      acceptedAcceptanceVersions: ['v0.8-strict-deep-collection-v2'],
      nearDuplicateMaxHamming: 4,
      ...parsed.corpus,
    },
    topicFilter: {
      enabled: true,
      queryBoost: 5,
      inTopicThreshold: 9,
      adjacentThreshold: 3,
      minBodyChars: 80,
      commentClasses: ['in-topic', 'adjacent', 'ambiguous'],
      preflightSettleMs: 900,
      betweenPostsMs: 450,
      anchors: [],
      negativeAnchors: [],
      ...parsed.topicFilter,
    },
    relevance: { threshold: 5, include: [], exclude: [], ...parsed.relevance },
  };
}

function resolveFromConfig(config, value) {
  return path.resolve(config._baseDir, value);
}

function buildLegacyArgs(cli, configPath, overrides = {}) {
  const args = ['collect', '--config', configPath];
  const values = { ...cli, ...overrides };
  if (values.limit) args.push('--limit', String(values.limit));
  if (values.query) args.push('--query', values.query);
  if (values.discoveryOnly) args.push('--discovery-only');
  if (values.postUrl) args.push('--post-url', values.postUrl);
  if (values.postId) args.push('--post-id', values.postId);
  if (values.testSortSwitch) args.push('--test-sort-switch');
  if (values.fromDiscovery) args.push('--from-discovery', values.fromDiscovery);
  if (values.resume) args.push('--resume');
  if (values.outputDir) args.push('--output-dir', values.outputDir);
  return args;
}

async function runLegacy(args) {
  const scriptPath = fileURLToPath(new URL('./index.mjs', import.meta.url));
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`Legacy collector failed (code=${code}, signal=${signal ?? 'none'})`));
    });
  });
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function bestClassification(results) {
  const rank = { 'in-topic': 4, adjacent: 3, ambiguous: 2, 'out-of-topic': 1 };
  return [...results].sort((a, b) => (rank[b.classification] ?? 0) - (rank[a.classification] ?? 0) || b.score - a.score)[0];
}

function classifyAgainstQueries(body, candidate, cli, config) {
  if (cli.skipTopicFilter || config.topicFilter.enabled === false) {
    return {
      classification: 'in-topic',
      score: 0,
      reason: 'topic-filter-disabled',
      perQuery: [],
    };
  }
  const queries = [...new Set([...(candidate.queries ?? []), ...(cli.query ? [cli.query] : [])].filter(Boolean))];
  if (queries.length === 0) queries.push('');
  const perQuery = queries.map((query) => ({
    query,
    ...classifyFullBody({ body, query, relevance: config.relevance, topicFilter: config.topicFilter }),
  }));
  return { ...bestClassification(perQuery), perQuery };
}

async function openPreflightContext(config) {
  const profileDir = resolveFromConfig(config, config.browser.profileDir);
  await fs.mkdir(profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: Boolean(config.browser.headless),
    locale: config.browser.locale ?? 'vi-VN',
    viewport: config.browser.viewport ?? null,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(8_000);
  return { context, page };
}

async function extractRootPostBody(page, candidate, config) {
  const targetUrl = candidate.canonicalUrl ?? candidate.discoveredUrls?.[0];
  if (!targetUrl) return { body: '', finalPageUrl: null, identity: null, rootFound: false };
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const postId = String(candidate.postId ?? '');
  await page.waitForFunction((id) => {
    if (!id) return document.querySelectorAll('[role="article"]').length > 0;
    return [...document.querySelectorAll('a[href]')].some((a) => {
      try {
        const u = new URL(a.href);
        return u.pathname.includes(id) && !u.searchParams.has('comment_id') && !u.searchParams.has('reply_comment_id');
      } catch { return false; }
    });
  }, postId, { timeout: 6_000 }).catch(() => {});
  const settleMs = Math.max(0, Number(config.topicFilter.preflightSettleMs ?? 900));
  if (settleMs) await page.waitForTimeout(settleMs);

  const result = await page.evaluate((id) => {
    const isVisible = (el) => Boolean(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].filter(isVisible);
    const roots = [...dialogs, ...document.querySelectorAll('[role="main"]'), document.body].filter(Boolean);
    const candidates = [];
    const seen = new Set();
    for (const root of roots) {
      for (const article of root.querySelectorAll('[role="article"]')) {
        if (seen.has(article) || !isVisible(article)) continue;
        seen.add(article);
        const text = (article.innerText || article.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const links = [...article.querySelectorAll('a[href]')];
        let cleanPostHref = null;
        let commentLinks = 0;
        for (const link of links) {
          try {
            const u = new URL(link.href);
            if (u.searchParams.has('comment_id') || u.searchParams.has('reply_comment_id')) {
              commentLinks += 1;
              continue;
            }
            if (id && u.pathname.includes(id) && /\/groups\/[^/]+\/(?:posts|permalink)\/\d+/i.test(u.pathname)) {
              cleanPostHref = link.href;
            }
          } catch {}
        }
        const aria = article.getAttribute('aria-label') || '';
        const nested = article.querySelectorAll('[role="article"]').length;
        let score = 0;
        if (cleanPostHref) score += 120;
        if (/comment|bình luận|reply|phản hồi/i.test(aria)) score -= 180;
        if (commentLinks > 0 && !cleanPostHref) score -= 80;
        if (nested === 0) score += 10;
        score += Math.min(text.length, 4000) / 4000;
        candidates.push({ score, text, cleanPostHref });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] ?? null;
  }, postId);

  const rawBody = result?.text ?? '';
  const body = cleanFacebookPostText(rawBody, '');
  const finalPageUrl = page.url();
  const identity = parseFacebookPostIdentity(finalPageUrl)
    ?? parseFacebookPostIdentity(result?.cleanPostHref)
    ?? parseFacebookPostIdentity(targetUrl);
  return {
    body,
    rawBodyChars: rawBody.length,
    finalPageUrl,
    identity,
    rootFound: Boolean(result),
    selectedScore: result?.score ?? null,
    capturedAt: new Date().toISOString(),
  };
}

async function loadBodyFromRecord(indexPath, record) {
  if (record?.body?.text) return record.body.text;
  if (record?.status === 'complete' && record.cacheFile) {
    const cached = await loadCachedRecord(indexPath, record);
    if (cached?.post?.text) return cached.post.text;
  }
  return '';
}

async function preflightDiscovery({ discovery, cli, config, registry, indexPath }) {
  const reusable = [];
  const toCollect = [];
  const excluded = [];
  const preflightRows = [];
  let browser = null;

  try {
    for (let i = 0; i < discovery.candidates.length; i += 1) {
      const original = discovery.candidates[i];
      const candidate = structuredClone(original);
      const queryList = [...new Set([...(candidate.queries ?? []), ...(cli.query ? [cli.query] : [])].filter(Boolean))];
      let record = cli.ignoreCorpus ? null : findCorpusRecord(registry, candidate);
      if (!cli.ignoreCorpus) record = upsertDiscovery(registry, candidate, queryList);

      let body = cli.ignoreCorpus ? '' : await loadBodyFromRecord(indexPath, record);
      const preflightSource = body ? 'corpus-body-cache' : 'browser';
      let browserResult = null;
      if (!body) {
        browser ??= await openPreflightContext(config);
        browserResult = await extractRootPostBody(browser.page, candidate, config).catch((error) => ({
          body: '',
          finalPageUrl: null,
          identity: null,
          rootFound: false,
          error: error.message,
          capturedAt: new Date().toISOString(),
        }));
        body = browserResult.body ?? '';
        if (browserResult.identity) {
          candidate.corpusKey = browserResult.identity.key;
          candidate.groupId = browserResult.identity.groupIdentifier ?? candidate.groupId;
          candidate.canonicalUrl = browserResult.identity.canonicalUrl ?? candidate.canonicalUrl;
          candidate.finalPageUrl = browserResult.finalPageUrl;
        }
      }

      const classification = classifyAgainstQueries(body, candidate, cli, config);
      const preflight = {
        ...(browserResult ?? {}),
        body,
        source: preflightSource,
        classification,
      };
      if (!cli.ignoreCorpus) {
        record = recordBodyPreflight(registry, candidate, preflight, cli.query ?? candidate.queries?.[0] ?? '');
      }

      const nearDuplicate = cli.ignoreCorpus || !body ? null : findNearDuplicate(registry, body, {
        maxHamming: Number(config.corpus.nearDuplicateMaxHamming ?? 4),
        excludeSourceKey: record?.sourceKey,
      });
      if (nearDuplicate) preflight.nearDuplicate = nearDuplicate;

      const collectComments = shouldCollectComments(classification.classification, config.topicFilter);
      let disposition = collectComments ? 'collect' : 'body-only-exclusion';
      let reusedRecord = null;

      if (collectComments && !cli.recollectKnown && !cli.ignoreCorpus && isReusableRecord(record, config.corpus.acceptedAcceptanceVersions)) {
        reusedRecord = await loadCachedRecord(indexPath, record);
        if (reusedRecord) disposition = 'reuse-complete';
      }

      if (disposition === 'reuse-complete') {
        reusable.push({ candidate, record, normalizedRecord: reuseRecordForCandidate(reusedRecord, candidate, cli.query) });
      } else if (disposition === 'collect') {
        toCollect.push({ ...candidate, preflight });
      } else {
        excluded.push({ candidate, preflight });
      }

      preflightRows.push({
        postId: candidate.postId,
        sourceKey: record?.sourceKey ?? candidate.corpusKey ?? candidate.key,
        canonicalUrl: candidate.canonicalUrl,
        queries: queryList,
        classification,
        disposition,
        nearDuplicate,
        bodyChars: body.length,
        preflightSource,
      });

      console.log(`[topic] ${i + 1}/${discovery.candidates.length} post=${candidate.postId} class=${classification.classification} disposition=${disposition}${nearDuplicate ? ` near=${nearDuplicate.kind}:${nearDuplicate.hammingDistance}` : ''}`);
      const pauseMs = Math.max(0, Number(config.topicFilter.betweenPostsMs ?? 450));
      if (browser && pauseMs && i + 1 < discovery.candidates.length) await browser.page.waitForTimeout(pauseMs);
    }
  } finally {
    if (browser) await browser.context.close();
  }

  return { reusable, toCollect, excluded, preflightRows };
}

function filteredDiscovery(original, candidates) {
  return {
    ...original,
    candidateCount: candidates.length,
    relevantCount: candidates.length,
    candidates: candidates.map(({ preflight, ...candidate }) => ({ ...candidate, preflight })),
    topicRunner: {
      sourceCandidateCount: original.candidates.length,
      filteredCandidateCount: candidates.length,
      generatedAt: new Date().toISOString(),
    },
  };
}

async function writeTopicResult({ runDir, sourceDiscovery, preflightResult, legacyReconciliation, newDataset, mergedDataset, cli }) {
  const newComplete = legacyReconciliation?.complete ?? newDataset.filter((record) => record?.extraction?.acceptanceVersion).length;
  const truncated = legacyReconciliation?.truncated ?? 0;
  const failed = legacyReconciliation?.failed ?? 0;
  const reconciliation = {
    topic: cli.query ?? (sourceDiscovery.queries?.length === 1 ? sourceDiscovery.queries[0] : 'multi-query'),
    discovered: sourceDiscovery.candidates.length,
    eligibleForComments: preflightResult.toCollect.length + preflightResult.reusable.length,
    fetched: preflightResult.toCollect.length,
    reused: preflightResult.reusable.length,
    bodyOnlyExcluded: preflightResult.excluded.length,
    complete: newComplete + preflightResult.reusable.length,
    truncated,
    failed,
    incomplete: truncated + failed,
    datasetRecords: mergedDataset.length,
    generatedAt: new Date().toISOString(),
  };
  await atomicWriteJson(path.join(runDir, 'reconciliation.json'), reconciliation);
  await atomicWriteJson(path.join(runDir, 'dataset.json'), mergedDataset);
  await atomicWriteJson(path.join(runDir, 'preflight.json'), preflightResult.preflightRows);
  await atomicWriteJson(path.join(runDir, 'exclusions.json'), preflightResult.excluded.map(({ candidate, preflight }) => ({
    postId: candidate.postId,
    canonicalUrl: candidate.canonicalUrl,
    queries: candidate.queries,
    classification: preflight.classification,
    nearDuplicate: preflight.nearDuplicate ?? null,
    body: preflight.body,
  })));
  await atomicWriteJson(path.join(runDir, 'TOPIC_RUN.json'), {
    status: 'completed',
    generatedAt: new Date().toISOString(),
    options: cli,
    reconciliation,
  });
  return reconciliation;
}

async function main() {
  const cli = parseTopicCli();
  const config = await loadConfig(cli.config);

  if (cli.command === 'login' || cli.postUrl || cli.postId) {
    await runLegacy(buildLegacyArgs(cli, config._configPath));
    return;
  }

  if (cli.command !== 'collect') throw new Error('Usage: node src/topic-runner.mjs collect|login [options]');

  if (cli.discoveryOnly) {
    await runLegacy(buildLegacyArgs(cli, config._configPath));
    return;
  }

  const outputBase = resolveFromConfig(config, config.collection.outputDir ?? './output');
  const runDir = cli.outputDir ? path.resolve(process.cwd(), cli.outputDir) : path.join(outputBase, timestampSlug());
  await fs.mkdir(runDir, { recursive: true });

  let discoveryPath;
  if (cli.fromDiscovery) {
    const requested = path.resolve(process.cwd(), cli.fromDiscovery);
    const stat = await fs.stat(requested);
    discoveryPath = stat.isDirectory() ? path.join(requested, 'discovery.json') : requested;
  } else {
    await runLegacy(buildLegacyArgs(cli, config._configPath, {
      discoveryOnly: true,
      outputDir: runDir,
      fromDiscovery: null,
      resume: false,
      limit: null,
    }));
    discoveryPath = path.join(runDir, 'discovery.json');
    if (await exists(discoveryPath)) await fs.copyFile(discoveryPath, path.join(runDir, 'discovery.original.json'));
  }

  const sourceDiscovery = JSON.parse(await fs.readFile(discoveryPath, 'utf8'));
  if (!Array.isArray(sourceDiscovery.candidates)) throw new Error(`Invalid discovery artifact: ${discoveryPath}`);

  const indexPath = cli.corpusIndex
    ? path.resolve(process.cwd(), cli.corpusIndex)
    : resolveFromConfig(config, config.corpus.indexPath);
  const cacheDir = resolveFromConfig(config, config.corpus.cacheDir);
  const registry = cli.ignoreCorpus ? { schemaVersion: 1, posts: {} } : await loadCorpusRegistry(indexPath);

  const preflightResult = await preflightDiscovery({ discovery: sourceDiscovery, cli, config, registry, indexPath });
  if (!cli.ignoreCorpus) await saveCorpusRegistry(indexPath, registry);

  const filteredPath = path.join(runDir, 'discovery.filtered.json');
  await atomicWriteJson(filteredPath, filteredDiscovery(sourceDiscovery, preflightResult.toCollect));

  let legacyReconciliation = { complete: 0, truncated: 0, failed: 0 };
  let newDataset = [];
  if (preflightResult.toCollect.length > 0) {
    await runLegacy(buildLegacyArgs(cli, config._configPath, {
      discoveryOnly: false,
      fromDiscovery: filteredPath,
      outputDir: runDir,
      query: null,
      postUrl: null,
      postId: null,
      limit: null,
    }));
    const legacyReconPath = path.join(runDir, 'reconciliation.json');
    if (await exists(legacyReconPath)) {
      legacyReconciliation = JSON.parse(await fs.readFile(legacyReconPath, 'utf8'));
      await fs.copyFile(legacyReconPath, path.join(runDir, 'collection-reconciliation.json'));
    }
    const datasetPath = path.join(runDir, 'dataset.json');
    if (await exists(datasetPath)) newDataset = JSON.parse(await fs.readFile(datasetPath, 'utf8'));
  }

  if (!cli.ignoreCorpus) {
    for (const normalizedRecord of newDataset) {
      const candidate = preflightResult.toCollect.find((item) => item.postId === normalizedRecord?.source?.postId);
      const status = legacyReconciliation?.postOutcomes?.find?.((item) => item.postId === normalizedRecord?.source?.postId)?.status;
      if (status && status !== 'complete') continue;
      await cacheCompleteRecord({ registry, indexPath, cacheDir, normalizedRecord, candidate });
    }
    await saveCorpusRegistry(indexPath, registry);
  }

  const merged = [...preflightResult.reusable.map((item) => item.normalizedRecord), ...newDataset];
  const seen = new Set();
  const mergedDataset = merged.filter((record) => {
    const key = record?.source?.key ?? `facebook:post:${record?.source?.postId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const reconciliation = await writeTopicResult({
    runDir,
    sourceDiscovery,
    preflightResult,
    legacyReconciliation,
    newDataset,
    mergedDataset,
    cli,
  });

  console.log('\n==================================================');
  console.log(`TOPIC RUN: ${reconciliation.topic}`);
  console.log('==================================================');
  console.log(`Discovered:        ${reconciliation.discovered}`);
  console.log(`Eligible comments: ${reconciliation.eligibleForComments}`);
  console.log(`Fetched:           ${reconciliation.fetched}`);
  console.log(`Reused corpus:     ${reconciliation.reused}`);
  console.log(`Body-only excluded:${reconciliation.bodyOnlyExcluded}`);
  console.log(`Complete:          ${reconciliation.complete}`);
  console.log(`Truncated:         ${reconciliation.truncated}`);
  console.log(`Failed:            ${reconciliation.failed}`);
  console.log(`Output:            ${runDir}`);
  console.log('==================================================');
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntry) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
