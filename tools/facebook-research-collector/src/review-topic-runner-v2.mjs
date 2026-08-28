import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import {
  atomicWriteJson,
  cacheCompleteRecord,
  findCorpusRecord,
  hashText,
  isReusableRecord,
  loadCachedRecord,
  loadCorpusRegistry,
  recordBodyPreflight,
  reuseRecordForCandidate,
  saveCorpusRegistry,
  upsertDiscovery,
} from './corpus.mjs';
import {
  ROOT_BODY_ACCEPTANCE_VERSION,
  bodyTrust,
  captureStrictRootBody,
  classificationTrust,
  stampStrictBody,
  strictCompleteRecordTrust,
} from './root-body.mjs';

const REVIEW_QUEUE_SCHEMA_VERSION = 2;

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function parseReviewCli(rawArgs = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: rawArgs,
    allowPositionals: true,
    strict: true,
    options: {
      config: { type: 'string', default: 'config.json' },
      query: { type: 'string' },
      'discovery-only': { type: 'boolean', default: false },
      'from-discovery': { type: 'string' },
      'from-review': { type: 'string' },
      decisions: { type: 'string' },
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
    fromReview: values['from-review'] ?? null,
    decisions: values.decisions ?? null,
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
      acceptedAcceptanceVersions: ['v0.8-strict-deep-collection-v1'],
      ...parsed.corpus,
    },
    review: {
      topicKey: 'personal-expense-management',
      topicLabel: 'quản lý chi tiêu / tài chính cá nhân',
      bodyCaptureRetries: 2,
      bodyCaptureRetryDelayMs: 800,
      ...parsed.review,
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

async function runLegacyCollector(args) {
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

async function runLegacyReview(args) {
  const scriptPath = fileURLToPath(new URL('./review-topic-runner.mjs', import.meta.url));
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Legacy review runner failed (code=${code}, signal=${signal ?? 'none'})`));
    });
  });
}

function delegatedArgs(cli) {
  const args = [cli.command, '--config', cli.config];
  if (cli.query) args.push('--query', cli.query);
  if (cli.discoveryOnly) args.push('--discovery-only');
  if (cli.fromDiscovery) args.push('--from-discovery', cli.fromDiscovery);
  if (cli.fromReview) args.push('--from-review', cli.fromReview);
  if (cli.decisions) args.push('--decisions', cli.decisions);
  if (cli.outputDir) args.push('--output-dir', cli.outputDir);
  if (cli.corpusIndex) args.push('--corpus-index', cli.corpusIndex);
  if (cli.recollectKnown) args.push('--recollect-known');
  if (cli.postUrl) args.push('--post-url', cli.postUrl);
  if (cli.postId) args.push('--post-id', cli.postId);
  if (cli.testSortSwitch) args.push('--test-sort-switch');
  return args;
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

async function extractRootBodyOnce(page, candidate, attempt) {
  return captureStrictRootBody(page, candidate, {
    attempt,
    allowedGroupIdentifiers: candidate.allowedGroupIdentifiers ?? [],
  });
}

async function extractRootBodyWithRetries(page, candidate, config) {
  const attempts = Math.max(1, Number(config.review.bodyCaptureRetries ?? 2));
  const delayMs = Math.max(0, Number(config.review.bodyCaptureRetryDelayMs ?? 800));
  const errors = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await extractRootBodyOnce(page, candidate, attempt);
      return { ...result, attempts: attempt, priorErrors: errors };
    } catch (error) {
      errors.push({
        attempt,
        code: error?.code ?? null,
        message: error?.message ?? String(error),
        selection: error?.selection ?? null,
        rootCount: error?.rootCount ?? null,
        pageUrl: page.url(),
      });
      if (attempt < attempts) await page.waitForTimeout(delayMs);
    }
  }
  const final = new Error(`Unable to capture verified root body for post ${candidate.postId} after ${attempts} attempts`);
  final.code = 'ROOT_BODY_RETRIES_EXHAUSTED';
  final.attemptErrors = errors;
  throw final;
}

async function loadTrustedBody(indexPath, record, acceptedVersions) {
  const trust = bodyTrust(record, acceptedVersions);
  if (!trust.trusted) return { trusted: false, trust, body: '', source: null, validation: null };
  if (trust.kind === 'complete-record') {
    const cached = await loadCachedRecord(indexPath, record);
    if (!cached) throw new Error(`Accepted complete corpus cache missing for ${record.sourceKey}`);
    const completeTrust = strictCompleteRecordTrust(cached, record?.source?.postId, record?.source?.groupIdentifier);
    if (!completeTrust.trusted) {
      throw new Error(`Accepted complete corpus cache is not strict evidence for ${record.sourceKey}: ${completeTrust.reason}`);
    }
    const body = cached?.post?.text ?? '';
    if (!body.trim()) throw new Error(`Accepted complete corpus cache has empty post body for ${record.sourceKey}`);
    return {
      trusted: true,
      trust,
      body,
      source: 'corpus-complete-cache',
      validation: {
        acceptanceVersion: `complete:${record.acceptanceVersion}`,
        rootIdentityVerified: true,
        targetPostId: record?.source?.postId ?? null,
        rootPostId: record?.source?.postId ?? null,
        targetGroupIdentifier: record?.source?.groupIdentifier ?? null,
        rootGroupIdentifier: record?.source?.groupIdentifier ?? null,
      },
    };
  }
  return {
    trusted: true,
    trust,
    body: record.body.text,
    source: 'corpus-strict-body-cache',
    validation: record.body.validation,
  };
}

function normalizedJudgment(value) {
  if (!value) return null;
  if (value.relevant === true || value.classification === 'in-topic') return { relevant: true, reason: value.reason ?? 'prior-assessor-judgment' };
  if (value.relevant === false || value.classification === 'out-of-topic') return { relevant: false, reason: value.reason ?? 'prior-assessor-judgment' };
  return null;
}

function priorJudgment(record, topicKey, acceptedVersions) {
  const classification = record?.topicClassifications?.[topicKey];
  const judgment = normalizedJudgment(classification);
  if (!judgment) return { judgment: null, trust: { trusted: false, reason: 'missing-or-invalid-classification' } };
  const trust = classificationTrust(record, classification, acceptedVersions);
  return { judgment: trust.trusted ? judgment : null, trust };
}

async function prepareReview({ discovery, cli, config, registry, indexPath, runDir }) {
  const queue = [];
  const alreadyJudged = [];
  const failures = [];
  const diagnostics = [];
  let browser = null;

  try {
    for (let i = 0; i < discovery.candidates.length; i += 1) {
      const candidate = structuredClone(discovery.candidates[i]);
      candidate.allowedGroupIdentifiers = explicitGroupAliasesForCandidate(candidate, config);
      const queries = [...new Set([...(candidate.queries ?? []), ...(cli.query ? [cli.query] : [])].filter(Boolean))];
      let record = upsertDiscovery(registry, candidate, queries);
      const beforeTrust = bodyTrust(record, config.corpus.acceptedAcceptanceVersions);
      let loaded;
      try {
        loaded = await loadTrustedBody(indexPath, record, config.corpus.acceptedAcceptanceVersions);
      } catch (error) {
        failures.push({ postId: candidate.postId, phase: 'load-trusted-body', message: error.message, code: error.code ?? null });
        diagnostics.push({ postId: candidate.postId, beforeTrust, failure: failures.at(-1) });
        continue;
      }

      let body = loaded.body;
      let bodySource = loaded.source;
      let bodyValidation = loaded.validation;
      let capture = null;

      if (!loaded.trusted) {
        browser ??= await openContext(config);
        try {
          capture = await extractRootBodyWithRetries(browser.page, candidate, config);
        } catch (error) {
          failures.push({
            postId: candidate.postId,
            phase: 'capture-root-body',
            message: error.message,
            code: error.code ?? null,
            attempts: error.attemptErrors ?? [],
          });
          diagnostics.push({ postId: candidate.postId, beforeTrust, failure: failures.at(-1) });
          continue;
        }
        body = capture.body;
        bodySource = 'browser-strict-root';
        bodyValidation = capture.validation;
        if (capture.identity) {
          candidate.corpusKey = capture.identity.key;
          candidate.groupId = capture.identity.groupIdentifier ?? candidate.groupId;
          candidate.groupIdentifier = capture.identity.groupIdentifier ?? candidate.groupIdentifier;
          candidate.canonicalUrl = capture.identity.canonicalUrl ?? candidate.canonicalUrl;
          candidate.finalPageUrl = capture.finalPageUrl;
        }
        record = recordBodyPreflight(registry, candidate, {
          body,
          capturedAt: capture.capturedAt,
          finalPageUrl: capture.finalPageUrl,
          identity: capture.identity,
        }, null);
        stampStrictBody(record, bodyValidation);
      }

      const prior = priorJudgment(record, config.review.topicKey, config.corpus.acceptedAcceptanceVersions);
      const row = {
        postId: String(candidate.postId),
        sourceKey: record?.sourceKey ?? candidate.corpusKey ?? candidate.key,
        sourceGroupIdentifier: record?.source?.groupIdentifier ?? candidate.groupId ?? candidate.groupIdentifier ?? null,
        canonicalUrl: record?.source?.canonicalUrl ?? candidate.canonicalUrl,
        queries,
        body,
        bodyChars: body.length,
        bodyContentHash: hashText(body),
        bodySource,
        bodyValidation,
      };

      diagnostics.push({
        postId: row.postId,
        beforeTrust,
        bodySource,
        bodyValidation,
        bodyContentHash: row.bodyContentHash,
        captureAttempts: capture?.attempts ?? 0,
        priorClassificationTrust: prior.trust,
        selectionDiagnostics: capture?.selectionDiagnostics ?? null,
      });

      if (prior.judgment) {
        alreadyJudged.push({ ...row, judgment: prior.judgment, judgmentTrust: prior.trust });
        console.log(`[review-v2] ${i + 1}/${discovery.candidates.length} post=${row.postId} prior=${prior.judgment.relevant ? 'YES' : 'NO'} body=${bodySource}`);
      } else {
        queue.push(row);
        console.log(`[review-v2] ${i + 1}/${discovery.candidates.length} post=${row.postId} queued bodyChars=${body.length} body=${bodySource} priorTrust=${prior.trust.reason}`);
      }
    }
  } finally {
    if (browser) await browser.context.close();
  }

  const reviewQueue = {
    schemaVersion: REVIEW_QUEUE_SCHEMA_VERSION,
    bodyAcceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
    topicKey: config.review.topicKey,
    topicLabel: config.review.topicLabel,
    generatedAt: new Date().toISOString(),
    instructions: 'Read the complete verified root-post body. relevant=true only if the MAIN SUBJECT is personal expense management / personal finance management. Otherwise false. Judge meaning, not keywords. Do not infer relevance from search snippets or comments.',
    items: queue,
    alreadyJudged,
  };
  await atomicWriteJson(path.join(runDir, 'review-queue.json'), reviewQueue);
  await atomicWriteJson(path.join(runDir, 'relevance-decisions.template.json'), {
    schemaVersion: REVIEW_QUEUE_SCHEMA_VERSION,
    bodyAcceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
    topicKey: config.review.topicKey,
    decisions: queue.map((item) => ({ postId: item.postId, relevant: null, reason: '', bodyContentHash: item.bodyContentHash })),
  });
  await atomicWriteJson(path.join(runDir, 'body-capture-diagnostics.json'), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    bodyAcceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
    rows: diagnostics,
  });
  if (failures.length) {
    await atomicWriteJson(path.join(runDir, 'body-capture-failures.json'), {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failures,
    });
  }
  await atomicWriteJson(path.join(runDir, 'TOPIC_RUN.json'), {
    status: failures.length ? 'blocked-body-capture' : (queue.length ? 'awaiting-review' : 'review-complete'),
    generatedAt: new Date().toISOString(),
    discovered: discovery.candidates.length,
    queued: queue.length,
    alreadyJudged: alreadyJudged.length,
    bodyCaptureFailures: failures.length,
    bodyAcceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
  });
  return { reviewQueue, queue, alreadyJudged, failures, diagnostics };
}

function validateReviewAndDecisions(review, decisions) {
  if (review?.schemaVersion !== REVIEW_QUEUE_SCHEMA_VERSION || review?.bodyAcceptanceVersion !== ROOT_BODY_ACCEPTANCE_VERSION) {
    throw new Error(`Unsupported/stale review queue. Expected schema=${REVIEW_QUEUE_SCHEMA_VERSION} body=${ROOT_BODY_ACCEPTANCE_VERSION}`);
  }
  if (decisions?.schemaVersion !== REVIEW_QUEUE_SCHEMA_VERSION || decisions?.bodyAcceptanceVersion !== ROOT_BODY_ACCEPTANCE_VERSION) {
    throw new Error(`Unsupported/stale decisions file. Expected schema=${REVIEW_QUEUE_SCHEMA_VERSION} body=${ROOT_BODY_ACCEPTANCE_VERSION}`);
  }
  if (!Array.isArray(decisions.decisions)) throw new Error('Invalid decisions file');
  if (decisions.topicKey !== review.topicKey) throw new Error(`Decision topicKey mismatch: expected ${review.topicKey}`);
  const map = new Map(decisions.decisions.map((decision) => [String(decision.postId), decision]));
  for (const item of review.items) {
    const decision = map.get(String(item.postId));
    if (!decision || typeof decision.relevant !== 'boolean') throw new Error(`Missing boolean relevance decision for post ${item.postId}`);
    if (decision.bodyContentHash !== item.bodyContentHash) throw new Error(`Decision body hash mismatch for post ${item.postId}`);
  }
  return map;
}

function assertReviewRowStillCurrent(record, row, acceptedVersions) {
  const trust = bodyTrust(record, acceptedVersions);
  if (!trust.trusted) throw new Error(`Review row ${row.postId} is stale because current body is untrusted: ${trust.reason}`);
  const currentHash = record?.body?.contentHash ?? hashText(row.body);
  if (trust.kind === 'complete-record') {
    if (currentHash && currentHash !== row.bodyContentHash) throw new Error(`Complete record body changed after review preparation for post ${row.postId}`);
    return;
  }
  if (currentHash !== row.bodyContentHash) throw new Error(`Body changed after review preparation for post ${row.postId}`);
  if (record.body?.acceptanceVersion !== ROOT_BODY_ACCEPTANCE_VERSION) throw new Error(`Body acceptance changed after review preparation for post ${row.postId}`);
}

async function applyReview({ review, decisions, cli, config, registry, indexPath, cacheDir, runDir }) {
  const decisionMap = validateReviewAndDecisions(review, decisions);
  const relevantToCollect = [];
  const reusable = [];
  const rejected = [];
  const rows = [];
  const allRows = [
    ...review.alreadyJudged.map((row) => ({ ...row, decision: row.judgment })),
    ...review.items.map((row) => ({ ...row, decision: decisionMap.get(String(row.postId)) })),
  ];

  for (const row of allRows) {
      const candidate = {
      postId: row.postId,
      key: row.sourceKey,
      corpusKey: row.sourceKey,
      groupId: row.sourceGroupIdentifier,
      groupIdentifier: row.sourceGroupIdentifier,
        canonicalUrl: row.canonicalUrl,
        queries: row.queries,
        allowedGroupIdentifiers: row.bodyValidation?.allowedGroupIdentifiers ?? [row.sourceGroupIdentifier],
        strictBody: {
          bodyContentHash: row.bodyContentHash,
          bodyAcceptanceVersion: row.bodyValidation?.acceptanceVersion ?? null,
          validation: row.bodyValidation,
        },
      };
    const record = findCorpusRecord(registry, candidate) ?? upsertDiscovery(registry, candidate, row.queries);
    assertReviewRowStillCurrent(record, row, config.corpus.acceptedAcceptanceVersions);
    const judgment = {
      relevant: Boolean(row.decision.relevant),
      reason: String(row.decision.reason ?? '').trim() || 'assessor-judgment',
    };

    record.topicClassifications ??= {};
    record.topicClassifications[config.review.topicKey] = {
      relevant: judgment.relevant,
      classification: judgment.relevant ? 'in-topic' : 'out-of-topic',
      decision: judgment.relevant ? 'COLLECT' : 'SKIP',
      reason: judgment.reason,
      source: 'assessor',
      judgedAt: new Date().toISOString(),
      bodyContentHash: row.bodyContentHash,
      bodyAcceptanceVersion: row.bodyValidation?.acceptanceVersion ?? ROOT_BODY_ACCEPTANCE_VERSION,
    };

    let disposition;
    if (!judgment.relevant) {
      disposition = 'SKIP';
      rejected.push({ candidate, judgment });
    } else if (!cli.recollectKnown && isReusableRecord(record, config.corpus.acceptedAcceptanceVersions)) {
      const cached = await loadCachedRecord(indexPath, record);
      if (!cached) throw new Error(`Reusable record cache missing for ${record.sourceKey}`);
      disposition = 'REUSE';
      reusable.push({ candidate, normalizedRecord: reuseRecordForCandidate(cached, candidate, cli.query) });
    } else {
      disposition = 'COLLECT';
      relevantToCollect.push(candidate);
    }
    rows.push({
      postId: row.postId,
      disposition,
      relevant: judgment.relevant,
      reason: judgment.reason,
      bodyContentHash: row.bodyContentHash,
      bodyAcceptanceVersion: row.bodyValidation?.acceptanceVersion ?? null,
    });
    console.log(`[review-v2] post=${row.postId} decision=${disposition} relevant=${judgment.relevant}`);
  }
  await saveCorpusRegistry(indexPath, registry);

  const filteredPath = path.join(runDir, 'discovery.filtered.json');
  await atomicWriteJson(filteredPath, {
    schemaVersion: 2,
    candidateCount: relevantToCollect.length,
    relevantCount: relevantToCollect.length,
    candidates: relevantToCollect,
    reviewGate: {
      totalJudged: allRows.length,
      collect: relevantToCollect.length,
      reuse: reusable.length,
      skip: rejected.length,
      bodyAcceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
    },
  });

  let legacyReconciliation = { complete: 0, truncated: 0, failed: 0 };
  let newDataset = [];
  if (relevantToCollect.length) {
    await runLegacyCollector(legacyArgs(cli, config._configPath, {
      discoveryOnly: false,
      fromDiscovery: filteredPath,
      outputDir: runDir,
      query: null,
      postUrl: null,
      postId: null,
    }));
    const reconciliationPath = path.join(runDir, 'reconciliation.json');
    if (await exists(reconciliationPath)) {
      legacyReconciliation = JSON.parse(await fs.readFile(reconciliationPath, 'utf8'));
      await fs.copyFile(reconciliationPath, path.join(runDir, 'collection-reconciliation.json'));
    }
    const datasetPath = path.join(runDir, 'dataset.json');
    if (await exists(datasetPath)) {
      newDataset = JSON.parse(await fs.readFile(datasetPath, 'utf8'));
      await atomicWriteJson(path.join(runDir, 'collection-dataset.json'), newDataset);
    }
  }

  const acceptedNewDataset = [];
  for (const normalizedRecord of newDataset) {
    const sourceKey = normalizedRecord?.source?.key ?? null;
    const candidate = relevantToCollect.find((item) => item.corpusKey === sourceKey || item.key === sourceKey);
    const outcome = legacyReconciliation?.postOutcomes?.find?.((item) => item.sourceKey === sourceKey);
    if (outcome?.status && outcome.status !== 'complete') continue;
    if (!candidate) {
      throw new Error(`Deep collector returned an unplanned source identity: ${sourceKey ?? normalizedRecord?.source?.postId}`);
    }
    const collectionTrust = strictCompleteRecordTrust(
      normalizedRecord,
      candidate?.postId,
      candidate?.groupIdentifier ?? candidate?.groupId,
    );
    if (!collectionTrust.trusted) {
      throw new Error(`Deep collector output is not reusable strict evidence for ${sourceKey ?? normalizedRecord?.source?.postId}: ${collectionTrust.reason}`);
    }
    if (normalizedRecord?.extraction?.bodyContentHash !== candidate?.strictBody?.bodyContentHash) {
      throw new Error(`Deep collector body changed after review for ${sourceKey ?? normalizedRecord?.source?.postId}`);
    }
    await cacheCompleteRecord({ registry, indexPath, cacheDir, normalizedRecord, candidate });
    acceptedNewDataset.push(normalizedRecord);
  }
  await saveCorpusRegistry(indexPath, registry);

  const merged = [...reusable.map((item) => item.normalizedRecord), ...acceptedNewDataset];
  const seen = new Set();
  const dataset = merged.filter((record) => {
    const key = record?.source?.key ?? `facebook:post:${record?.source?.postId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const reconciliation = {
    topicKey: config.review.topicKey,
    bodyAcceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
    judged: allRows.length,
    relevant: rows.filter((row) => row.relevant).length,
    irrelevant: rows.filter((row) => !row.relevant).length,
    fetched: relevantToCollect.length,
    reused: reusable.length,
    complete: (legacyReconciliation.complete ?? 0) + reusable.length,
    truncated: legacyReconciliation.truncated ?? 0,
    failed: legacyReconciliation.failed ?? 0,
    datasetRecords: dataset.length,
    generatedAt: new Date().toISOString(),
  };
  const runStatus = reconciliation.truncated > 0 || reconciliation.failed > 0
    ? 'completed-with-incomplete-collection'
    : 'completed';
  await atomicWriteJson(path.join(runDir, 'review-decisions.applied.json'), { schemaVersion: 2, rows });
  await atomicWriteJson(path.join(runDir, 'dataset.json'), dataset);
  await atomicWriteJson(path.join(runDir, 'reconciliation.json'), reconciliation);
  await atomicWriteJson(path.join(runDir, 'TOPIC_RUN.json'), { status: runStatus, generatedAt: new Date().toISOString(), reconciliation });
  return { ...reconciliation, runStatus };
}

async function resolveDiscoveryPath(requestedPath) {
  const requested = path.resolve(process.cwd(), requestedPath);
  const stat = await fs.stat(requested);
  return stat.isDirectory() ? path.join(requested, 'discovery.json') : requested;
}

async function main() {
  const cli = parseReviewCli();
  const config = await loadConfig(cli.config);
  if (cli.command !== 'collect' && cli.command !== 'login') throw new Error('Usage: review-topic-runner-v2.mjs collect|login [options]');

  // Keep direct-post/login/legacy-discovery debug behavior isolated. The normal
  // default collector always reaches v2 with --from-discovery or --from-review.
  if (cli.command === 'login' || cli.postUrl || cli.postId || cli.discoveryOnly || (!cli.fromDiscovery && !cli.fromReview)) {
    await runLegacyReview(delegatedArgs(cli));
    return;
  }

  const outputBase = resolveFromConfig(config, config.collection.outputDir);
  const runDir = cli.outputDir ? path.resolve(process.cwd(), cli.outputDir) : path.join(outputBase, timestampSlug());
  await fs.mkdir(runDir, { recursive: true });
  const indexPath = cli.corpusIndex ? path.resolve(process.cwd(), cli.corpusIndex) : resolveFromConfig(config, config.corpus.indexPath);
  const cacheDir = resolveFromConfig(config, config.corpus.cacheDir);
  const registry = await loadCorpusRegistry(indexPath);

  if (cli.fromReview) {
    if (!cli.decisions) throw new Error('--from-review requires --decisions');
    const review = JSON.parse(await fs.readFile(path.resolve(process.cwd(), cli.fromReview), 'utf8'));
    const decisions = JSON.parse(await fs.readFile(path.resolve(process.cwd(), cli.decisions), 'utf8'));
    const reconciliation = await applyReview({ review, decisions, cli, config, registry, indexPath, cacheDir, runDir });
    console.log(`[review-v2] ${reconciliation.runStatus.toUpperCase()} relevant=${reconciliation.relevant} irrelevant=${reconciliation.irrelevant} fetched=${reconciliation.fetched} reused=${reconciliation.reused}`);
    return;
  }

  const discoveryPath = await resolveDiscoveryPath(cli.fromDiscovery);
  const discovery = JSON.parse(await fs.readFile(discoveryPath, 'utf8'));
  if (!Array.isArray(discovery.candidates)) throw new Error(`Invalid discovery artifact: ${discoveryPath}`);
  const prepared = await prepareReview({ discovery, cli, config, registry, indexPath, runDir });
  await saveCorpusRegistry(indexPath, registry);
  console.log(`[review-v2] PREPARED queued=${prepared.queue.length} alreadyJudged=${prepared.alreadyJudged.length} bodyFailures=${prepared.failures.length}`);
  console.log(`[review-v2] Queue: ${path.join(runDir, 'review-queue.json')}`);
  console.log(`[review-v2] Decision template: ${path.join(runDir, 'relevance-decisions.template.json')}`);
  if (prepared.failures.length) {
    throw new Error(`Body capture blocked for ${prepared.failures.length} candidate(s); inspect body-capture-failures.json and do not assess/apply until resolved`);
  }
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntry) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
