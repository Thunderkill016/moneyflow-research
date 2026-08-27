import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  canonicalizeFacebookPostUrl,
  cleanFacebookText,
  fingerprintComment,
  normalizeWhitespace,
  scoreRelevance,
  uniqueBy,
} from './core.mjs';

const EXPAND_TEXT = /^(xem thêm|see more|xem thêm bình luận|view more comments|xem thêm .* bình luận|xem thêm phản hồi|view more replies|xem .* câu trả lời|view .* replies|xem các bình luận trước|view previous comments)$/i;

function parseArgs(argv) {
  const result = { command: argv[2] ?? '', config: 'config.json', limit: null };
  for (let i = 3; i < argv.length; i += 1) {
    if (argv[i] === '--config' && argv[i + 1]) result.config = argv[++i];
    else if (argv[i] === '--limit' && argv[i + 1]) result.limit = Number(argv[++i]);
  }
  return result;
}

async function loadConfig(configArg) {
  const configPath = path.resolve(process.cwd(), configArg);
  const parsed = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const baseDir = path.dirname(configPath);

  if (!parsed.group?.id) throw new Error('config.group.id is required');
  if (!Array.isArray(parsed.queries) || parsed.queries.length === 0) throw new Error('config.queries must contain at least one query');

  return {
    ...parsed,
    _configPath: configPath,
    _baseDir: baseDir,
    browser: {
      headless: false,
      profileDir: './profile',
      locale: 'vi-VN',
      ...parsed.browser,
    },
    pacing: {
      minMs: 1200,
      maxMs: 2600,
      ...parsed.pacing,
    },
    discovery: {
      scrollRounds: 6,
      scrollPixels: 1400,
      maxCandidatesPerQuery: 40,
      ...parsed.discovery,
    },
    collection: {
      maxPosts: 25,
      expandRounds: 10,
      maxClicksPerRound: 20,
      outputDir: './output',
      rawHtmlMaxChars: 1_500_000,
      ...parsed.collection,
    },
    relevance: {
      threshold: 5,
      include: [],
      exclude: [],
      ...parsed.relevance,
    },
  };
}

function resolveConfigPath(config, value) {
  return path.resolve(config._baseDir, value);
}

async function randomPause(config, multiplier = 1) {
  const min = Math.max(0, Number(config.pacing.minMs ?? 1200));
  const max = Math.max(min, Number(config.pacing.maxMs ?? 2600));
  const ms = Math.round((min + Math.random() * (max - min)) * multiplier);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function openContext(config) {
  const profileDir = resolveConfigPath(config, config.browser.profileDir);
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

async function login(config) {
  const { context, page } = await openContext(config);
  try {
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
    console.log(`Browser profile: ${resolveConfigPath(config, config.browser.profileDir)}`);
    console.log('Log in to Facebook in the opened browser. Do not paste credentials into this tool.');
    console.log('When the Facebook home/feed is usable, return here and press Enter.');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await rl.question('Press Enter to save the browser session...');
    rl.close();
  } finally {
    await context.close();
  }
}

function searchUrl(groupId, query) {
  return `https://www.facebook.com/groups/${encodeURIComponent(groupId)}/search/?q=${encodeURIComponent(query)}`;
}

async function extractDiscoveryCandidates(page, fallbackGroupId) {
  return page.evaluate(({ fallbackGroupId }) => {
    const links = [...document.querySelectorAll('a[href]')];
    const out = [];
    for (const link of links) {
      const href = link.href;
      if (!href || !href.includes('facebook.com/groups/')) continue;
      if (!(href.includes('/posts/') || href.includes('/permalink/') || href.includes('multi_permalinks='))) continue;
      const article = link.closest('[role="article"]');
      const container = article ?? link.parentElement?.parentElement ?? link.parentElement;
      const text = (container?.innerText ?? '').replace(/\s+/g, ' ').trim();
      out.push({ href, preview: text.slice(0, 6000), fallbackGroupId });
    }
    return out;
  }, { fallbackGroupId });
}

async function discover(page, config) {
  const candidates = new Map();

  for (const query of config.queries) {
    console.log(`\n[discover] ${query}`);
    await page.goto(searchUrl(config.group.id, query), { waitUntil: 'domcontentloaded' });
    await randomPause(config, 1.5);

    for (let round = 0; round < config.discovery.scrollRounds; round += 1) {
      const rows = await extractDiscoveryCandidates(page, config.group.id);
      for (const row of rows) {
        const canonical = canonicalizeFacebookPostUrl(row.href, config.group.id);
        if (!canonical) continue;
        const existing = candidates.get(canonical.key);
        if (!existing) {
          candidates.set(canonical.key, {
            ...canonical,
            preview: normalizeWhitespace(row.preview),
            queries: new Set([query]),
            discoveredUrls: new Set([row.href]),
          });
        } else {
          existing.queries.add(query);
          existing.discoveredUrls.add(row.href);
          if ((row.preview?.length ?? 0) > (existing.preview?.length ?? 0)) existing.preview = normalizeWhitespace(row.preview);
        }
      }

      const perQuery = [...candidates.values()].filter((item) => item.queries.has(query)).length;
      console.log(`[discover] round ${round + 1}: ${perQuery} unique candidates for query`);
      if (perQuery >= config.discovery.maxCandidatesPerQuery) break;
      await page.mouse.wheel(0, config.discovery.scrollPixels);
      await randomPause(config);
    }
  }

  return [...candidates.values()].map((item) => ({
    ...item,
    queries: [...item.queries],
    discoveredUrls: [...item.discoveredUrls],
    relevance: scoreRelevance(item.preview, config.relevance),
  }));
}

async function expandPost(page, config) {
  let idleRounds = 0;
  for (let round = 0; round < config.collection.expandRounds; round += 1) {
    const clickable = page.locator('button, a, [role="button"]');
    const count = await clickable.count();
    let clicked = 0;

    for (let i = 0; i < count && clicked < config.collection.maxClicksPerRound; i += 1) {
      const item = clickable.nth(i);
      try {
        if (!(await item.isVisible())) continue;
        const text = normalizeWhitespace(await item.innerText({ timeout: 700 }));
        if (!EXPAND_TEXT.test(text)) continue;
        await item.click({ timeout: 1_500 });
        clicked += 1;
        await randomPause(config, 0.35);
      } catch {
        // Facebook re-renders frequently; stale/covered elements are expected and skipped.
      }
    }

    await page.mouse.wheel(0, Math.max(700, Math.round(config.discovery.scrollPixels * 0.75)));
    await randomPause(config, 0.8);

    if (clicked === 0) idleRounds += 1;
    else idleRounds = 0;
    if (idleRounds >= 2) break;
  }
}

async function extractPostBundle(page, postId, rawHtmlMaxChars) {
  return page.evaluate(({ postId, rawHtmlMaxChars }) => {
    const allArticles = [...document.querySelectorAll('[role="article"]')];
    const hasPostLink = (node) => [...node.querySelectorAll('a[href]')].some((a) => a.href.includes(postId));
    const rootCandidates = allArticles.filter(hasPostLink).sort((a, b) => (b.innerText?.length ?? 0) - (a.innerText?.length ?? 0));
    const root = rootCandidates[0] ?? document.querySelector('main') ?? document.body;

    const directLinks = (node) => [...node.querySelectorAll('a[href]')]
      .filter((a) => a.closest('[role="article"]') === node || node.getAttribute('role') !== 'article')
      .map((a) => ({ text: (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim(), href: a.href }))
      .filter((x) => x.text || x.href);

    const ownText = (node) => {
      const clone = node.cloneNode(true);
      for (const nested of clone.querySelectorAll('[role="article"]')) nested.remove();
      return (clone.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    };

    const pickAuthor = (links) => {
      const userLink = links.find((x) => x.text && /facebook\.com\/(?:groups\/[^/]+\/user\/\d+|profile\.php|[^/?#]+)(?:[/?#]|$)/i.test(x.href)
        && !/facebook\.com\/groups\//i.test(x.href.replace(/\/groups\/[^/]+\/user\/\d+.*/, '')));
      return userLink ?? links.find((x) => x.text && x.text.length <= 120) ?? null;
    };

    const nested = root.getAttribute('role') === 'article'
      ? [...root.querySelectorAll('[role="article"]')]
      : allArticles.filter((article) => article !== root);
    const indexByNode = new Map(nested.map((node, index) => [node, index]));

    const comments = nested.map((node, index) => {
      let parentArticle = node.parentElement?.closest('[role="article"]') ?? null;
      while (parentArticle && parentArticle !== root && !indexByNode.has(parentArticle)) {
        parentArticle = parentArticle.parentElement?.closest('[role="article"]') ?? null;
      }
      const parentIndex = parentArticle && parentArticle !== root ? indexByNode.get(parentArticle) ?? null : null;
      let depth = 0;
      let cursor = parentArticle;
      while (cursor && cursor !== root) {
        depth += 1;
        cursor = cursor.parentElement?.closest('[role="article"]') ?? null;
      }
      const links = directLinks(node);
      const author = pickAuthor(links);
      const commentLink = links.find((x) => /[?&](?:comment_id|reply_comment_id)=\d+/i.test(x.href)) ?? null;
      return {
        index,
        parentIndex,
        depth,
        author: author?.text ?? null,
        authorUrl: author?.href ?? null,
        rawText: ownText(node),
        links,
        sourceUrl: commentLink?.href ?? null,
      };
    });

    const rootLinks = directLinks(root);
    const rootAuthor = pickAuthor(rootLinks);
    const html = root.outerHTML ?? '';
    return {
      pageUrl: location.href,
      rootFoundByPostLink: rootCandidates.length > 0,
      post: {
        author: rootAuthor?.text ?? null,
        authorUrl: rootAuthor?.href ?? null,
        rawText: ownText(root),
        links: rootLinks,
      },
      comments,
      raw: {
        text: root.innerText ?? root.textContent ?? '',
        html: html.slice(0, rawHtmlMaxChars),
        htmlTruncated: html.length > rawHtmlMaxChars,
      },
    };
  }, { postId, rawHtmlMaxChars });
}

function normalizeBundle(candidate, bundle, config) {
  const postText = cleanFacebookText(bundle.post.rawText, bundle.post.author ?? '');
  const comments = [];
  const fingerprints = new Map();

  for (const item of bundle.comments) {
    const parentFingerprint = item.parentIndex == null ? '' : fingerprints.get(item.parentIndex) ?? '';
    const text = cleanFacebookText(item.rawText, item.author ?? '');
    if (!text || text.length < 2) continue;
    const fingerprint = fingerprintComment({ postKey: candidate.key, author: item.author ?? '', text, parentFingerprint });
    fingerprints.set(item.index, fingerprint);
    comments.push({
      fingerprint,
      parentFingerprint: parentFingerprint || null,
      depth: item.depth,
      author: item.author,
      authorUrl: item.authorUrl,
      text,
      rawText: item.rawText,
      sourceUrl: item.sourceUrl,
      links: item.links,
    });
  }

  return {
    schemaVersion: 1,
    source: {
      platform: 'facebook',
      groupId: candidate.groupId,
      groupName: config.group.name ?? null,
      postId: candidate.postId,
      canonicalUrl: candidate.canonicalUrl,
      key: candidate.key,
      discoveryQueries: candidate.queries,
      discoveredUrls: candidate.discoveredUrls,
    },
    capturedAt: new Date().toISOString(),
    relevance: candidate.relevance,
    post: {
      author: bundle.post.author,
      authorUrl: bundle.post.authorUrl,
      text: postText,
      discoveryPreview: candidate.preview,
      rawText: bundle.post.rawText,
      links: bundle.post.links,
    },
    comments: uniqueBy(comments, (item) => item.fingerprint),
    extraction: {
      rootFoundByPostLink: bundle.rootFoundByPostLink,
      pageUrl: bundle.pageUrl,
      completeness: 'best-effort; Facebook ranking, privacy, lazy loading, deleted content and UI changes can hide comments',
    },
  };
}

function toMarkdown(record) {
  const lines = [
    `# Facebook post ${record.source.postId}`,
    '',
    `- Group: ${record.source.groupName ?? record.source.groupId}`,
    `- URL: ${record.source.canonicalUrl}`,
    `- Captured: ${record.capturedAt}`,
    `- Relevance score: ${record.relevance.score} (threshold ${record.relevance.threshold})`,
    '',
    '## Post',
    '',
    `**${record.post.author ?? 'Unknown author'}**`,
    '',
    record.post.text || record.post.discoveryPreview || '_No post text extracted._',
    '',
    '## Comments',
    '',
  ];

  if (record.comments.length === 0) lines.push('_No comment blocks extracted._');
  for (const comment of record.comments) {
    const indent = '  '.repeat(Math.min(comment.depth, 6));
    lines.push(`${indent}- **${comment.author ?? 'Unknown'}:** ${comment.text.replace(/\n/g, ' ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function collect(config, cliLimit) {
  const runDir = resolveConfigPath(config, path.join(config.collection.outputDir, timestampSlug()));
  const rawDir = path.join(runDir, 'raw');
  const normalizedDir = path.join(runDir, 'normalized');
  await fs.mkdir(rawDir, { recursive: true });
  await fs.mkdir(normalizedDir, { recursive: true });

  const { context, page } = await openContext(config);
  const collected = [];
  try {
    const candidates = await discover(page, config);
    const ranked = candidates
      .filter((item) => item.relevance.relevant)
      .sort((a, b) => b.relevance.score - a.relevance.score || b.preview.length - a.preview.length);
    const maxPosts = Number.isFinite(cliLimit) && cliLimit > 0 ? cliLimit : config.collection.maxPosts;
    const selected = ranked.slice(0, maxPosts);

    await fs.writeFile(path.join(runDir, 'discovery.json'), JSON.stringify({
      group: config.group,
      queries: config.queries,
      candidateCount: candidates.length,
      relevantCount: ranked.length,
      selectedCount: selected.length,
      candidates: candidates.map((item) => ({ ...item, relevance: item.relevance })),
    }, null, 2));

    console.log(`\n[select] ${candidates.length} candidates, ${ranked.length} relevant, collecting ${selected.length}`);

    for (let i = 0; i < selected.length; i += 1) {
      const candidate = selected[i];
      console.log(`[collect ${i + 1}/${selected.length}] ${candidate.canonicalUrl} score=${candidate.relevance.score}`);
      await page.goto(candidate.canonicalUrl, { waitUntil: 'domcontentloaded' });
      await randomPause(config, 1.4);
      await expandPost(page, config);
      const bundle = await extractPostBundle(page, candidate.postId, config.collection.rawHtmlMaxChars);
      const normalized = normalizeBundle(candidate, bundle, config);

      await fs.writeFile(path.join(rawDir, `${candidate.postId}.json`), JSON.stringify({
        source: candidate,
        capturedAt: normalized.capturedAt,
        pageUrl: bundle.pageUrl,
        raw: bundle.raw,
      }, null, 2));
      await fs.writeFile(path.join(normalizedDir, `${candidate.postId}.json`), JSON.stringify(normalized, null, 2));
      await fs.writeFile(path.join(normalizedDir, `${candidate.postId}.md`), toMarkdown(normalized));
      collected.push(normalized);
      await randomPause(config, 1.3);
    }

    await fs.writeFile(path.join(runDir, 'dataset.json'), JSON.stringify(collected, null, 2));
    await fs.writeFile(path.join(runDir, 'RUN.json'), JSON.stringify({
      startedFromConfig: config._configPath,
      completedAt: new Date().toISOString(),
      group: config.group,
      queries: config.queries,
      records: collected.length,
      note: 'Local research evidence. Do not commit raw Facebook dumps or browser profile data.',
    }, null, 2));

    console.log(`\nDone. Local output: ${runDir}`);
  } finally {
    await context.close();
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!['login', 'collect'].includes(args.command)) {
    console.error('Usage: node src/index.mjs <login|collect> [--config config.json] [--limit N]');
    process.exitCode = 2;
    return;
  }

  const config = await loadConfig(args.config);
  if (args.command === 'login') await login(config);
  else await collect(config, args.limit);
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
