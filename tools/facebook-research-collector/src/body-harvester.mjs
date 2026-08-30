import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import {
  atomicWriteJson,
  loadCorpusRegistry,
  recordBodyPreflight,
  rekeyCorpusRecord,
  saveCorpusRegistry,
  upsertDiscovery,
} from './corpus.mjs';
import {
  bodyTrust,
  captureStrictRootBody,
  stampStrictBody,
} from './root-body.mjs';

const DEFAULT_CHECKPOINT_EVERY = 10;

export function parseHarvestCli(rawArgs = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: rawArgs,
    allowPositionals: true,
    strict: true,
    options: {
      config: { type: 'string', default: 'config.json' },
      'from-discovery': { type: 'string' },
      'output-dir': { type: 'string' },
      'corpus-index': { type: 'string' },
      limit: { type: 'string' },
    },
  });
  let limit = null;
  if (values.limit) {
    limit = Number.parseInt(values.limit, 10);
    if (!Number.isInteger(limit) || limit <= 0) throw new Error(`Invalid --limit value: ${values.limit}`);
  }
  return {
    command: positionals[0] ?? 'harvest',
    config: values.config ?? 'config.json',
    fromDiscovery: values['from-discovery'] ?? null,
    outputDir: values['output-dir'] ?? null,
    corpusIndex: values['corpus-index'] ?? null,
    limit,
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
    corpus: {
      indexPath: './corpus/index.json',
      acceptedAcceptanceVersions: ['v0.8-strict-deep-collection-v2'],
      ...parsed.corpus,
    },
    review: {
      bodyCaptureRetries: 2,
      bodyCaptureRetryDelayMs: 800,
      ...parsed.review,
    },
    harvest: {
      checkpointEvery: DEFAULT_CHECKPOINT_EVERY,
      ...parsed.harvest,
    },
  };
}

function resolveFromConfig(config, value) {
  return path.resolve(config._baseDir, value);
}

function explicitGroupAliasesForCandidate(candidate, config) {
  const observed = String(candidate?.groupIdentifier ?? candidate?.groupId ?? '').trim();
  if (!observed) return [];
  const configuredGroups = [
    ...(Array.isArray(config.groups) ? config.groups : []),
    ...(config.group ? [config.group] : []),
  ];
  const match = configuredGroups.find((group) => {
    const aliases = [group?.id, ...(Array.isArray(group?.aliases) ? group.aliases : [])]
      .filter(Boolean)
      .map((value) => String(value).trim().toLowerCase());
    return aliases.includes(observed.toLowerCase());
  });
  if (!match) return [observed];
  return [...new Set([match.id, ...(match.aliases ?? []), observed].filter(Boolean).map(String))];
}

export function selectHarvestCandidates(discovery, limit = null) {
  if (!Array.isArray(discovery?.candidates)) throw new Error('Invalid discovery artifact: candidates[] is required');
  const seen = new Set();
  const unique = [];
  for (const candidate of discovery.candidates) {
    const key = candidate?.corpusKey ?? candidate?.key ?? `${candidate?.groupIdentifier ?? candidate?.groupId ?? 'unknown'}:${candidate?.postId ?? 'unknown'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(structuredClone(candidate));
  }
  return Number.isInteger(limit) && limit > 0 ? unique.slice(0, limit) : unique;
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

async function captureWithRetries(page, candidate, config) {
  const attempts = Math.max(1, Number(config.review.bodyCaptureRetries ?? 2));
  const delayMs = Math.max(0, Number(config.review.bodyCaptureRetryDelayMs ?? 800));
  const errors = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const capture = await captureStrictRootBody(page, candidate, {
        attempt,
        allowedGroupIdentifiers: candidate.allowedGroupIdentifiers ?? [],
      });
      return { ...capture, attempts: attempt, priorErrors: errors };
    } catch (error) {
      errors.push({
        attempt,
        code: error?.code ?? null,
        message: error?.message ?? String(error),
        pageUrl: page.url(),
      });
      if (attempt < attempts) await page.waitForTimeout(delayMs);
    }
  }
  const error = new Error(`Unable to capture verified root body for post ${candidate.postId} after ${attempts} attempts`);
  error.code = 'ROOT_BODY_RETRIES_EXHAUSTED';
  error.attemptErrors = errors;
  throw error;
}

export async function harvestBodiesFromDiscovery({
  configPath = 'config.json',
  discoveryPath,
  outputDir = null,
  corpusIndex = null,
  limit = null,
} = {}) {
  if (!discoveryPath) throw new Error('discoveryPath is required');
  const config = await loadConfig(configPath);
  const sourceDiscoveryPath = path.resolve(process.cwd(), discoveryPath);
  const discovery = JSON.parse(await fs.readFile(sourceDiscoveryPath, 'utf8'));
  const candidates = selectHarvestCandidates(discovery, limit);
  const runDir = outputDir
    ? path.resolve(process.cwd(), outputDir)
    : path.dirname(sourceDiscoveryPath);
  await fs.mkdir(runDir, { recursive: true });
  const indexPath = corpusIndex
    ? path.resolve(process.cwd(), corpusIndex)
    : resolveFromConfig(config, config.corpus.indexPath);
  const registry = await loadCorpusRegistry(indexPath);
  const pending = [];
  let cacheHits = 0;

  for (const candidate of candidates) {
    candidate.allowedGroupIdentifiers = explicitGroupAliasesForCandidate(candidate, config);
    const record = upsertDiscovery(registry, candidate, candidate.queries ?? []);
    const trust = bodyTrust(record, config.corpus.acceptedAcceptanceVersions);
    if (trust.trusted) cacheHits += 1;
    else pending.push({ candidate, record, priorTrust: trust });
  }
  await saveCorpusRegistry(indexPath, registry);

  const statePath = path.join(runDir, 'BODY_HARVEST_RUN.json');
  const resolvedDiscoveryPath = path.join(runDir, 'discovery.harvested.json');
  const failures = [];
  let captured = 0;
  let browser = null;
  const startedAt = new Date().toISOString();
  const checkpointEvery = Math.max(1, Number(config.harvest.checkpointEvery ?? DEFAULT_CHECKPOINT_EVERY));

  const checkpoint = async (status, current = null) => {
    await atomicWriteJson(statePath, {
      status,
      startedAt,
      updatedAt: new Date().toISOString(),
      discoveryCandidates: discovery.candidates.length,
      scopeCandidates: candidates.length,
      bodyCacheHits: cacheHits,
      bodyCaptureNeeded: pending.length,
      capturedBodies: captured,
      failures: failures.length,
      remaining: Math.max(0, pending.length - captured - failures.length),
      current,
      failureRows: failures,
      resolvedDiscoveryPath,
    });
  };

  const writeResolvedDiscovery = async () => {
    await atomicWriteJson(resolvedDiscoveryPath, {
      ...discovery,
      schemaVersion: discovery.schemaVersion ?? 2,
      generatedAt: new Date().toISOString(),
      sourceDiscoveryPath,
      candidateCount: candidates.length,
      candidates,
    });
  };

  await checkpoint(pending.length ? 'harvesting' : 'completed');
  if (!pending.length) {
    await writeResolvedDiscovery();
    return { status: 'completed', candidates, cacheHits, captured, failures, runDir, indexPath, resolvedDiscoveryPath };
  }

  try {
    browser = await openContext(config);
    for (let index = 0; index < pending.length; index += 1) {
      const { candidate, record } = pending[index];
      console.log(`[body-harvest] ${index + 1}/${pending.length} post=${candidate.postId}`);
      try {
        const capture = await captureWithRetries(browser.page, candidate, config);
        if (capture.identity) {
          candidate.key = capture.identity.key;
          candidate.corpusKey = capture.identity.key;
          candidate.groupId = capture.identity.groupIdentifier ?? candidate.groupId;
          candidate.groupIdentifier = capture.identity.groupIdentifier ?? candidate.groupIdentifier;
          candidate.canonicalUrl = capture.identity.canonicalUrl ?? candidate.canonicalUrl;
          rekeyCorpusRecord(registry, record, capture.identity.key, { resetUntrustedCache: true });
        }
        const currentRecord = recordBodyPreflight(registry, candidate, {
          body: capture.body,
          capturedAt: capture.capturedAt,
          finalPageUrl: capture.finalPageUrl,
          identity: capture.identity,
        }, null);
        stampStrictBody(currentRecord, capture.validation);
        await saveCorpusRegistry(indexPath, registry);
        captured += 1;
        if (captured % checkpointEvery === 0 || index === pending.length - 1) {
          await writeResolvedDiscovery();
          await checkpoint('harvesting', { postId: candidate.postId, outcome: 'captured' });
        }
      } catch (error) {
        failures.push({
          postId: String(candidate.postId),
          sourceKey: candidate.corpusKey ?? candidate.key ?? null,
          code: error?.code ?? null,
          message: error?.message ?? String(error),
          attempts: error?.attemptErrors ?? [],
        });
        await writeResolvedDiscovery();
        await checkpoint('harvesting-with-errors', { postId: candidate.postId, outcome: 'failed' });
      }
    }
  } finally {
    await browser?.context.close();
  }

  const status = failures.length ? 'completed-with-errors' : 'completed';
  await writeResolvedDiscovery();
  await checkpoint(status);
  return { status, candidates, cacheHits, captured, failures, runDir, indexPath, resolvedDiscoveryPath };
}

async function main() {
  const cli = parseHarvestCli();
  if (cli.command !== 'harvest') throw new Error('Usage: body-harvester.mjs harvest --from-discovery <path> [options]');
  if (!cli.fromDiscovery) throw new Error('--from-discovery is required');
  const result = await harvestBodiesFromDiscovery({
    configPath: cli.config,
    discoveryPath: cli.fromDiscovery,
    outputDir: cli.outputDir,
    corpusIndex: cli.corpusIndex,
    limit: cli.limit,
  });
  console.log(`[body-harvest] ${result.status} scope=${result.candidates.length} cacheHits=${result.cacheHits} captured=${result.captured} failures=${result.failures.length}`);
  console.log(`[body-harvest] resolved-discovery=${result.resolvedDiscoveryPath}`);
  if (result.failures.length) process.exitCode = 1;
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntry) main().catch((error) => { console.error(error?.stack ?? error); process.exitCode = 1; });
