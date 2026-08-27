import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import {
  canonicalizeFacebookPostUrl,
  cleanFacebookText,
  fingerprintComment,
  normalizeForMatch,
  normalizeWhitespace,
  scoreRelevance,
  uniqueBy,
} from './core.mjs';

const EXPAND_TEXT = /^(xem thêm|see more|xem thêm bình luận|view more comments|xem thêm .* bình luận|xem thêm phản hồi|view more replies|xem .* câu trả lời|view .* replies|xem các bình luận trước|view previous comments)$/i;

function parseArgs(argv) {
  const result = { config: 'config.json', limit: null };
  for (let i = 2; i < argv.length; i += 1) {
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
    browser: { headless: false, profileDir: './profile', locale: 'vi-VN', ...parsed.browser },
    pacing: { minMs: 1200, maxMs: 2600, ...parsed.pacing },
    discovery: { scrollRounds: 6, scrollPixels: 1400, maxCandidatesPerQuery: 40, ...parsed.discovery },
    collection: { maxPosts: 25, expandRounds: 10, maxClicksPerRound: 20, outputDir: './output', rawHtmlMaxChars: 1_500_000, ...parsed.collection },
    relevance: { threshold: 5, include: [], exclude: [], ...parsed.relevance },
  };
}

function resolveConfigPath(config, value) {
  return path.resolve(config._baseDir, value);
}

async function pause(config, multiplier = 1) {
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

function searchUrl(groupId, query) {
  return `https://www.facebook.com/groups/${encodeURIComponent(groupId)}/search/?q=${encodeURIComponent(query)}`;
}

async function extractDiscoveryCandidates(page, fallbackGroupId) {
  return page.evaluate(({ fallbackGroupId }) => {
    const out = [];
    for (const link of document.querySelectorAll('a[href]')) {
      const href = link.href;
      if (!href || !href.includes('facebook.com/groups/')) continue;
      if (!(href.includes('/posts/') || href.includes('/permalink/') || href.includes('multi_permalinks='))) continue;
      // A comment timestamp often contains the parent post id plus comment_id. It is not a discovery permalink.
      if (/[?&](?:comment_id|reply_comment_id)=\d+/i.test(href)) continue;
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
    await pause(config, 1.5);
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
      await pause(config);
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
        await pause(config, 0.35);
      } catch {
        // Facebook re-renders often; stale/covered controls are expected.
      }
    }
    await page.mouse.wheel(0, Math.max(700, Math.round(config.discovery.scrollPixels * 0.75)));
    await pause(config, 0.8);
    idleRounds = clicked === 0 ? idleRounds + 1 : 0;
    if (idleRounds >= 2) break;
  }
}

async function extractPageBundle(page, candidate, rawHtmlMaxChars) {
  return page.evaluate(({ postId, preview, rawHtmlMaxChars }) => {
    const main = document.querySelector('[role="main"]') ?? document.querySelector('main') ?? document.body;
    const articles = [...main.querySelectorAll('[role="article"]')];

    const directLinks = (node) => [...node.querySelectorAll('a[href]')]
      .filter((a) => a.closest('[role="article"]') === node)
      .map((a) => ({ text: (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim(), href: a.href }))
      .filter((x) => x.text || x.href);

    const ownText = (node) => {
      const clone = node.cloneNode(true);
      for (const nested of clone.querySelectorAll('[role="article"]')) nested.remove();
      return (clone.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    };

    const pickAuthor = (links) => {
      const bad = /(\/groups\/[^/]+\/(?:posts|permalink)\/|facebook\.com\/share|facebook\.com\/help|\/photo\/|\/reel\/)/i;
      const strong = links.find((x) => x.text && x.text.length <= 120 && !bad.test(x.href)
        && (/\/groups\/[^/]+\/user\/\d+/i.test(x.href) || /profile\.php\?id=\d+/i.test(x.href)));
      if (strong) return strong;
      return links.find((x) => x.text && x.text.length <= 120 && !bad.test(x.href)) ?? null;
    };

    const normalize = (value) => String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
    const previewTokens = [...new Set(normalize(preview).split(/[^a-z0-9]+/).filter((x) => x.length >= 4))].slice(0, 80);
    const overlap = (text) => {
      const hay = normalize(text);
      let count = 0;
      for (const token of previewTokens) if (hay.includes(token)) count += 1;
      return Math.min(40, count * 2);
    };

    const rows = articles.map((node, index) => {
      const links = directLinks(node);
      const text = ownText(node);
      const postLinks = links.filter((x) => x.href.includes(postId)
        && (x.href.includes('/posts/') || x.href.includes('/permalink/') || x.href.includes('multi_permalinks=')));
      const cleanPostLinks = postLinks.filter((x) => !/[?&](?:comment_id|reply_comment_id)=\d+/i.test(x.href));
      const commentLinks = links.filter((x) => /[?&](?:comment_id|reply_comment_id)=\d+/i.test(x.href));
      const parentArticle = node.parentElement?.closest('[role="article"]') ?? null;
      const author = pickAuthor(links);
      const actionSignal = /(?:Thích|Like)/i.test(text) && /(?:Trả lời|Reply)/i.test(text);
      let rootScore = 0;
      if (cleanPostLinks.length) rootScore += 120;
      else if (postLinks.length) rootScore += 35;
      if (commentLinks.length) rootScore -= 100;
      if (!parentArticle) rootScore += 20;
      if (text.length >= 120) rootScore += 8;
      rootScore += overlap(text);
      return {
        index,
        node,
        links,
        text,
        author,
        postLinks,
        cleanPostLinks,
        commentLinks,
        parentArticle,
        actionSignal,
        rootScore,
      };
    });

    rows.sort((a, b) => b.rootScore - a.rootScore || b.text.length - a.text.length);
    const rootRow = rows[0] ?? null;
    const root = rootRow?.node ?? main;
    const rootOriginalIndex = rootRow?.index ?? -1;

    const commentRows = rows
      .filter((row) => row.node !== root)
      .filter((row) => {
        const afterRoot = rootOriginalIndex < 0 || row.index > rootOriginalIndex;
        const descendantOfRoot = root.contains(row.node);
        const hasStrongCommentSignal = row.commentLinks.length > 0;
        const hasFallbackSignal = row.actionSignal && Boolean(row.author);
        return (afterRoot || descendantOfRoot) && (hasStrongCommentSignal || hasFallbackSignal);
      })
      .sort((a, b) => a.index - b.index);

    const commentIndexByNode = new Map(commentRows.map((row, index) => [row.node, index]));
    const comments = commentRows.map((row, index) => {
      let parentNode = row.parentArticle;
      while (parentNode && parentNode !== root && !commentIndexByNode.has(parentNode)) {
        parentNode = parentNode.parentElement?.closest('[role="article"]') ?? null;
      }
      const parentIndex = parentNode && parentNode !== root ? (commentIndexByNode.get(parentNode) ?? null) : null;
      let depth = 0;
      let cursor = parentNode;
      while (cursor && cursor !== root) {
        depth += 1;
        cursor = cursor.parentElement?.closest('[role="article"]') ?? null;
      }
      return {
        index,
        parentIndex,
        depth,
        author: row.author?.text ?? null,
        authorUrl: row.author?.href ?? null,
        rawText: row.text,
        links: row.links,
        sourceUrl: row.commentLinks[0]?.href ?? null,
      };
    });

    const rootLinks = rootRow?.links ?? [];
    const rootAuthor = rootRow?.author ?? pickAuthor(rootLinks);
    const mainHtml = main.outerHTML ?? '';
    return {
      pageUrl: location.href,
      post: {
        author: rootAuthor?.text ?? null,
        authorUrl: rootAuthor?.href ?? null,
        rawText: rootRow?.text ?? (root.innerText ?? root.textContent ?? ''),
        links: rootLinks,
      },
      comments,
      extraction: {
        strategy: 'article-score-v2',
        articleCount: articles.length,
        rootOriginalIndex,
        rootScore: rootRow?.rootScore ?? null,
        rootCleanPostLinkCount: rootRow?.cleanPostLinks.length ?? 0,
        commentCandidateCount: comments.length,
      },
      raw: {
        text: main.innerText ?? main.textContent ?? '',
        html: mainHtml.slice(0, rawHtmlMaxChars),
        htmlTruncated: mainHtml.length > rawHtmlMaxChars,
        articleDiagnostics: rows.map((row) => ({
          originalIndex: row.index,
          rootScore: row.rootScore,
          textPreview: row.text.slice(0, 500),
          author: row.author?.text ?? null,
          cleanPostLinks: row.cleanPostLinks.map((x) => x.href),
          commentLinks: row.commentLinks.map((x) => x.href),
          actionSignal: row.actionSignal,
        })),
      },
    };
  }, { postId: candidate.postId, preview: candidate.preview, rawHtmlMaxChars });
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
    schemaVersion: 2,
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
      ...bundle.extraction,
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
    `- Extraction: ${record.extraction.strategy}; comments=${record.comments.length}`,
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

async function writeRun(runDir, state) {
  await fs.writeFile(path.join(runDir, 'RUN.json'), JSON.stringify(state, null, 2));
}

async function collect(config, cliLimit) {
  const runDir = resolveConfigPath(config, path.join(config.collection.outputDir, timestampSlug()));
  const rawDir = path.join(runDir, 'raw');
  const normalizedDir = path.join(runDir, 'normalized');
  await fs.mkdir(rawDir, { recursive: true });
  await fs.mkdir(normalizedDir, { recursive: true });
  const startedAt = new Date().toISOString();
  await writeRun(runDir, { status: 'running', startedAt, startedFromConfig: config._configPath, group: config.group, records: 0 });

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
      candidates,
    }, null, 2));
    console.log(`\n[select] ${candidates.length} candidates, ${ranked.length} relevant, collecting ${selected.length}`);

    for (let i = 0; i < selected.length; i += 1) {
      const candidate = selected[i];
      console.log(`[collect ${i + 1}/${selected.length}] ${candidate.canonicalUrl} score=${candidate.relevance.score}`);
      await page.goto(candidate.canonicalUrl, { waitUntil: 'domcontentloaded' });
      await pause(config, 1.4);
      await expandPost(page, config);
      const bundle = await extractPageBundle(page, candidate, config.collection.rawHtmlMaxChars);
      const normalized = normalizeBundle(candidate, bundle, config);
      await fs.writeFile(path.join(rawDir, `${candidate.postId}.json`), JSON.stringify({
        source: candidate,
        capturedAt: normalized.capturedAt,
        pageUrl: bundle.pageUrl,
        extraction: bundle.extraction,
        raw: bundle.raw,
      }, null, 2));
      await fs.writeFile(path.join(normalizedDir, `${candidate.postId}.json`), JSON.stringify(normalized, null, 2));
      await fs.writeFile(path.join(normalizedDir, `${candidate.postId}.md`), toMarkdown(normalized));
      collected.push(normalized);
      await writeRun(runDir, { status: 'running', startedAt, startedFromConfig: config._configPath, group: config.group, records: collected.length, selected: selected.length });
      await pause(config, 1.3);
    }

    await fs.writeFile(path.join(runDir, 'dataset.json'), JSON.stringify(collected, null, 2));
    await writeRun(runDir, {
      status: 'completed', startedAt, completedAt: new Date().toISOString(), startedFromConfig: config._configPath,
      group: config.group, queries: config.queries, records: collected.length,
      note: 'Local research evidence. Do not commit raw Facebook dumps or browser profile data.',
    });
    console.log(`\nDone. Local output: ${runDir}`);
  } catch (error) {
    await writeRun(runDir, {
      status: 'failed', startedAt, failedAt: new Date().toISOString(), startedFromConfig: config._configPath,
      group: config.group, records: collected.length, error: String(error?.stack ?? error),
    });
    throw error;
  } finally {
    await context.close();
  }
}

const args = parseArgs(process.argv);
const config = await loadConfig(args.config);
await collect(config, args.limit);
