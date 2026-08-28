import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runTopicDiscovery } from './topic-discovery.mjs';

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function parseCollectCli(rawArgs = process.argv.slice(2)) {
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

async function runReviewRunner(args) {
  const runner = fileURLToPath(new URL('./review-topic-runner-v2.mjs', import.meta.url));
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner, ...args], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`review-topic-runner-v2 failed (code=${code}, signal=${signal ?? 'none'})`));
    });
  });
}

function delegatedArgs(cli) {
  const args = [cli.command];
  args.push('--config', cli.config);
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

async function defaultOutputDir(configPath) {
  const resolved = path.resolve(process.cwd(), configPath);
  const parsed = JSON.parse(await fs.readFile(resolved, 'utf8'));
  const baseDir = path.dirname(resolved);
  const outputBase = path.resolve(baseDir, parsed.collection?.outputDir ?? './output');
  return path.join(outputBase, timestampSlug());
}

async function main() {
  const cli = parseCollectCli();
  if (!['collect', 'login'].includes(cli.command)) throw new Error('Usage: collect.mjs collect|login [options]');

  const hasPreparedInput = Boolean(cli.fromDiscovery || cli.fromReview || cli.postUrl || cli.postId || cli.command === 'login');
  if (hasPreparedInput) {
    await runReviewRunner(delegatedArgs(cli));
    return;
  }

  const runDir = cli.outputDir ? path.resolve(process.cwd(), cli.outputDir) : await defaultOutputDir(cli.config);
  const discovery = await runTopicDiscovery({ configPath: cli.config, query: cli.query, outputDir: runDir });

  if (cli.discoveryOnly) {
    console.log(`[collect] discovery-only scope=${discovery.discovery.discoveryScope} candidates=${discovery.discovery.candidateCount}`);
    console.log(`[collect] output=${runDir}`);
    return;
  }

  const reviewArgs = ['collect', '--config', cli.config, '--from-discovery', path.join(runDir, 'discovery.json'), '--output-dir', runDir];
  if (cli.query) reviewArgs.push('--query', cli.query);
  if (cli.corpusIndex) reviewArgs.push('--corpus-index', cli.corpusIndex);
  if (cli.recollectKnown) reviewArgs.push('--recollect-known');
  await runReviewRunner(reviewArgs);
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntry) main().catch((error) => { console.error(error?.stack ?? error); process.exitCode = 1; });
