import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  cacheCompleteRecord,
  loadCorpusRegistry,
  parseFacebookPostIdentity,
  recordBodyPreflight,
  saveCorpusRegistry,
  upsertDiscovery,
} from './corpus.mjs';

function parseCli(rawArgs = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: rawArgs,
    strict: true,
    options: {
      config: { type: 'string', default: 'config.json' },
      'from-run': { type: 'string' },
      'corpus-index': { type: 'string' },
    },
  });
  if (!values['from-run']) throw new Error('--from-run <run-dir|dataset.json> is required');
  return { config: values.config ?? 'config.json', fromRun: values['from-run'], corpusIndex: values['corpus-index'] ?? null };
}

async function loadConfig(configArg) {
  const configPath = path.resolve(process.cwd(), configArg);
  const parsed = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const baseDir = path.dirname(configPath);
  return {
    ...parsed,
    _baseDir: baseDir,
    corpus: {
      indexPath: './corpus/index.json',
      cacheDir: './corpus/posts',
      acceptedAcceptanceVersions: ['v0.3.0-strict'],
      ...parsed.corpus,
    },
  };
}

function resolveFromConfig(config, value) { return path.resolve(config._baseDir, value); }

async function resolveDatasetPath(fromRun) {
  const requested = path.resolve(process.cwd(), fromRun);
  const stat = await fs.stat(requested);
  return stat.isDirectory() ? path.join(requested, 'dataset.json') : requested;
}

function candidateFromNormalized(record) {
  const identity = parseFacebookPostIdentity(record?.extraction?.pageUrl)
    ?? parseFacebookPostIdentity(record?.source?.canonicalUrl);
  const postId = identity?.postId ?? record?.source?.postId ?? null;
  const corpusKey = identity?.key ?? record?.source?.key ?? (postId ? `facebook:post:${postId}` : null);
  return {
    corpusKey,
    key: corpusKey,
    postId,
    groupId: identity?.groupIdentifier ?? record?.source?.groupId ?? null,
    canonicalUrl: identity?.canonicalUrl ?? record?.source?.canonicalUrl ?? null,
    queries: record?.source?.discoveryQueries ?? [],
    discoveredUrls: record?.source?.discoveredUrls ?? [],
  };
}

function correctNormalizedSource(normalizedRecord, candidate) {
  const corrected = structuredClone(normalizedRecord);
  corrected.source ??= {};
  corrected.source.key = candidate.corpusKey;
  corrected.source.postId = candidate.postId;
  if (candidate.groupId) corrected.source.groupId = candidate.groupId;
  if (candidate.canonicalUrl) corrected.source.canonicalUrl = candidate.canonicalUrl;
  corrected.extraction ??= {};
  corrected.extraction.corpusImportedAt = new Date().toISOString();
  return corrected;
}

async function main() {
  const cli = parseCli();
  const config = await loadConfig(cli.config);
  const datasetPath = await resolveDatasetPath(cli.fromRun);
  const dataset = JSON.parse(await fs.readFile(datasetPath, 'utf8'));
  if (!Array.isArray(dataset)) throw new Error(`Expected dataset array: ${datasetPath}`);

  const indexPath = cli.corpusIndex ? path.resolve(process.cwd(), cli.corpusIndex) : resolveFromConfig(config, config.corpus.indexPath);
  const cacheDir = resolveFromConfig(config, config.corpus.cacheDir);
  const acceptedVersions = new Set(config.corpus.acceptedAcceptanceVersions ?? []);
  const registry = await loadCorpusRegistry(indexPath);

  let reusable = 0;
  let bodyOnly = 0;
  let skipped = 0;
  let provenanceCorrected = 0;
  const importedPostIds = [];

  for (const normalizedRecord of dataset) {
    const candidate = candidateFromNormalized(normalizedRecord);
    if (!candidate.postId || !candidate.corpusKey) { skipped += 1; continue; }

    const oldKey = normalizedRecord?.source?.key ?? null;
    if (oldKey && oldKey !== candidate.corpusKey) provenanceCorrected += 1;

    let corpusRecord = upsertDiscovery(registry, candidate, candidate.queries);
    corpusRecord = recordBodyPreflight(registry, candidate, {
      body: normalizedRecord?.post?.text ?? '',
      capturedAt: normalizedRecord?.capturedAt ?? new Date().toISOString(),
      finalPageUrl: normalizedRecord?.extraction?.pageUrl ?? null,
      identity: parseFacebookPostIdentity(normalizedRecord?.extraction?.pageUrl)
        ?? parseFacebookPostIdentity(normalizedRecord?.source?.canonicalUrl),
    }, '');

    const acceptanceVersion = normalizedRecord?.extraction?.acceptanceVersion ?? null;
    const strictComplete = normalizedRecord?.extraction?.completeness === 'complete'
      && (acceptedVersions.size === 0 || acceptedVersions.has(acceptanceVersion));

    if (strictComplete) {
      const corrected = correctNormalizedSource(normalizedRecord, candidate);
      await cacheCompleteRecord({ registry, indexPath, cacheDir, normalizedRecord: corrected, candidate });
      reusable += 1;
    } else {
      corpusRecord.status = 'seen';
      corpusRecord.acceptanceVersion = acceptanceVersion;
      bodyOnly += 1;
    }
    importedPostIds.push(candidate.postId);
  }

  await saveCorpusRegistry(indexPath, registry);

  console.log('==================================================');
  console.log('CORPUS IMPORT COMPLETE');
  console.log('==================================================');
  console.log(`Dataset:              ${datasetPath}`);
  console.log(`Records:              ${dataset.length}`);
  console.log(`Reusable complete:    ${reusable}`);
  console.log(`Body-only indexed:    ${bodyOnly}`);
  console.log(`Provenance corrected: ${provenanceCorrected}`);
  console.log(`Skipped:              ${skipped}`);
  console.log(`Corpus index:         ${indexPath}`);
  console.log(`Unique imported IDs:  ${new Set(importedPostIds).size}`);
  console.log('==================================================');
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntry) {
  main().catch((error) => { console.error(error?.stack ?? error); process.exitCode = 1; });
}
