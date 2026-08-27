# Facebook research collector

Browser-assisted collection of Facebook research evidence for MoneyFlow. The collector is designed to minimize repeated work across research topics while preserving provenance and explicit completeness limits.

It is intentionally **not** a stealth scraper. It does not bypass authentication, checkpoints, rate limits, privacy controls, anti-bot controls, or deleted/hidden content. Use it only for content the signed-in account is legitimately allowed to view and stop if Facebook blocks automated activity.

## v0.3 pipeline

The default `npm run collect` path now separates discovery, cheap full-body classification, corpus reuse, and expensive comment collection:

```text
Facebook discovery
  -> candidate post identity
  -> persistent corpus lookup
       -> known body/complete post: reuse local evidence
       -> unseen post: open once for full-body preflight
  -> full-body topic classification
       -> in-topic / adjacent / ambiguous: comment collection eligible
       -> out-of-topic: body-only exclusion evidence
  -> exact previously-complete post: reuse normalized post/comments
  -> new eligible post: deep comment/reply collection
  -> exact-content / near-content fingerprint flag
  -> local corpus index + normalized cache update
```

The corpus layer is deliberately cross-topic. If the same Facebook post appears in later searches, the collector records the new query provenance but does not re-fetch its comment tree when a compatible complete normalized record already exists.

Near-duplicate **content is not automatically discarded**. Reposts/cross-posts can have different discussion threads, so SimHash/Hamming-distance matches are recorded as review metadata only. Exact Facebook source identity is the hard reuse boundary.

## Requirements

- Node.js 20+
- Chromium installed through Playwright
- a Facebook account that can legitimately view the target content

Current pinned Playwright version: `1.62.1`.

## Setup

```bash
cd tools/facebook-research-collector
npm install
npx playwright install chromium
cp config.example.json config.json
```

Edit `config.json` for the current discovery surface/query set, full-body filter rules, and local corpus paths.

## Login once

```bash
npm run login -- --config config.json
```

A headed browser opens. Log in yourself, then return to the terminal and press Enter. The browser profile stays under local `profile/` and is gitignored.

Never put Facebook passwords, cookies, access tokens, or exported browser state in this repository.

## Seed the corpus from an existing run

Before researching the next topic, import prior normalized runs so already-complete posts are reusable immediately:

```bash
npm run corpus:import -- \
  --config config.json \
  --from-run output/2026-08-27T19-01-01-462Z
```

`--from-run` accepts either a run directory or its `dataset.json` file.

The importer:

- indexes full normalized post bodies;
- caches compatible strict-complete normalized post/comment records;
- uses the final collected Facebook URL when available to repair old group-alias/provenance ambiguity;
- does not make old incomplete/older-acceptance records reusable as complete evidence.

## Collect a topic

```bash
npm run collect -- --config config.json --query "quản lý chi tiêu"
```

Use a prior discovery artifact without rediscovering:

```bash
npm run collect -- \
  --config config.json \
  --from-discovery output/<run>/discovery.json
```

Important v0.3 options:

```text
--corpus-index <path>   Override local corpus index path
--recollect-known       Ignore complete-record reuse and collect eligible known posts again
--ignore-corpus         Run without reading/writing the persistent corpus
--skip-topic-filter     Disable the full-body gate for a diagnostic run
```

Legacy deep collector behavior remains available for debugging:

```bash
npm run collect:legacy -- --config config.json ...
```

## Full-body filter

Preview text is not reliable enough to decide topic relevance. v0.3 therefore uses preview scoring only as discovery metadata and performs a conservative full-post-body gate before expanding comments.

Classification states:

- `in-topic`: strong evidence for the current topic;
- `adjacent`: useful neighboring mechanism/market evidence;
- `ambiguous`: insufficient evidence to safely exclude;
- `out-of-topic`: obvious search noise; keep body/provenance locally but do not pay the cost of expanding the comment tree.

The default PFM rules in `config.example.json` were calibrated against the collected 69-post `quản lý chi tiêu` audit. On that fixed audit they would retain all 13 manually audited core PFM threads while excluding 37 obvious out-of-topic posts before expensive comment expansion. That is a **regression/calibration result, not a claim about Facebook search precision or Vietnamese market prevalence**.

Prefer recall over aggressive exclusion. If uncertain, classify `ambiguous` and collect the discussion.

## Persistent corpus and deduplication

Local files are gitignored:

```text
corpus/
  index.json
  posts/
    <source-key-hash>.json
```

`index.json` stores source/query provenance, body fingerprints, acceptance version, cache references, and per-topic classification metadata. Normalized cache records let a later topic reuse a previously collected post without reopening its full comment tree.

Deduplication rules:

1. same exact corpus/source identity -> reuse when strict-complete and acceptance-compatible;
2. same unique Facebook post ID under an alias -> reuse the one known record;
3. same normalized body SHA-256 but different source identity -> flag `exact-content`, do not drop;
4. close 64-bit SimHash/Hamming match -> flag `near-content`, do not drop;
5. different post/source identities remain separate evidence unless a human/research rule explicitly decides otherwise.

This prevents repeated scraping across topics without collapsing distinct discussions that happen to quote/repost the same text.

## Output

The wrapper keeps the normal local evidence and adds topic-processing artifacts:

```text
output/<run>/
  discovery.json              # discovery source artifact when produced by this run
  discovery.filtered.json     # only candidates eligible for new deep collection
  preflight.json              # full-body classifications/dispositions
  exclusions.json             # local body-only out-of-topic evidence
  collection-reconciliation.json
  reconciliation.json         # final fetched/reused/excluded accounting
  dataset.json                # relevant complete records, including corpus reuse
  TOPIC_RUN.json
  raw/
  normalized/
```

Raw/source dumps, normalized datasets, profile state, config, and corpus cache remain local and are not committed to the public research repository.

## Completeness semantics

Deep comment extraction remains best-effort because Facebook ranking, privacy, lazy loading, deleted content, UI experiments, and account-specific visibility can hide material.

A strict-complete post is reusable only when its accepted collector version confirms the required comment-sort, bottom-convergence, scroll-surface, and residual-expand-control invariants. Older records can still provide body text for classification but must be re-collected before being treated as compatible complete comment evidence.

## Tests

```bash
npm test
```

Coverage includes URL/comment parsing, UI cleanup, strict CLI behavior, corpus reuse by source/post identity, local atomic registry/cache round-trips, SimHash near-duplicate flagging, and full-body topic filtering.

## Failure modes

- Facebook asks for login/checkpoint: complete login manually; do not automate around it.
- Facebook blocks automated activity: stop; do not add stealth/fingerprint/CAPTCHA/rate-limit bypasses.
- Search UI changes: discovery may return zero/noisy candidates; preserve diagnostics and inspect the UI before changing selectors.
- Topic filter becomes too aggressive: use `--skip-topic-filter` for diagnosis and update rules against a reviewed corpus; do not silently drop ambiguous posts.
- Corpus cache is missing/corrupt: fail visibly or re-import/recollect; never pretend an absent cache is reusable complete evidence.
- A post has ranked/hidden comments: record the limitation; do not claim global Facebook exhaustiveness.
