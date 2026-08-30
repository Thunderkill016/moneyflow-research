import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  atomicWriteJson,
  findCorpusRecord,
  hashText,
  loadCachedRecord,
  loadCorpusRegistry,
} from './corpus.mjs';
import {
  ROOT_BODY_ACCEPTANCE_VERSION,
  bodyTrust,
  classificationTrust,
  strictCompleteRecordTrust,
} from './root-body.mjs';

const REVIEW_QUEUE_SCHEMA_VERSION = 2;

export function parseOfflineReviewCli(rawArgs = process.argv.slice(2)) {
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
    command: positionals[0] ?? 'prepare',
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
    corpus: {
      indexPath: './corpus/index.json',
      acceptedAcceptanceVersions: ['v0.8-strict-deep-collection-v2'],
      ...parsed.corpus,
    },
    review: {
      topicKey: 'personal-expense-management',
      topicLabel: 'quản lý chi tiêu / tài chính cá nhân',
      ...parsed.review,
    },
  };
}

function resolveFromConfig(config, value) {
  return path.resolve(config._baseDir, value);
}

export function selectReviewCandidates(discovery, limit = null) {
  if (!Array.isArray(discovery?.candidates)) throw new Error('Invalid discovery artifact: candidates[] is required');
  const selected = discovery.candidates.map((candidate) => structuredClone(candidate));
  return Number.isInteger(limit) && limit > 0 ? selected.slice(0, limit) : selected;
}

function normalizedJudgment(value) {
  if (!value) return null;
  if (value.relevant === true || value.classification === 'in-topic') {
    return { relevant: true, reason: value.reason ?? 'prior-assessor-judgment' };
  }
  if (value.relevant === false || value.classification === 'out-of-topic') {
    return { relevant: false, reason: value.reason ?? 'prior-assessor-judgment' };
  }
  return null;
}

async function loadTrustedEvidence(indexPath, record, acceptedVersions) {
  const trust = bodyTrust(record, acceptedVersions);
  if (!trust.trusted) return { trusted: false, trust };

  if (trust.kind === 'complete-record') {
    const cached = await loadCachedRecord(indexPath, record);
    if (!cached) return { trusted: false, trust: { trusted: false, reason: 'complete-cache-missing' } };
    const completeTrust = strictCompleteRecordTrust(cached, record?.source?.postId, record?.source?.groupIdentifier);
    if (!completeTrust.trusted) return { trusted: false, trust: completeTrust };
    const body = String(cached?.post?.text ?? '');
    if (!body.trim()) return { trusted: false, trust: { trusted: false, reason: 'complete-cache-body-empty' } };
    return {
      trusted: true,
      trust,
      body,
      bodySource: 'corpus-complete-cache',
      validation: cached?.extraction?.rootValidation ?? null,
    };
  }

  const body = String(record?.body?.text ?? '');
  if (!body.trim()) return { trusted: false, trust: { trusted: false, reason: 'strict-body-empty' } };
  return {
    trusted: true,
    trust,
    body,
    bodySource: 'corpus-strict-body-cache',
    validation: record?.body?.validation ?? null,
  };
}

export function buildOfflineReviewArtifacts({ topicKey, topicLabel, rows, alreadyJudged }) {
  const queue = {
    schemaVersion: REVIEW_QUEUE_SCHEMA_VERSION,
    bodyAcceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
    topicKey,
    topicLabel,
    generatedAt: new Date().toISOString(),
    preparation: {
      mode: 'offline-corpus-first',
      browserNavigations: 0,
      queued: rows.length,
      alreadyJudged: alreadyJudged.length,
    },
    instructions: 'Read the complete verified root-post body. relevant=true only if the MAIN SUBJECT matches the review topic. Judge meaning, not keywords. Do not infer relevance from search snippets or comments.',
    items: rows,
    alreadyJudged,
  };
  const decisionsTemplate = {
    schemaVersion: REVIEW_QUEUE_SCHEMA_VERSION,
    bodyAcceptanceVersion: ROOT_BODY_ACCEPTANCE_VERSION,
    topicKey,
    decisions: rows.map((item) => ({
      postId: item.postId,
      relevant: null,
      reason: '',
      bodyContentHash: item.bodyContentHash,
    })),
  };
  return { queue, decisionsTemplate };
}

export async function prepareOfflineReview({
  configPath = 'config.json',
  discoveryPath,
  outputDir = null,
  corpusIndex = null,
  limit = null,
} = {}) {
  if (!discoveryPath) throw new Error('discoveryPath is required');
  const config = await loadConfig(configPath);
  const discovery = JSON.parse(await fs.readFile(path.resolve(process.cwd(), discoveryPath), 'utf8'));
  const candidates = selectReviewCandidates(discovery, limit);
  const runDir = outputDir
    ? path.resolve(process.cwd(), outputDir)
    : path.dirname(path.resolve(process.cwd(), discoveryPath));
  await fs.mkdir(runDir, { recursive: true });
  const indexPath = corpusIndex
    ? path.resolve(process.cwd(), corpusIndex)
    : resolveFromConfig(config, config.corpus.indexPath);
  const registry = await loadCorpusRegistry(indexPath);
  const rows = [];
  const alreadyJudged = [];
  const gaps = [];

  for (const candidate of candidates) {
    const record = findCorpusRecord(registry, candidate);
    if (!record) {
      gaps.push({ postId: String(candidate.postId), sourceKey: candidate.corpusKey ?? candidate.key ?? null, reason: 'missing-corpus-record' });
      continue;
    }
    const evidence = await loadTrustedEvidence(indexPath, record, config.corpus.acceptedAcceptanceVersions);
    if (!evidence.trusted || !evidence.validation) {
      gaps.push({ postId: String(candidate.postId), sourceKey: record.sourceKey, reason: evidence.trust?.reason ?? 'untrusted-body-evidence' });
      continue;
    }
    const body = evidence.body;
    const row = {
      postId: String(candidate.postId),
      sourceKey: record.sourceKey,
      sourceGroupIdentifier: record?.source?.groupIdentifier ?? candidate.groupIdentifier ?? candidate.groupId ?? null,
      canonicalUrl: record?.source?.canonicalUrl ?? candidate.canonicalUrl,
      queries: [...new Set([...(record.queries ?? []), ...(candidate.queries ?? [])])],
      body,
      bodyChars: body.length,
      bodyContentHash: hashText(body),
      bodySource: evidence.bodySource,
      bodyValidation: evidence.validation,
    };
    const classification = record?.topicClassifications?.[config.review.topicKey];
    const judgment = normalizedJudgment(classification);
    const judgmentTrust = judgment
      ? classificationTrust(record, classification, config.corpus.acceptedAcceptanceVersions)
      : { trusted: false, reason: 'missing-or-invalid-classification' };
    if (judgment && judgmentTrust.trusted) alreadyJudged.push({ ...row, judgment, judgmentTrust });
    else rows.push(row);
  }

  if (gaps.length) {
    await atomicWriteJson(path.join(runDir, 'offline-review-gaps.json'), {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scopeCandidates: candidates.length,
      gaps,
    });
    await atomicWriteJson(path.join(runDir, 'TOPIC_RUN.json'), {
      status: 'blocked-offline-review-body-gaps',
      generatedAt: new Date().toISOString(),
      scopeCandidates: candidates.length,
      bodyGaps: gaps.length,
    });
    const error = new Error(`Offline review blocked: ${gaps.length} candidate(s) do not have trusted body evidence`);
    error.code = 'OFFLINE_REVIEW_BODY_GAPS';
    error.gaps = gaps;
    throw error;
  }

  const artifacts = buildOfflineReviewArtifacts({
    topicKey: config.review.topicKey,
    topicLabel: config.review.topicLabel,
    rows,
    alreadyJudged,
  });
  await atomicWriteJson(path.join(runDir, 'review-queue.json'), artifacts.queue);
  await atomicWriteJson(path.join(runDir, 'relevance-decisions.template.json'), artifacts.decisionsTemplate);
  await atomicWriteJson(path.join(runDir, 'TOPIC_RUN.json'), {
    status: rows.length ? 'awaiting-review' : 'review-complete',
    generatedAt: new Date().toISOString(),
    scopeCandidates: candidates.length,
    queued: rows.length,
    alreadyJudged: alreadyJudged.length,
    preparationMode: 'offline-corpus-first',
    browserNavigations: 0,
  });
  return {
    status: rows.length ? 'awaiting-review' : 'review-complete',
    candidates,
    queued: rows.length,
    alreadyJudged: alreadyJudged.length,
    runDir,
    indexPath,
  };
}

async function main() {
  const cli = parseOfflineReviewCli();
  if (cli.command !== 'prepare') throw new Error('Usage: offline-review.mjs prepare --from-discovery <path> [options]');
  if (!cli.fromDiscovery) throw new Error('--from-discovery is required');
  const result = await prepareOfflineReview({
    configPath: cli.config,
    discoveryPath: cli.fromDiscovery,
    outputDir: cli.outputDir,
    corpusIndex: cli.corpusIndex,
    limit: cli.limit,
  });
  console.log(`[offline-review] ${result.status} scope=${result.candidates.length} queued=${result.queued} prior=${result.alreadyJudged} browserNavigations=0`);
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntry) main().catch((error) => { console.error(error?.stack ?? error); process.exitCode = 1; });
