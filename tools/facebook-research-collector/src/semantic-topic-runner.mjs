import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { cleanFacebookPostText } from './core.mjs';
import {
  atomicWriteJson,
  cacheCompleteRecord,
  findCorpusRecord,
  isReusableRecord,
  loadCachedRecord,
  loadCorpusRegistry,
  parseFacebookPostIdentity,
  recordBodyPreflight,
  reuseRecordForCandidate,
  saveCorpusRegistry,
  upsertDiscovery,
} from './corpus.mjs';
import { classifyPostSemantically } from './semantic-classifier.mjs';

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseCli(rawArgs = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: rawArgs,
    allowPositionals: true,
    strict: true,
    options: {
      config: { type: 'string', default: 'config.json' },
      query: { type: 'string' },
      'discovery-only': { type: 'boolean', default: false },
      'from-discovery': { type: 'string' },
      'output-dir': { type: 'string' },
      'corpus-index': { type: 'string' },
      'recollect-known': { type: 'boolean', default: false },
      'post-url': { type: 'string' },
      'post-id': { type: 'string' },
      'test-sort-switch': { type: 'boolean', default: false },
    },
  });
  return {
    command: positionals[0] ?? 'collect',
    config: values.config ?? 'config.json',
    query: values.query ?? null,
    discoveryOnly: Boolean(values['discovery-only']),
    fromDiscovery: values['from-discovery'] ?? null,
    outputDir: values['output-dir'] ?? null,
    corpusIndex: values['corpus-index'] ?? null,
    recollectKnown: Boolean(values['recollect-known']),
    postUrl: values['post-url'] ?? null,
    postId: values['post-id'] ?? null,
    testSortSwitch: Boolean(values['test-sort-switch']),
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
      ...parsed.corpus,
    },
    semanticClassifier: {
      enabled: true,
      provider: 'openai',
      model: 'gpt-5.6-luna',
      apiKeyEnv: 'OPENAI_API_KEY',
      timeoutMs: 30_000,
      maxBodyChars: 24_000,
      ...parsed.semanticClassifier,
    },
  };
}

function resolveFromConfig(config, value) {
  return path.resolve(config._baseDir, value);
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

function legacyArgs(cli, configPath, overrides = {}) {
  const values = { ...cli, ...overrides };
  const args = ['collect', '--config', configPath];
  if (values.query) args.push('--query', values.query);
  if (values.discoveryOnly) args.push('--discovery-only');
  if (values.fromDiscovery) args.push('--from-discovery', values.fromDiscovery);
  if (values.outputDir) args.push('--output-dir', values.outputDir);
  if (values.postUrl) args.push('--post-url', values.postUrl);
  if (values.postId) args.push('--post-id', values.postId);
  if (values.testSortSwitch) args.push('--test-sort-switch');
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
      if (code === 0) resolve();
      else reject(new Error(`Legacy collector failed (code=${code}, signal=${signal ?? 'none'})`));
    });
  });
}

async function openContext(config) {
  const profileDir = resolveFromConfig(config, config.browser.profileDir);
  await fs.mkdir(profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: Boolean(config.browser.headless),
    locale: config.browser.locale ?? 'vi-VN',
    viewport: config.browser.viewport ?? null,
  });
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(8_000);
  return { context, page };
}

async function expandRootBody(page, postId) {
  const clicked = await page.evaluate((id) => {
    const articles = [...document.querySelectorAll('[role="article"]')];
    let root = null;
    let best = -Infinity;
    for (const article of articles) {
      const links = [...article.querySelectorAll('a[href]')];
      let cleanLink = false;
      let commentLinks = 0;
      for (const link of links) {
        try {
          const u = new URL(link.href);
          if (u.searchParams.has('comment_id') || u.searchParams.has('reply_comment_id')) { commentLinks += 1; continue; }
          if (u.pathname.includes(id) && /\/groups\/[^/]+\/(?:posts|permalink)\/\d+/i.test(u.pathname)) cleanLink = true;
        } catch {}
      }
      let score = cleanLink ? 100 : 0;
      if (commentLinks && !cleanLink) score -= 80;
      if (score > best) { best = score; root = article; }
    }
    if (!root) return 0;
    let count = 0;
    for (const el of root.querySelectorAll('button, [role="button"], div[tabindex]')) {
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^(?:xem thêm|see more)$/i.test(text)) {
        el.click();
        count += 1;
      }
    }
    return count;
  }, String(postId ?? ''));
  if (clicked) await page.waitForTimeout(350);
  return clicked;
}

async function extractRootBody(page, candidate) {
  const targetUrl = candidate.canonicalUrl ?? candidate.discoveredUrls?.[0];
  if (!targetUrl) return { body: '', finalPageUrl: null, identity: null, rootFound: false };
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const postId = String(candidate.postId ?? '');
  await page.waitForFunction((id) => [...document.querySelectorAll('a[href]')].some((a) => {
    try {
      const u = new URL(a.href);
      return u.pathname.includes(id) && !u.searchParams.has('comment_id') && !u.searchParams.has('reply_comment_id');
    } catch { return false; }
  }), postId, { timeout: 6_000 }).catch(() => {});
  await page.waitForTimeout(500);
  await expandRootBody(page, postId).catch(() => 0);

  const result = await page.evaluate((id) => {
    const visible = (el) => Boolean(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    const rows = [];
    for (const article of [...document.querySelectorAll('[role="article"]')].filter(visible)) {
      const text = (article.innerText || article.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      let cleanPostHref = null;
      let commentLinks = 0;
      for (const link of article.querySelectorAll('a[href]')) {
        try {
          const u = new URL(link.href);
          if (u.searchParams.has('comment_id') || u.searchParams.has('reply_comment_id')) { commentLinks += 1; continue; }
          if (id && u.pathname.includes(id) && /\/groups\/[^/]+\/(?:posts|permalink)\/\d+/i.test(u.pathname)) cleanPostHref = link.href;
        } catch {}
      }
      const aria = article.getAttribute('aria-label') || '';
      let score = cleanPostHref ? 120 : 0;
      if (/comment|bình luận|reply|phản hồi/i.test(aria)) score -= 180;
      if (commentLinks && !cleanPostHref) score -= 80;
      score += Math.min(text.length, 4000) / 4000;
      rows.push({ score, text, cleanPostHref });
    }
    rows.sort((a, b) => b.score - a.score);
    return rows[0] ?? null;
  }, postId);

  const rawBody = result?.text ?? '';
  const body = cleanFacebookPostText(rawBody, '');
  const finalPageUrl = page.url();
  const identity = parseFacebookPostIdentity(finalPageUrl)
    ?? parseFacebookPostIdentity(result?.cleanPostHref)
    ?? parseFacebookPostIdentity(targetUrl);
  return {
    body,
    finalPageUrl,
    identity,
    rootFound: Boolean(result),
    capturedAt: new Date().toISOString(),
  };
}

async function loadBody(indexPath, record) {
  if (record?.body?.text) return record.body.text;
  if (record?.status === 'complete' && record.cacheFile) {
    const cached = await loadCachedRecord(indexPath, record);
    return cached?.post?.text ?? '';
  }
  return '';
}

async function preflight({ discovery, cli, config, registry, indexPath }) {
  const relevantToCollect = [];
  const reusable = [];
  const rejected = [];
  const rows = [];
  let browser = null;

  try {
    for (let i = 0; i < discovery.candidates.length; i += 1) {
      const candidate = structuredClone(discovery.candidates[i]);
      const queries = [...new Set([...(candidate.queries ?? []), ...(cli.query ? [cli.query] : [])].filter(Boolean))];
      let record = findCorpusRecord(registry, candidate);
      record = upsertDiscovery(registry, candidate, queries);
      let body = await loadBody(indexPath, record);
      let bodySource = body ? 'corpus-body-cache' : 'browser';
      let browserResult = null;
      if (!body) {
        browser ??= await openContext(config);
        browserResult = await extractRootBody(browser.page, candidate);
        body = browserResult.body;
        if (browserResult.identity) {
          candidate.corpusKey = browserResult.identity.key;
          candidate.groupId = browserResult.identity.groupIdentifier ?? candidate.groupId;
          candidate.canonicalUrl = browserResult.identity.canonicalUrl ?? candidate.canonicalUrl;
          candidate.finalPageUrl = browserResult.finalPageUrl;
        }
      }

      const semantic = await classifyPostSemantically({
        body,
        query: cli.query ?? queries[0] ?? '',
        config,
      });
      const preflightInfo = {
        ...(browserResult ?? {}),
        body,
        bodySource,
        semantic,
      };
      record = recordBodyPreflight(registry, candidate, {
        body,
        capturedAt: browserResult?.capturedAt ?? new Date().toISOString(),
        finalPageUrl: browserResult?.finalPageUrl ?? record?.body?.finalPageUrl ?? null,
        identity: browserResult?.identity ?? null,
        classification: {
          classification: semantic.relevant ? 'in-topic' : 'out-of-topic',
          decision: semantic.relevant ? 'COLLECT' : 'SKIP',
          reason: semantic.reason,
          semantic,
        },
      }, cli.query ?? queries[0] ?? '');

      let disposition;
      let cached = null;
      if (!semantic.relevant) {
        disposition = 'SKIP';
        rejected.push({ candidate, preflight: preflightInfo });
      } else if (!cli.recollectKnown && isReusableRecord(record, config.corpus.acceptedAcceptanceVersions)) {
        cached = await loadCachedRecord(indexPath, record);
        if (cached) {
          disposition = 'REUSE';
          reusable.push({ candidate, normalizedRecord: reuseRecordForCandidate(cached, candidate, cli.query) });
        } else {
          disposition = 'COLLECT';
          relevantToCollect.push({ ...candidate, preflight: preflightInfo });
        }
      } else {
        disposition = 'COLLECT';
        relevantToCollect.push({ ...candidate, preflight: preflightInfo });
      }

      rows.push({
        postId: candidate.postId,
        canonicalUrl: candidate.canonicalUrl,
        queries,
        disposition,
        relevant: semantic.relevant,
        confidence: semantic.confidence,
        reason: semantic.reason,
        classifierModel: semantic.model,
        bodySource,
        bodyChars: body.length,
      });
      console.log(`[semantic] ${i + 1}/${discovery.candidates.length} post=${candidate.postId} decision=${disposition} relevant=${semantic.relevant} confidence=${semantic.confidence.toFixed(2)} reason=${semantic.reason}`);
    }
  } finally {
    if (browser) await browser.context.close();
  }
  return { relevantToCollect, reusable, rejected, rows };
}

function filteredDiscovery(source, candidates) {
  return {
    ...source,
    candidateCount: candidates.length,
    relevantCount: candidates.length,
    candidates: candidates.map(({ preflight, ...candidate }) => candidate),
    semanticGate: { sourceCandidateCount: source.candidates.length, filteredCandidateCount: candidates.length },
  };
}

async function main() {
  const cli = parseCli();
  const config = await loadConfig(cli.config);

  if (cli.command === 'login' || cli.postUrl || cli.postId) {
    await runLegacy(legacyArgs(cli, config._configPath));
    return;
  }
  if (cli.command !== 'collect') throw new Error('Usage: semantic-topic-runner.mjs collect|login [options]');
  if (cli.discoveryOnly) {
    await runLegacy(legacyArgs(cli, config._configPath));
    return;
  }

  const outputBase = resolveFromConfig(config, config.collection.outputDir);
  const runDir = cli.outputDir ? path.resolve(process.cwd(), cli.outputDir) : path.join(outputBase, timestampSlug());
  await fs.mkdir(runDir, { recursive: true });

  let discoveryPath;
  if (cli.fromDiscovery) {
    const requested = path.resolve(process.cwd(), cli.fromDiscovery);
    const stat = await fs.stat(requested);
    discoveryPath = stat.isDirectory() ? path.join(requested, 'discovery.json') : requested;
  } else {
    await runLegacy(legacyArgs(cli, config._configPath, {
      discoveryOnly: true,
      outputDir: runDir,
      fromDiscovery: null,
    }));
    discoveryPath = path.join(runDir, 'discovery.json');
  }

  const discovery = JSON.parse(await fs.readFile(discoveryPath, 'utf8'));
  if (!Array.isArray(discovery.candidates)) throw new Error(`Invalid discovery artifact: ${discoveryPath}`);

  const indexPath = cli.corpusIndex
    ? path.resolve(process.cwd(), cli.corpusIndex)
    : resolveFromConfig(config, config.corpus.indexPath);
  const cacheDir = resolveFromConfig(config, config.corpus.cacheDir);
  const registry = await loadCorpusRegistry(indexPath);
  const result = await preflight({ discovery, cli, config, registry, indexPath });
  await saveCorpusRegistry(indexPath, registry);

  const filteredPath = path.join(runDir, 'discovery.semantic-filtered.json');
  await atomicWriteJson(filteredPath, filteredDiscovery(discovery, result.relevantToCollect));
  await atomicWriteJson(path.join(runDir, 'semantic-decisions.json'), result.rows);
  await atomicWriteJson(path.join(runDir, 'exclusions.json'), result.rejected.map(({ candidate, preflight }) => ({
    postId: candidate.postId,
    canonicalUrl: candidate.canonicalUrl,
    queries: candidate.queries,
    semantic: preflight.semantic,
    body: preflight.body,
  })));

  let legacyRecon = { complete: 0, truncated: 0, failed: 0 };
  let newDataset = [];
  if (result.relevantToCollect.length) {
    await runLegacy(legacyArgs(cli, config._configPath, {
      discoveryOnly: false,
      fromDiscovery: filteredPath,
      outputDir: runDir,
      query: null,
    }));
    const reconPath = path.join(runDir, 'reconciliation.json');
    if (await exists(reconPath)) {
      legacyRecon = JSON.parse(await fs.readFile(reconPath, 'utf8'));
      await fs.copyFile(reconPath, path.join(runDir, 'collection-reconciliation.json'));
    }
    const datasetPath = path.join(runDir, 'dataset.json');
    if (await exists(datasetPath)) newDataset = JSON.parse(await fs.readFile(datasetPath, 'utf8'));
  }

  for (const normalizedRecord of newDataset) {
    const candidate = result.relevantToCollect.find((item) => item.postId === normalizedRecord?.source?.postId);
    const status = legacyRecon?.postOutcomes?.find?.((item) => item.postId === normalizedRecord?.source?.postId)?.status;
    if (status && status !== 'complete') continue;
    await cacheCompleteRecord({ registry, indexPath, cacheDir, normalizedRecord, candidate });
  }
  await saveCorpusRegistry(indexPath, registry);

  const merged = [...result.reusable.map((item) => item.normalizedRecord), ...newDataset];
  const seen = new Set();
  const dataset = merged.filter((record) => {
    const key = record?.source?.key ?? `facebook:post:${record?.source?.postId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const reconciliation = {
    topic: cli.query ?? (discovery.queries?.length === 1 ? discovery.queries[0] : 'multi-query'),
    discovered: discovery.candidates.length,
    semanticRelevant: result.relevantToCollect.length + result.reusable.length,
    semanticRejected: result.rejected.length,
    fetched: result.relevantToCollect.length,
    reused: result.reusable.length,
    complete: Number(legacyRecon.complete ?? newDataset.length) + result.reusable.length,
    truncated: Number(legacyRecon.truncated ?? 0),
    failed: Number(legacyRecon.failed ?? 0),
    datasetRecords: dataset.length,
    generatedAt: new Date().toISOString(),
  };
  await atomicWriteJson(path.join(runDir, 'dataset.json'), dataset);
  await atomicWriteJson(path.join(runDir, 'reconciliation.json'), reconciliation);
  await atomicWriteJson(path.join(runDir, 'TOPIC_RUN.json'), { status: 'completed', options: cli, reconciliation });

  console.log('\n==================================================');
  console.log(`SEMANTIC TOPIC RUN: ${reconciliation.topic}`);
  console.log('==================================================');
  console.log(`Discovered:         ${reconciliation.discovered}`);
  console.log(`Semantic relevant:  ${reconciliation.semanticRelevant}`);
  console.log(`Semantic rejected:  ${reconciliation.semanticRejected}`);
  console.log(`Fetched comments:   ${reconciliation.fetched}`);
  console.log(`Reused corpus:      ${reconciliation.reused}`);
  console.log(`Complete:           ${reconciliation.complete}`);
  console.log(`Output:             ${runDir}`);
  console.log('==================================================');
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntry) main().catch((error) => { console.error(error?.stack ?? error); process.exitCode = 1; });
