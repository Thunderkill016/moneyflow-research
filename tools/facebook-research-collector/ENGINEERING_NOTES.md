# Facebook collector engineering notes

This file records durable engineering decisions for the MoneyFlow research collector so future iterations start from known evidence rather than repeating the same investigation.

## 2026-08-28 — v0.8 strict evidence continuity and crash-safe artifacts

### Trigger

The v0.7 review queue proved a body before assessment, but the default apply path delegated deep collection to the older collector. That collector could reselect a root with weaker rules and persisted `v0.3.0-strict` records. A body could therefore be correct when judged yet differ when comments were collected and cached. The corpus layer also treated a locally unique `postId` as reusable across group identifiers.

### Decision

- one strict root capture contract now serves review and deep collection;
- deep collection re-proves the root immediately before expanding comments and requires the recaptured body hash to equal the reviewed body hash;
- `v0.8-strict-deep-collection-v2` is the only default reusable complete-record version; v1 and legacy artifacts remain local diagnostics, not reusable evidence;
- a unique clean root is required; score is diagnostic-only and never resolves multiple eligible root articles;
- comment sort, expansion, convergence, and extraction are all bound to the dialog/main surface derived from that unique root; no post-ID/dialog fallback is allowed in the strict path;
- apply-time REUSE revalidates the cached strict record and its body hash, closing the review-to-reuse TOCTOU window;
- a numeric/vanity alias proved by strict capture atomically rekeys its noncomplete registry record before the deep child process runs; an existing target key is a hard provenance conflict;
- an explicit configured numeric/vanity alias may authorize root validation, but the final observed `group + post` key remains the reuse boundary;
- a partial deep collection is retained as `collection-dataset.json` for diagnosis, excluded from final `dataset.json`/corpus, and recorded as `completed-with-incomplete-collection`;
- JSON artifacts use temp write, `FileHandle.sync()`, then rename. An interrupted write cannot become a referenced partial JSON artifact.

### External patterns considered

| Source | Decision | Applicability |
| --- | --- | --- |
| Playwright locators/actionability | Adapt | Keep locators live and bounded; a root match must be unique rather than selecting an arbitrary first result. |
| Crawlee request lifecycle | Adapt concepts | Model deep output as accepted only after all invariants pass; incomplete work stays explicit rather than becoming handled/reusable. No Crawlee dependency is justified for this bounded user-driven collector. |
| Node.js `fs` promises | Adopt | Serialize artifact writes, flush the temp file, and rename it; do not rely on concurrent `writeFile` calls for shared artifacts. |

### Regression guards

- configured aliases are accepted only when explicitly supplied;
- a foreign group with the same post ID cannot resolve to a corpus record;
- a changed body after review throws before persistence;
- a reusable deep record must carry valid root-validation metadata.
- a cache that changes after review preparation is rejected at REUSE rather than trusting its registry entry;
- a strict alias transition cannot leave the corpus registry key and child collector key divergent.
- `--limit` is parsed and forwarded through `collect.mjs` and v2 into the deep child collector; a default configured post budget must not be silently bypassed by an entrypoint parser.

## 2026-08-28 — v0.7 strict root-body review gate

### Trigger

A global-search reconciliation exposed a correctness failure class: several supposed “full post bodies” were actually comment/reply fragments, including identical MMA/boxing text associated with multiple unrelated group/post identities. The old preflight runner could cache a visible article even when it lacked a clean permalink for the target root post, then reuse that body and its topic judgment indefinitely.

The dangerous chain was:

```text
search candidate has valid parent post id
-> permalink page contains comments whose URLs also carry parent post id
-> preflight chooses best-scoring visible article even without clean target permalink
-> page URL provides target identity fallback
-> comment text cached as record.body.text
-> loadBody() trusts any cached body
-> old topic judgment reused forever
```

This is a data-integrity problem, not an assessor-quality problem. The collector must prove that the text belongs to the root post before an assessor sees it.

### External references reviewed

Official sources were preferred, then compared with established crawler projects and Facebook-specific implementations.

#### Playwright

- https://playwright.dev/docs/locators
- https://playwright.dev/docs/actionability
- https://playwright.dev/docs/best-practices
- https://playwright.dev/docs/trace-viewer
- https://playwright.dev/docs/api/class-tracing
- Repository: https://github.com/microsoft/playwright

Adopted principles:

- use locators as live/retryable references instead of stale DOM assumptions;
- prefer user-facing/semantic evidence and strict target selection;
- let `locator.click()` enforce visibility/stability/event-receipt where interactions are required;
- fail when a target is ambiguous rather than silently using `first()` as a correctness shortcut;
- keep tracing/DOM snapshots as a diagnostic option for hard UI failures.

#### Crawlee

- https://crawlee.dev/js/api/playwright-crawler/class/PlaywrightCrawler
- https://crawlee.dev/js/api/playwright-crawler/interface/PlaywrightCrawlerOptions
- Repository: https://github.com/apify/crawlee

Adopted principles:

- request/extraction failures should remain failures and be retried a bounded number of times;
- after retry exhaustion, persist explicit failed-request evidence rather than manufacturing a partial success;
- persistent identity/dedup state should be separate from whether extraction has reached an accepted quality level;
- crawler state should be resumable/idempotent rather than relying on an all-or-nothing one-off run.

Not adopted:

- proxy/session rotation or anti-block features. MoneyFlow intentionally does not bypass platform controls; if Facebook blocks automated activity, the collector stops.

#### Scrapy

- https://docs.scrapy.org/en/latest/topics/jobs.html
- https://docs.scrapy.org/en/latest/topics/request-response.html
- https://docs.scrapy.org/en/master/topics/item-pipeline.html
- Repository: https://github.com/scrapy/scrapy

Adopted principles:

- canonical identity/fingerprinting is a dedup concern; it is not proof that extracted item contents are valid;
- validation belongs in a pipeline before storage/reuse;
- an invalid item should be dropped/failed instead of flowing downstream;
- persistent seen-state is useful, but persisted state needs an explicit quality contract.

#### Facebook-specific projects

Reviewed for domain failure modes and data-model ideas:

- https://github.com/kevinzg/facebook-scraper
- https://github.com/tamnd/facebook-cli
- https://github.com/mharizanov/fbtool

Useful observations:

- Facebook post IDs, comment IDs, post URLs, comments, and replies should stay structurally separate;
- listing/search content may be truncated and a post should be fetched individually for full text;
- Facebook rendered DOM is unstable and comment/permalink surfaces can be misleading;
- structured payload approaches can be more stable than DOM for some fields, but they depend on undocumented private Facebook protocols.

### Decision: do not switch to private GraphQL

Some current Facebook tools capture or replay private GraphQL payloads because Facebook DOM markup changes frequently. We are not adopting that path in v0.7.

Reasons:

1. It shifts brittleness from DOM contracts to undocumented internal protocol/doc IDs/Relay shapes.
2. It makes the collector harder to audit and maintain for a small research workflow.
3. The current requirement is content visible through a normal signed-in browser, not a high-throughput Facebook data product.
4. We already have a working strict deep-comment browser collector; the immediate bug is preflight identity acceptance, which can be fixed directly.
5. The project explicitly avoids anti-block/stealth escalation.

Reconsider only if the browser-visible path becomes unmaintainable across multiple verified UI variants, and only after a fresh policy/security review.

### v0.7 acceptance contracts

#### Root-post body

A body is reviewable only when:

- a visible root article contains a **clean** permalink for the exact target post ID;
- `comment_id` / `reply_comment_id` links alone do not count as root proof;
- root identity post ID equals target post ID;
- final page identity, when available, does not change the target post ID;
- the root article is unambiguous;
- cleaned root body is non-empty.

The capture is stamped with `v0.7-strict-root-body-v1`.

#### Body cache

- accepted strict-complete normalized records remain trusted when their acceptance version is explicitly allowed;
- legacy `status=seen` body caches without the v0.7 validation stamp are stale and must be recaptured;
- failed recapture cannot fall back to stale text.

#### Topic judgment

For non-complete seen records, a judgment is reusable only when:

- current body is trusted;
- `classification.bodyContentHash` equals `record.body.contentHash`;
- `classification.bodyAcceptanceVersion` equals the current body acceptance version.

Review queue schema v2 carries `bodyContentHash`; a decisions file must echo it. This prevents applying a semantic judgment to body text that changed after queue generation.

#### Failure semantics

- body capture retries are bounded (`bodyCaptureRetries`, default 2);
- failures are written to `body-capture-failures.json`;
- any body-capture failure blocks the run from being treated as a complete review preparation;
- no assessor should label a failed/partial queue as though all candidates were verified.

### Architecture boundary

Gemini or another model is an **operational assessor/runner**, not architecture authority. Its job is to:

- run the exact branch/head;
- execute static tests and authenticated browser gates;
- read only the collector-produced verified full-body queue;
- return relevance decisions/evidence;
- report failures without patching collector logic unless explicitly assigned an implementation task.

Collector architecture, invariants, patches, and acceptance criteria remain owned in the repository and by the technical lead workflow.

### Next live gate

Before collecting comments for newly relevant posts:

1. run the full static suite on v0.7;
2. reuse the prior 12-candidate global discovery artifact;
3. prepare review with v0.7 against the current corpus;
4. prove suspicious legacy bodies are either recaptured as actual root posts or fail closed;
5. reassess only the schema-v2 verified queue;
6. do not apply decisions or collect comments until the root-body gate is accepted.

The previous recommendation to collect comments for 7 J2TEAM posts plus global post `8888207951193779` is **not acceptance-valid until this revalidation completes**, because those seen-record judgments predate the v0.7 body-hash/version contract.
