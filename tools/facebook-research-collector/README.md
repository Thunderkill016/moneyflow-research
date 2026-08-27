# Facebook research collector

Browser-assisted, bounded collection of Facebook group posts and visible comments for MoneyFlow research.

This tool is intentionally **not** a stealth scraper. It does not bypass Facebook authentication, checkpoints, rate limits, privacy controls, anti-bot controls, or deleted/hidden content. Use it only for content you are allowed to access and in a way that complies with Meta's terms and applicable law.

## Why this exists

The collector separates a cheap discovery pass from a more expensive collection pass:

```text
Facebook group search
  -> candidate permalink + preview
  -> deterministic relevance score
  -> only relevant posts opened
  -> expand visible comments/replies
  -> local raw evidence
  -> normalized JSON + Markdown
```

This avoids manually copying every post while keeping selection explainable. It also avoids committing Facebook source dumps to the public research repository.

## Requirements

- Node.js 20+
- a Facebook account that can legitimately view the target content
- Chromium installed through Playwright

Current pinned Playwright version: `1.62.1`.

## Setup

```bash
cd tools/facebook-research-collector
npm install
npx playwright install chromium
cp config.example.json config.json
```

Edit `config.json` with the group, search queries, relevance rules and collection limits.

## Login once

```bash
npm run login -- --config config.json
```

A headed browser opens. Log in yourself, then return to the terminal and press Enter. The browser profile is stored locally under `profile/` and is gitignored.

Do not put Facebook passwords, cookies, access tokens or exported browser state in this repository.

## Collect

```bash
npm run collect -- --config config.json
```

For a smaller test:

```bash
npm run collect -- --config config.json --limit 3
```

Output is local and gitignored:

```text
output/<run-timestamp>/
  discovery.json
  dataset.json
  RUN.json
  raw/
    <post-id>.json
  normalized/
    <post-id>.json
    <post-id>.md
```

`raw/` preserves a bounded post subtree snapshot so parser mistakes can be checked later. `normalized/` stores post/comment blocks, source URLs, hierarchy fingerprints and relevance evidence.

## How selection works

Discovery extracts only Facebook group URLs shaped like:

- `/groups/<group>/posts/<post-id>`
- `/groups/<group>/permalink/<post-id>`
- group URLs with `multi_permalinks=<post-id>`

All variants are canonicalized to one key:

```text
facebook:<group-id-or-slug>:<post-id>
```

The preview is scored using weighted `include` and `exclude` terms in `config.json`. Vietnamese matching is accent-insensitive. This is deliberately deterministic in v1: the run can explain exactly why a post passed the threshold, and no external AI API receives Facebook content.

A later research step may analyze the resulting local dataset, but that is separate from source collection.

## Comment extraction

Facebook changes its DOM often. The collector therefore prefers user-facing/accessibility contracts and only uses generic structural hints such as `role="article"` rather than generated CSS class names. It attempts to click visible controls whose text matches common Vietnamese/English forms of:

- Xem thêm / See more
- Xem thêm bình luận / View more comments
- Xem thêm phản hồi / View more replies

It then treats nested `role="article"` blocks as comment/reply candidates and records the DOM nesting relationship.

This is **best effort**, not a guarantee of every comment. Facebook ranking, privacy, lazy loading, deleted content, UI experiments and account-specific visibility can make the visible set incomplete.

## Data hygiene

Do not commit the generated `profile/`, `output/` or `config.json` directories/files. The repository's durable research records should contain summaries, short quotations when necessary, canonical source links, applicability limits and verification notes—not copyrighted Facebook dumps or private participant data.

## Tests

```bash
npm test
```

The tests cover permalink canonicalization, relevance scoring, conservative UI-noise cleanup and deterministic comment fingerprints without needing Facebook or a logged-in browser.

## Failure modes to expect

- Facebook asks for login/checkpoint again: rerun `npm run login` and complete it manually.
- Search UI changes: discovery may return zero candidates; inspect the page manually before changing selectors.
- Comment controls change language/text: update the bounded expansion regex rather than adding brittle generated CSS selectors.
- A post has ranked/hidden comments: record the collection as incomplete; do not claim exhaustiveness.
- Facebook blocks automated activity: stop. Do not add stealth plugins, fingerprint spoofing, CAPTCHA bypasses or rate-limit evasion.
