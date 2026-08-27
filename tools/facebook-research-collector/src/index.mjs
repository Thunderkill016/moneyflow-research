import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs as utilParseArgs } from 'node:util';
import { chromium } from 'playwright';
import {
  EXPAND_REGEXES,
  canonicalizeFacebookPostUrl,
  cleanFacebookPostText,
  cleanFacebookText,
  fingerprintComment,
  isExpandButtonText,
  isSuspiciousUnmatchedButton,
  normalizeWhitespace,
  scoreRelevance,
  uniqueBy,
} from './core.mjs';

export function parseCli(rawArgs = process.argv.slice(2)) {
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
    },
  });

  const command = positionals[0] ?? '';
  let limit = null;
  if (values.limit) {
    limit = Number.parseInt(values.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) {
      throw new Error(`Invalid --limit value: "${values.limit}". Must be a positive integer.`);
    }
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
  };
}

async function loadConfig(configArg, cliQuery = null) {
  const configPath = path.resolve(process.cwd(), configArg);
  const parsed = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const baseDir = path.dirname(configPath);

  if (!parsed.group?.id) throw new Error('config.group.id is required');
  const queries = cliQuery ? [cliQuery] : parsed.queries;
  if (!Array.isArray(queries) || queries.length === 0) throw new Error('config.queries must contain at least one query');

  return {
    ...parsed,
    _configPath: configPath,
    _baseDir: baseDir,
    queries,
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
      safetyCapRounds: 90,
      scrollPixels: 1500,
      maxCandidatesPerQuery: 500,
      ...parsed.discovery,
    },
    collection: {
      maxPosts: 25,
      expandRounds: 40,
      maxClicksPerRound: 30,
      outputDir: './output',
      rawHtmlMaxChars: 2_000_000,
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
  const discoveryDiagnostics = [];

  for (const query of config.queries) {
    console.log(`\n[discover] query="${query}"`);
    try {
      await page.goto(searchUrl(config.group.id, query), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    } catch {
      await randomPause(config, 2);
      await page.goto(searchUrl(config.group.id, query), { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    }
    await randomPause(config, 1.5);

    const safetyCapRounds = config.discovery.safetyCapRounds ?? 90;
    const scrollPixels = config.discovery.scrollPixels ?? 1500;
    const tolerance = 100;
    let stableBottomRounds = 0;
    let prevScrollHeight = 0;
    let completionReason = '';
    const roundLogs = [];

    for (let round = 1; round <= safetyCapRounds; round += 1) {
      const rows = await extractDiscoveryCandidates(page, config.group.id);
      let newThisRound = 0;

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
          newThisRound += 1;
        } else {
          existing.queries.add(query);
          existing.discoveredUrls.add(row.href);
          if ((row.preview?.length ?? 0) > (existing.preview?.length ?? 0)) {
            existing.preview = normalizeWhitespace(row.preview);
          }
        }
      }

      const metrics = await page.evaluate(() => {
        const el = document.scrollingElement || document.body;
        const scrollTop = window.scrollY || el.scrollTop || 0;
        const scrollHeight = el.scrollHeight;
        const clientHeight = window.innerHeight || el.clientHeight;
        const remainingPx = Math.max(0, scrollHeight - (scrollTop + clientHeight));
        return { scrollTop, scrollHeight, clientHeight, remainingPx };
      });

      const atBottom = metrics.remainingPx <= tolerance;
      const heightIncreased = metrics.scrollHeight > prevScrollHeight + 20;

      if (atBottom) {
        if (newThisRound === 0 && !heightIncreased) {
          stableBottomRounds += 1;
        } else {
          stableBottomRounds = 0;
        }
      } else {
        stableBottomRounds = 0;
      }

      const queryCandidatesCount = [...candidates.values()].filter((item) => item.queries.has(query)).length;

      const logEntry = {
        round,
        candidates: queryCandidatesCount,
        newThisRound,
        scrollTop: metrics.scrollTop,
        scrollHeight: metrics.scrollHeight,
        clientHeight: metrics.clientHeight,
        remainingPx: metrics.remainingPx,
        atBottom,
        heightIncreased,
        stableBottomRounds,
      };
      roundLogs.push(logEntry);

      console.log(`round=${round} candidates=${queryCandidatesCount} new=${newThisRound} atBottom=${atBottom} remainingPx=${metrics.remainingPx} scrollHeight=${metrics.scrollHeight} stable=${stableBottomRounds}`);

      if (stableBottomRounds >= 3) {
        completionReason = 'bottom-stable';
        break;
      }

      prevScrollHeight = metrics.scrollHeight;

      // Scroll down
      await page.evaluate((step) => window.scrollBy(0, step), scrollPixels);
      await randomPause(config, 0.7);
    }

    if (!completionReason) {
      completionReason = 'safety-cap';
    }

    const queryCandidatesCount = [...candidates.values()].filter((item) => item.queries.has(query)).length;
    const completeness = completionReason === 'bottom-stable' ? 'complete' : 'truncated';
    console.log(`\n[discover] COMPLETE query="${query}" candidates=${queryCandidatesCount} reason=${completionReason} completeness=${completeness}`);

    discoveryDiagnostics.push({
      query,
      candidatesCount: queryCandidatesCount,
      totalRounds: roundLogs.length,
      completionReason,
      completeness,
      truncationReason: completeness === 'truncated' ? 'safety-cap' : null,
      lastMetrics: roundLogs[roundLogs.length - 1] ?? null,
      roundLogs,
    });
  }

  const rankedCandidates = [...candidates.values()].map((item) => ({
    ...item,
    queries: [...item.queries],
    discoveredUrls: [...item.discoveredUrls],
    relevance: scoreRelevance(item.preview, config.relevance),
  }));

  return { candidates: rankedCandidates, discoveryDiagnostics };
}

async function switchCommentSortToAllComments(page, postId, testSortSwitch = false) {
  try {
    const dialogs = page.locator('[role="dialog"], [aria-modal="true"]');
    const dialogCount = await dialogs.count();
    let surface = page.locator('body');
    for (let i = 0; i < dialogCount; i += 1) {
      const d = dialogs.nth(i);
      const isVis = await d.isVisible().catch(() => false);
      if (!isVis) continue;
      const text = await d.innerText().catch(() => '');
      if (text.includes(postId) || (await d.locator(`a[href*="${postId}"]`).count()) > 0 || (await d.locator('[role="article"]').count()) > 0) {
        surface = d;
        break;
      }
    }

    let findTrigger = await surface.evaluate((root) => {
      const clickables = [...root.querySelectorAll('button, [role="button"], div[aria-haspopup="menu"], div[tabindex]')];
      for (const el of clickables) {
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (/^(?:phù hợp nhất|most relevant|bình luận hàng đầu|top comments|mới nhất|newest)$/i.test(text)) {
          return { found: true, text, isAll: false };
        }
        if (/^(?:tất cả bình luận|all comments)$/i.test(text)) {
          return { found: true, text, isAll: true };
        }
      }
      return { found: false, text: null, isAll: false };
    });

    if (!findTrigger.found) {
      console.log(`[sort] Comment sort trigger not found on surface.`);
      return { initial: 'unknown', final: 'unknown', switched: false, verified: false };
    }

    // If testSortSwitch is requested and we are already in All comments, reset to Phù hợp nhất first
    if (testSortSwitch && findTrigger.isAll) {
      console.log(`[sort] Resetting to "Phù hợp nhất" for live transition test...`);
      const triggerLoc = surface.locator('div[role="button"][aria-haspopup="menu"], [role="button"], button').filter({
        hasText: /phù hợp nhất|most relevant|tất cả bình luận|all comments|bình luận hàng đầu|top comments|mới nhất|newest/i,
      }).first();
      await triggerLoc.scrollIntoViewIfNeeded().catch(() => {});
      await triggerLoc.click({ timeout: 5000 });
      await page.waitForTimeout(1000);
      const mostRelOpt = page.locator('[role="menuitem"], [role="menuitemradio"]').filter({
        hasText: /phù hợp nhất|most relevant/i,
      }).first();
      if (await mostRelOpt.isVisible().catch(() => false)) {
        await mostRelOpt.click({ timeout: 5000 });
        await page.waitForTimeout(2500);
        const recheckInitial = await surface.evaluate((root) => {
          const clickables = [...root.querySelectorAll('button, [role="button"], div[aria-haspopup="menu"], div[tabindex]')];
          for (const el of clickables) {
            const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            if (/^(?:phù hợp nhất|most relevant|bình luận hàng đầu|top comments|mới nhất|newest)$/i.test(text)) {
              return { found: true, text, isAll: false };
            }
          }
          return null;
        });
        if (recheckInitial) findTrigger = recheckInitial;
      }
    }

    if (findTrigger.isAll) {
      console.log(`[sort] initial="${findTrigger.text}" (already in All comments mode) switched=false verified=true`);
      return { initial: findTrigger.text, final: findTrigger.text, switched: false, verified: true };
    }

    console.log(`[sort] initial="${findTrigger.text}"`);

    const triggerLocator = surface.locator('div[role="button"][aria-haspopup="menu"], [role="button"], button').filter({
      hasText: /phù hợp nhất|most relevant|tất cả bình luận|all comments|bình luận hàng đầu|top comments|mới nhất|newest/i,
    }).first();

    await triggerLocator.scrollIntoViewIfNeeded().catch(() => {});
    await triggerLocator.click({ timeout: 5000 });
    console.log(`[sort] clicked trigger`);
    await page.waitForTimeout(1000);

    const menuOption = page.locator('[role="menuitem"], [role="menuitemradio"]').filter({
      hasText: /tất cả bình luận|all comments/i,
    });

    const optionCount = await menuOption.count();
    let clicked = false;
    if (optionCount > 0) {
      for (let i = 0; i < optionCount; i += 1) {
        const opt = menuOption.nth(i);
        if (await opt.isVisible().catch(() => false)) {
          await opt.click({ timeout: 5000 });
          clicked = true;
          console.log(`[sort] clicked "Tất cả bình luận"`);
          break;
        }
      }
    }

    if (clicked) {
      await page.waitForTimeout(2500);
      const recheckText = await surface.evaluate((root) => {
        const clickables = [...root.querySelectorAll('button, [role="button"], div[aria-haspopup="menu"], div[tabindex]')];
        for (const el of clickables) {
          const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          if (/^(?:tất cả bình luận|all comments|phù hợp nhất|most relevant|mới nhất|newest)$/i.test(text)) {
            return text;
          }
        }
        return null;
      });

      if (recheckText && /^(?:tất cả bình luận|all comments)$/i.test(recheckText)) {
        console.log(`[sort] final="${recheckText}" switched=true verified=true`);
        return {
          initial: findTrigger.text,
          final: recheckText,
          switched: true,
          verified: true,
        };
      } else if (recheckText) {
        console.warn(`[sort] final="${recheckText}" switched=false verified=false (still in "${recheckText}")`);
        return {
          initial: findTrigger.text,
          final: recheckText,
          switched: false,
          verified: false,
        };
      } else {
        console.warn(`[sort] final="unverified" switched=false verified=false (recheck returned null)`);
        return {
          initial: findTrigger.text,
          final: 'unverified',
          switched: false,
          verified: false,
        };
      }
    }

    console.warn(`[sort] Menu opened but "Tất cả bình luận" option was not clickable.`);
    return { initial: findTrigger.text, final: findTrigger.text, switched: false, verified: false };
  } catch (err) {
    console.warn(`[sort] Failed to switch comment sort: ${err?.message ?? err}`);
    return { initial: 'error', final: 'error', switched: false, verified: false, error: err?.message };
  }
}

async function expandPost(page, postId, config, testSortSwitch = false) {
  const maxRounds = config.collection.expandRounds ?? 80;
  const maxClicksPerRound = config.collection.maxClicksPerRound ?? 30;
  const tolerance = 80;

  // 1. Detect post surface & actively switch sort mode to "Tất cả bình luận"
  const commentSort = await switchCommentSortToAllComments(page, postId, testSortSwitch);

  const initInfo = await page.evaluate(({ postId }) => {
    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')];
    const matchingDialog = dialogs.find((d) => {
      if (!d.offsetParent && d.offsetWidth === 0 && d.offsetHeight === 0) return false;
      const text = d.innerText || '';
      return text.includes(postId) || !!d.querySelector(`a[href*="${postId}"]`);
    }) || dialogs.find((d) => {
      return d.querySelectorAll('[role="article"]').length > 0 && (d.offsetHeight > 200 || (d.innerText || '').length > 200);
    }) || null;

    const surface = matchingDialog || document.querySelector('[role="main"]') || document.querySelector('main') || document.body;
    const surfaceType = matchingDialog ? 'dialog' : (document.querySelector('[role="main"]') || document.querySelector('main') ? 'main' : 'body');

    return { surfaceType };
  }, { postId });

  let prevArticles = 0;
  let prevScrollHeight = 0;
  let bottomIdleRounds = 0;
  let failedScrollAssertion = false;
  let completionReason = '';
  const roundLogs = [];
  const clickedByLabel = {};
  const initialWindowScrollY = await page.evaluate(() => window.scrollY);

  for (let round = 1; round <= maxRounds; round += 1) {
    const stepResult = await page.evaluate(async ({ postId, maxClicksPerRound, expandRegexesSrc, tolerance, initialWindowScrollY }) => {
      const EXPAND_REGEXES = expandRegexesSrc.map((src) => new RegExp(src, 'i'));
      const isExpandText = (text) => EXPAND_REGEXES.some((re) => re.test(text));

      const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')];
      const matchingDialog = dialogs.find((d) => {
        if (!d.offsetParent && d.offsetWidth === 0 && d.offsetHeight === 0) return false;
        const text = d.innerText || '';
        return text.includes(postId) || !!d.querySelector(`a[href*="${postId}"]`);
      }) || dialogs.find((d) => {
        return d.querySelectorAll('[role="article"]').length > 0 && (d.offsetHeight > 200 || (d.innerText || '').length > 200);
      }) || null;

      const surface = matchingDialog || document.querySelector('[role="main"]') || document.querySelector('main') || document.body;

      const findScrollContainer = (root) => {
        const candidates = [];
        const elements = [root, ...root.querySelectorAll('*')];
        for (const el of elements) {
          const style = window.getComputedStyle(el);
          const isScrollStyle = (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 20;
          const articleCount = el.querySelectorAll('[role="article"]').length;
          if (isScrollStyle) {
            candidates.push({
              el,
              reason: `overflow-${style.overflowY}-with-scrollDiff-${el.scrollHeight - el.clientHeight}`,
              articleCount,
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
            });
          }
        }
        candidates.sort((a, b) => b.articleCount - a.articleCount || b.scrollHeight - a.scrollHeight);
        return candidates[0] || {
          el: root,
          reason: 'surface-fallback',
          articleCount: root.querySelectorAll('[role="article"]').length,
          scrollHeight: root.scrollHeight,
          clientHeight: root.clientHeight,
        };
      };

      const scrollInfo = findScrollContainer(surface);
      const container = scrollInfo.el;

      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && (el.offsetWidth > 0 || el.offsetHeight > 0);
      };

      const prevScrollTop = container.scrollTop;
      const clickedThisRound = [];

      // Multi-pass expansion at current scroll position
      let sweepPass = 0;
      while (sweepPass < 4) {
        sweepPass += 1;
        const clickables = [...surface.querySelectorAll('button, a, [role="button"]')];
        const eligible = clickables.filter((el) => {
          if (!isVisible(el)) return false;
          const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          return isExpandText(text);
        });

        if (eligible.length === 0) break;
        let clickedInPass = 0;
        for (const btn of eligible) {
          if (clickedThisRound.length >= maxClicksPerRound) break;
          const text = (btn.innerText || btn.textContent || '').replace(/\s+/g, ' ').trim();
          try {
            btn.scrollIntoView({ block: 'nearest' });
            btn.click();
            clickedThisRound.push(text);
            clickedInPass += 1;
            await new Promise((r) => setTimeout(r, 450));
          } catch {}
        }
        if (clickedInPass === 0) break;
      }

      // Scroll container down
      const scrollStep = Math.max(300, Math.round((container.clientHeight || 500) * 0.75));
      container.scrollTop += scrollStep;
      await new Promise((r) => setTimeout(r, 1200));

      const currentWindowScrollY = window.scrollY;
      const scrollFailed = Math.abs(currentWindowScrollY - initialWindowScrollY) > 50 && container.scrollTop === prevScrollTop;

      const currArticles = surface.querySelectorAll('[role="article"]').length;
      const currScrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;
      const maxScrollTop = Math.max(0, currScrollHeight - clientHeight);
      const remainingPx = Math.max(0, currScrollHeight - (container.scrollTop + clientHeight));
      const atBottom = remainingPx <= tolerance;

      return {
        scrollTop: container.scrollTop,
        scrollHeight: currScrollHeight,
        clientHeight,
        maxScrollTop,
        remainingPx,
        atBottom,
        visibleArticles: currArticles,
        clickedTexts: clickedThisRound,
        scrollFailed,
        windowScrollY: currentWindowScrollY,
        scrollContainerReason: scrollInfo.reason,
      };
    }, {
      postId,
      maxClicksPerRound,
      expandRegexesSrc: EXPAND_REGEXES.map((re) => re.source),
      tolerance,
      initialWindowScrollY,
    });

    if (stepResult.scrollFailed) failedScrollAssertion = true;

    for (const text of stepResult.clickedTexts) {
      clickedByLabel[text] = (clickedByLabel[text] || 0) + 1;
    }

    const newBlocks = stepResult.visibleArticles > prevArticles;
    const heightIncreased = stepResult.scrollHeight > prevScrollHeight + 20;

    const roundData = {
      round,
      scrollTop: stepResult.scrollTop,
      scrollHeight: stepResult.scrollHeight,
      clientHeight: stepResult.clientHeight,
      maxScrollTop: stepResult.maxScrollTop,
      remainingPx: stepResult.remainingPx,
      atBottom: stepResult.atBottom,
      visibleArticles: stepResult.visibleArticles,
      clickedCount: stepResult.clickedTexts.length,
      clickedTexts: stepResult.clickedTexts.slice(0, 8),
      newBlocksAppeared: newBlocks,
      scrollHeightIncreased: heightIncreased,
      windowScrollY: stepResult.windowScrollY,
      scrollContainerReason: stepResult.scrollContainerReason,
    };
    roundLogs.push(roundData);

    if (stepResult.atBottom) {
      if (stepResult.clickedTexts.length === 0 && !newBlocks && !heightIncreased) {
        bottomIdleRounds += 1;
      } else {
        bottomIdleRounds = 0;
      }
    } else {
      bottomIdleRounds = 0;
    }

    console.log(`[post] round=${round} comments=${stepResult.visibleArticles} new=${stepResult.visibleArticles - prevArticles} [scroll] scrollTop=${stepResult.scrollTop} scrollHeight=${stepResult.scrollHeight} remainingPx=${stepResult.remainingPx} atBottom=${stepResult.atBottom} [expand] clicked=${stepResult.clickedTexts.length} [stableBottom]=${bottomIdleRounds}`);

    prevArticles = stepResult.visibleArticles;
    prevScrollHeight = stepResult.scrollHeight;

    if (bottomIdleRounds >= 3) {
      completionReason = 'bottom-stable';
      break;
    }
  }

  if (!completionReason) {
    completionReason = 'safety-cap';
  }

  const completeness = completionReason === 'bottom-stable' ? 'complete' : 'truncated';
  console.log(`\n[post] COMPLETE comments=${prevArticles} reason=${completionReason} completeness=${completeness}`);

  // Scan suspicious unmatched controls
  const suspiciousUnmatched = await page.evaluate(({ expandRegexesSrc }) => {
    const EXPAND_REGEXES = expandRegexesSrc.map((src) => new RegExp(src, 'i'));
    const isExpandText = (text) => EXPAND_REGEXES.some((re) => re.test(text));
    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')];
    const surface = dialogs[0] || document.querySelector('[role="main"]') || document.body;
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && (el.offsetWidth > 0 || el.offsetHeight > 0);
    };
    const allButtons = [...surface.querySelectorAll('button, a, [role="button"]')].filter(isVisible);
    const suspicious = [];
    for (const btn of allButtons) {
      const text = (btn.innerText || btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length > 0 && text.length < 80 && !isExpandText(text)) {
        const lower = text.toLowerCase();
        if (['bình luận', 'phản hồi', 'câu trả lời', 'comment', 'reply', 'replies', 'xem thêm', 'see more'].some((k) => lower.includes(k))) {
          if (!['bình luận', 'viết bình luận công khai…', 'viết phản hồi công khai…', 'tất cả bình luận', 'phù hợp nhất', 'all comments', 'most relevant'].includes(lower) && !/^\d+\s*bình luận$/i.test(text)) {
            suspicious.push(text);
          }
        }
      }
    }
    return suspicious;
  }, { expandRegexesSrc: EXPAND_REGEXES.map((re) => re.source) });

  return {
    surfaceType: initInfo.surfaceType,
    scrollContainerReason: roundLogs[0]?.scrollContainerReason ?? 'detected-container',
    failedScrollAssertion,
    commentSort,
    totalRounds: roundLogs.length,
    completionReason,
    completeness,
    truncationReason: completeness === 'truncated' ? 'safety-cap' : null,
    finalArticles: prevArticles,
    finalRemainingPx: roundLogs[roundLogs.length - 1]?.remainingPx ?? 0,
    finalAtBottom: roundLogs[roundLogs.length - 1]?.atBottom ?? false,
    clickedByLabel,
    suspiciousUnmatched,
    roundLogs,
  };
}

async function extractPostBundle(page, postId, rawHtmlMaxChars, expansion = null) {
  return page.evaluate(({ postId, rawHtmlMaxChars, expansion }) => {
    // 8. Extraction must use the same selected post surface
    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')];
    const matchingDialog = dialogs.find((d) => {
      if (!d.offsetParent && d.offsetWidth === 0 && d.offsetHeight === 0) return false;
      const text = d.innerText || '';
      return text.includes(postId) || !!d.querySelector(`a[href*="${postId}"]`);
    }) || dialogs.find((d) => {
      return d.querySelectorAll('[role="article"]').length > 0 && (d.offsetHeight > 200 || (d.innerText || '').length > 200);
    }) || null;

    const surface = matchingDialog || document.querySelector('[role="main"]') || document.querySelector('main') || document.body;
    const surfaceType = matchingDialog ? 'dialog' : (document.querySelector('[role="main"]') || document.querySelector('main') ? 'main' : 'body');

    // Scoped article blocks strictly within the detected post surface
    const allArticles = [...surface.querySelectorAll('[role="article"]')];

    // --- helpers ---

    /** True when anchor points to canonical post permalink (not #, not comment_id) */
    const isCanonicalPostAnchor = (a) => {
      const rawHref = a.getAttribute('href') || '';
      if (!rawHref || rawHref === '#' || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return false;
      try {
        const url = new URL(a.href, location.origin);
        if (!/facebook\.com$/i.test(url.hostname)) return false;
        if (url.searchParams.has('comment_id') || url.searchParams.has('reply_comment_id')) return false;
        const path = url.pathname.replace(/\/+$/, '');
        const isPostPath = path.endsWith(`/${postId}`) || path.includes(`/posts/${postId}`) || path.includes(`/permalink/${postId}`);
        const isMultiPermalink = url.searchParams.get('multi_permalinks') === postId;
        return isPostPath || isMultiPermalink;
      } catch {
        return false;
      }
    };

    /** True when anchor is a comment/reply permalink */
    const isCommentAnchor = (a) => {
      const rawHref = a.getAttribute('href') || '';
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return false;
      try {
        const url = new URL(a.href, location.origin);
        return (url.searchParams.has('comment_id') || url.searchParams.has('reply_comment_id')) && url.pathname.includes(postId);
      } catch {
        return false;
      }
    };

    /** True when article has aria-label indicating it is a comment or reply */
    const isCommentAriaLabel = (node) => {
      const label = (node.getAttribute('aria-label') || '').toLowerCase();
      return (
        label.includes('bình luận') ||
        label.includes('phản hồi') ||
        label.includes('đáp lại') ||
        label.includes('comment') ||
        label.includes('reply') ||
        label.includes('replied')
      );
    };

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

    // --- score each article as a potential post root (for standalone pages) ---

    const scored = allArticles.map((node) => {
      const anchors = [...node.querySelectorAll('a[href]')];
      const hasCanonicalLink = anchors.some(isCanonicalPostAnchor);
      const hasCommentLinks = anchors.some(isCommentAnchor);
      const isCommentByAria = isCommentAriaLabel(node);
      const nestedArticleCount = node.querySelectorAll('[role="article"]').length;
      const isTopLevel = !node.parentElement?.closest('[role="article"]');
      const textLen = (node.innerText ?? '').length;

      let score = 0;
      const reasons = [];

      if (isCommentByAria) {
        score -= 200;
        reasons.push('comment-aria-label');
      }

      if (hasCanonicalLink) {
        score += 100;
        reasons.push('has-canonical-post-link');
      }

      if (hasCommentLinks && !hasCanonicalLink) {
        score -= 50;
        reasons.push('has-only-comment-links');
      }

      if (!hasCanonicalLink && !hasCommentLinks) {
        score -= 30;
        reasons.push('no-post-links');
      }

      if (nestedArticleCount > 0) {
        score += 30 * Math.min(nestedArticleCount, 5);
        reasons.push(`contains-${nestedArticleCount}-nested-articles`);
      }

      if (isTopLevel) {
        score += 10;
        reasons.push('top-level');
      }

      // Tiebreaker: prefer longer content
      score += Math.min(textLen / 1000, 20);

      return {
        node,
        score,
        reasons,
        textPreview: (node.innerText ?? '').slice(0, 300),
        hasCanonicalLink,
        hasCommentLinks,
        isCommentByAria,
        nestedArticleCount,
        isTopLevel,
      };
    });

    let root = null;
    let rootSelectionType = '';
    let selectedScore = 0;
    let selectedReasons = [];

    if (surfaceType === 'dialog') {
      root = surface;
      rootSelectionType = 'dialog';
      selectedScore = 150;
      selectedReasons = ['permalink-modal-dialog'];
    } else {
      scored.sort((a, b) => b.score - a.score);
      const bestCandidate = scored[0] && scored[0].score > 0 && !scored[0].isCommentByAria ? scored[0] : null;
      root = bestCandidate?.node ?? surface;
      rootSelectionType = bestCandidate ? 'scored-article' : 'fallback-main';
      selectedScore = bestCandidate?.score ?? 0;
      selectedReasons = bestCandidate?.reasons ?? ['fallback-main'];
    }

    // --- collect comments ---
    // If root is dialog, comments are all role="article" elements inside dialog.
    // If root is article, comments are all role="article" elements on page except root.
    const commentNodes = root === surface && surfaceType === 'dialog'
      ? allArticles
      : allArticles.filter((article) => article !== root);

    const indexByNode = new Map(commentNodes.map((node, index) => [node, index]));

    const comments = commentNodes.map((node, index) => {
      let parentArticle = node.parentElement?.closest('[role="article"]') ?? null;
      while (parentArticle && parentArticle !== root && !indexByNode.has(parentArticle)) {
        parentArticle = parentArticle.parentElement?.closest('[role="article"]') ?? null;
      }
      const parentIndex = parentArticle && parentArticle !== root ? indexByNode.get(parentArticle) ?? null : null;

      // Determine nesting depth relative to root
      let depth = 0;
      let cursor = node.parentElement?.closest('[role="article"]') ?? null;
      while (cursor && cursor !== root) {
        depth += 1;
        cursor = cursor.parentElement?.closest('[role="article"]') ?? null;
      }
      if (!root.contains(node)) depth = 0;

      const links = directLinks(node);
      const author = pickAuthor(links);
      const commentLink = links.find((x) => /[?&](?:comment_id|reply_comment_id)=\d+/i.test(x.href)) ?? null;
      const isNested = root.contains(node);

      return {
        index,
        parentIndex,
        depth,
        author: author?.text ?? null,
        authorUrl: author?.href ?? null,
        rawText: ownText(node),
        links,
        sourceUrl: commentLink?.href ?? null,
        hierarchySource: isNested ? 'nested' : 'sibling',
      };
    });

    const rootLinks = directLinks(root);
    const rootAuthor = pickAuthor(rootLinks);
    const html = root.outerHTML ?? '';

    // Diagnostic: top article candidates (bounded)
    const articleCandidates = scored.slice(0, 15).map((c) => ({
      score: c.score,
      reasons: c.reasons,
      textPreview: c.textPreview,
      hasCanonicalLink: c.hasCanonicalLink,
      hasCommentLinks: c.hasCommentLinks,
      isCommentByAria: c.isCommentByAria,
      nestedArticleCount: c.nestedArticleCount,
      isTopLevel: c.isTopLevel,
    }));

    return {
      pageUrl: location.href,
      rootFoundByPostLink: rootSelectionType === 'dialog' || (scored[0]?.hasCanonicalLink ?? false),
      rootSelection: {
        type: rootSelectionType,
        candidateCount: allArticles.length,
        selectedScore,
        selectedReasons,
        articleCandidates,
      },
      expansion: expansion ?? null,
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
  }, { postId, rawHtmlMaxChars, expansion });
}

function normalizeBundle(candidate, bundle, config) {
  const postText = cleanFacebookPostText(bundle.post.rawText, bundle.post.author ?? '') ||
    cleanFacebookPostText(candidate.preview ?? '', bundle.post.author ?? '');
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
      rootSelection: bundle.rootSelection ?? null,
      expansion: bundle.expansion ?? null,
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

async function collect(config, options = {}) {
  const runDir = resolveConfigPath(config, path.join(config.collection.outputDir, timestampSlug()));
  const rawDir = path.join(runDir, 'raw');
  const normalizedDir = path.join(runDir, 'normalized');
  await fs.mkdir(rawDir, { recursive: true });
  await fs.mkdir(normalizedDir, { recursive: true });

  const runJsonPath = path.join(runDir, 'RUN.json');
  const startedAt = new Date().toISOString();
  let currentStage = 'init';

  /** Persist current run status to RUN.json */
  const writeRunStatus = async (fields) => {
    await fs.writeFile(runJsonPath, JSON.stringify({
      startedFromConfig: config._configPath,
      startedAt,
      group: config.group,
      queries: config.queries,
      options: {
        query: options.query ?? null,
        discoveryOnly: Boolean(options.discoveryOnly),
        postUrl: options.postUrl ?? null,
        postId: options.postId ?? null,
        limit: options.limit ?? null,
      },
      note: 'Local research evidence. Do not commit raw Facebook dumps or browser profile data.',
      ...fields,
    }, null, 2));
  };

  await writeRunStatus({ status: 'running', stage: currentStage });

  const { context, page } = await openContext(config);
  const collected = [];
  try {
    // Mode 3: Direct Post Mode (Bypasses discovery completely)
    if (options.postUrl || options.postId) {
      currentStage = 'direct-post';
      await writeRunStatus({ status: 'running', stage: currentStage });

      let candidate = null;
      if (options.postUrl) {
        const canonical = canonicalizeFacebookPostUrl(options.postUrl, config.group.id);
        if (!canonical) throw new Error(`Invalid Facebook post URL: "${options.postUrl}"`);
        candidate = {
          ...canonical,
          preview: '',
          queries: options.query ? [options.query] : [],
          discoveredUrls: [options.postUrl],
          relevance: { score: 10, matched: [], threshold: 5, relevant: true },
        };
      } else {
        const canonicalUrl = `https://www.facebook.com/groups/${config.group.id}/permalink/${options.postId}/`;
        candidate = {
          groupId: config.group.id,
          postId: options.postId,
          canonicalUrl,
          key: `facebook:${config.group.id}:${options.postId}`,
          preview: '',
          queries: options.query ? [options.query] : [],
          discoveredUrls: [canonicalUrl],
          relevance: { score: 10, matched: [], threshold: 5, relevant: true },
        };
      }

      console.log(`\n[direct-post] Bypassing discovery. Opening target post: ${candidate.canonicalUrl}`);
      await page.goto(candidate.canonicalUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await randomPause(config, 1.4);
      const expansion = await expandPost(page, candidate.postId, config, options.testSortSwitch);
      const bundle = await extractPostBundle(page, candidate.postId, config.collection.rawHtmlMaxChars, expansion);
      const normalized = normalizeBundle(candidate, bundle, config);

      await fs.writeFile(path.join(rawDir, `${candidate.postId}.json`), JSON.stringify({
        source: candidate,
        capturedAt: normalized.capturedAt,
        pageUrl: bundle.pageUrl,
        rootSelection: bundle.rootSelection ?? null,
        expansion: bundle.expansion ?? null,
        raw: bundle.raw,
      }, null, 2));
      await fs.writeFile(path.join(normalizedDir, `${candidate.postId}.json`), JSON.stringify(normalized, null, 2));
      await fs.writeFile(path.join(normalizedDir, `${candidate.postId}.md`), toMarkdown(normalized));
      collected.push(normalized);

      await fs.writeFile(path.join(runDir, 'dataset.json'), JSON.stringify(collected, null, 2));
      await writeRunStatus({
        status: 'completed',
        completedAt: new Date().toISOString(),
        stage: 'done',
        records: 1,
        mode: 'direct-post',
      });

      console.log(`\n[direct-post] Complete. Saved 1 post to: ${runDir}`);
      return;
    }

    // Mode 1 & Mode 2: Search Discovery
    currentStage = 'discovery';
    await writeRunStatus({ status: 'running', stage: currentStage });

    const { candidates, discoveryDiagnostics } = await discover(page, config);
    const ranked = candidates
      .filter((item) => item.relevance.relevant)
      .sort((a, b) => b.relevance.score - a.relevance.score || b.preview.length - a.preview.length);

    await fs.writeFile(path.join(runDir, 'discovery.json'), JSON.stringify({
      group: config.group,
      queries: config.queries,
      candidateCount: candidates.length,
      relevantCount: ranked.length,
      discoveryDiagnostics,
      candidates: candidates.map((item) => ({ ...item, relevance: item.relevance })),
    }, null, 2));

    // Mode 2: Discovery Only
    if (options.discoveryOnly) {
      await writeRunStatus({
        status: 'completed',
        completedAt: new Date().toISOString(),
        stage: 'discovery-complete',
        records: 0,
        candidateCount: candidates.length,
        relevantCount: ranked.length,
        mode: 'discovery-only',
      });
      console.log(`\n[discovery-only] Complete. Candidates: ${candidates.length}, Relevant: ${ranked.length}. Local output: ${runDir}`);
      return;
    }

    // Mode 1: Search + Collect Relevant Posts
    const maxPosts = Number.isFinite(options.limit) && options.limit > 0
      ? options.limit
      : (options.query ? ranked.length : config.collection.maxPosts);
    const selected = ranked.slice(0, maxPosts);

    console.log(`\n[select] ${candidates.length} candidates, ${ranked.length} relevant, collecting ${selected.length}`);

    currentStage = 'collection';
    await writeRunStatus({ status: 'running', stage: currentStage, selectedCount: selected.length });

    const postOutcomes = [];

    for (let i = 0; i < selected.length; i += 1) {
      const candidate = selected[i];
      console.log(`\n[collect ${i + 1}/${selected.length}] ${candidate.canonicalUrl} score=${candidate.relevance.score}`);

      let attempt = 0;
      let postSuccess = false;
      let lastError = null;
      let outcomeData = null;

      while (attempt < 2 && !postSuccess) {
        attempt += 1;
        try {
          await page.goto(candidate.canonicalUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
          await randomPause(config, 1.4);
          const expansion = await expandPost(page, candidate.postId, config, options.testSortSwitch);
          const bundle = await extractPostBundle(page, candidate.postId, config.collection.rawHtmlMaxChars, expansion);
          const normalized = normalizeBundle(candidate, bundle, config);

          await fs.writeFile(path.join(rawDir, `${candidate.postId}.json`), JSON.stringify({
            source: candidate,
            capturedAt: normalized.capturedAt,
            pageUrl: bundle.pageUrl,
            rootSelection: bundle.rootSelection ?? null,
            expansion: bundle.expansion ?? null,
            raw: bundle.raw,
          }, null, 2));
          await fs.writeFile(path.join(normalizedDir, `${candidate.postId}.json`), JSON.stringify(normalized, null, 2));
          await fs.writeFile(path.join(normalizedDir, `${candidate.postId}.md`), toMarkdown(normalized));
          collected.push(normalized);

          outcomeData = {
            postId: candidate.postId,
            url: candidate.canonicalUrl,
            author: normalized.post.author ?? 'Unknown',
            commentsCount: normalized.comments.length,
            status: expansion.completeness === 'complete' ? 'complete' : 'truncated',
            completionReason: expansion.completionReason,
            truncationReason: expansion.truncationReason,
          };
          postSuccess = true;
          await randomPause(config, 1.3);
        } catch (err) {
          lastError = err;
          if (attempt < 2) {
            console.warn(`[retry 1/1] Post ${candidate.postId} encountered error: ${err?.message ?? err}. Retrying in 3s...`);
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
      }

      if (!postSuccess) {
        console.error(`[failed] Post ${candidate.postId} failed after ${attempt} attempts: ${lastError?.message ?? lastError}`);
        outcomeData = {
          postId: candidate.postId,
          url: candidate.canonicalUrl,
          author: null,
          commentsCount: 0,
          status: 'failed',
          error: lastError?.message ?? String(lastError),
        };
      }

      postOutcomes.push(outcomeData);
    }

    const completeCount = postOutcomes.filter((o) => o.status === 'complete').length;
    const truncatedCount = postOutcomes.filter((o) => o.status === 'truncated').length;
    const failedCount = postOutcomes.filter((o) => o.status === 'failed').length;
    const skippedCount = Math.max(0, ranked.length - selected.length);
    const incompletePosts = postOutcomes.filter((o) => o.status !== 'complete');

    const reconciliation = {
      topic: options.query ?? (config.queries.length === 1 ? config.queries[0] : 'all'),
      discovered: candidates.length,
      relevant: ranked.length,
      attempted: selected.length,
      complete: completeCount,
      truncated: truncatedCount,
      failed: failedCount,
      skipped: skippedCount,
      incompletePosts,
      postOutcomes,
    };

    await fs.writeFile(path.join(runDir, 'reconciliation.json'), JSON.stringify(reconciliation, null, 2));
    await fs.writeFile(path.join(runDir, 'dataset.json'), JSON.stringify(collected, null, 2));

    console.log(`\n==================================================`);
    console.log(`TOPIC RECONCILIATION: "${reconciliation.topic}"`);
    console.log(`==================================================`);
    console.log(`Discovered:  ${reconciliation.discovered}`);
    console.log(`Relevant:    ${reconciliation.relevant}`);
    console.log(`Attempted:   ${reconciliation.attempted}`);
    console.log(`Complete:    ${reconciliation.complete}`);
    console.log(`Truncated:   ${reconciliation.truncated}`);
    console.log(`Failed:      ${reconciliation.failed}`);
    console.log(`Skipped:     ${reconciliation.skipped}`);
    if (incompletePosts.length > 0) {
      console.log(`\nIncomplete posts:`);
      for (const p of incompletePosts) {
        console.log(`- ${p.postId} (${p.url}): ${p.status} - ${p.truncationReason || p.error || p.completionReason}`);
      }
    }
    console.log(`==================================================\n`);

    await writeRunStatus({
      status: failedCount > 0 ? 'completed-with-errors' : 'completed',
      completedAt: new Date().toISOString(),
      stage: 'done',
      records: collected.length,
      reconciliation,
      mode: 'discovery-and-collect',
    });

    console.log(`Done. Local output: ${runDir}`);
  } catch (err) {
    await writeRunStatus({
      status: 'failed',
      failedAt: new Date().toISOString(),
      stage: currentStage,
      records: collected.length,
      error: {
        name: err?.name ?? 'Error',
        message: err?.message ?? String(err),
        // Only include stack in local diagnostics; RUN.json is .gitignored
        stack: err?.stack ?? null,
      },
    }).catch(() => { /* best effort */ });
    throw err;
  } finally {
    await context.close();
  }
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  if (!['login', 'collect'].includes(cli.command)) {
    console.error('Usage: node src/index.mjs <login|collect> [--config config.json] [--limit N] [--query "topic"] [--discovery-only] [--post-url <url>] [--post-id <id>]');
    process.exitCode = 2;
    return;
  }

  const config = await loadConfig(cli.config, cli.query);
  if (cli.command === 'login') await login(config);
  else await collect(config, cli);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}

