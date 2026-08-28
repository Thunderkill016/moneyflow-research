# Facebook research collector

Browser-assisted Facebook research evidence collector for MoneyFlow.

The collector is deliberately **user-driven, local, and fail-closed**. It uses the signed-in browser profile only for content that account is legitimately allowed to view. It does not automate credentials, bypass checkpoints/CAPTCHAs/rate limits/privacy controls, spoof fingerprints, or add stealth behavior.

## v0.8 architecture

The default flow separates candidate discovery, verified root-post capture, human/agent semantic assessment, corpus reuse, and expensive comment collection:

```text
Facebook discovery
  -> canonical candidate identity (group + post id)
  -> corpus lookup
       -> accepted strict-complete record: trusted/reusable evidence
       -> seen/legacy body cache: NOT trusted for review
  -> strict root-post body gate
       -> exact clean permalink for target post required inside root article
       -> comment_id / reply_comment_id links are provenance only, never root proof
       -> ambiguous/missing root => retry, then hard failure
       -> verified body stamped with acceptance version + body hash
  -> assessor reads COMPLETE verified root body
       -> relevant=false => SKIP comments
       -> relevant=true + accepted complete cache => REUSE
       -> relevant=true + not complete => COLLECT comments
  -> deep comment/reply collector
       -> re-proves the root identity immediately before collection
       -> refuses persistence if the reviewed root body hash changed
       -> All comments when available
       -> post-surface-scoped interaction/scrolling
       -> bottom-stable convergence + completeness diagnostics
  -> local corpus/cache update
```

Search keywords are recall-oriented candidate discovery only. They are **not** the final relevance classifier. The collector contains no OpenAI key, no external semantic-classification API, and no local LLM dependency. The assessor is operational: it reads the full verified body and records a binary topic judgment.

## Why v0.8 re-checks the body gate before persistence

Facebook search/permalink surfaces can expose timestamp links carrying `comment_id` or `reply_comment_id`. Those URLs contain the parent post ID even when the visible article is a comment/reply. A loose rule such as “article contains the target post id” can therefore cache comment text as if it were the root post.

v0.8 treats **identity as an acceptance contract**, not a scoring hint:

- a reviewable root article must contain a clean permalink for the exact target post;
- highlighted comment/reply links alone never establish root identity;
- a missing or ambiguous root fails closed instead of choosing the “best-looking” article;
- legacy `status=seen` body caches are considered stale until recaptured through the strict gate;
- a topic judgment on a seen record is reusable only when it is bound to the exact `bodyContentHash` and body-acceptance version;
- a deep collection must prove the root again and match the body hash that the assessor reviewed;
- every comment sort, expansion, convergence check, and final extraction is scoped to the dialog/main ancestor of that verified root; it never chooses a dialog merely because it contains the post ID;
- only `v0.8-strict-deep-collection-v2` records are reusable by the default path; prior v0.8/v0.3 artifacts are retained locally but are recaptured rather than silently promoted.

This prevents a bad preflight body or stale judgment from silently becoming permanent corpus truth.

## Requirements

- Node.js 20+
- Chromium installed through Playwright
- a Facebook account that can legitimately view the target content

Pinned Playwright: `1.62.1`.

## Setup

```bash
cd tools/facebook-research-collector
npm install
npx playwright install chromium
cp config.example.json config.json
```

`config.json`, `profile/`, `output/`, `corpus/`, raw evidence, and normalized Facebook datasets stay local and are gitignored.

## Login once

```bash
npm run login -- --config config.json
```

A headed browser opens. Log in manually. Never add Facebook passwords, cookies, tokens, exported browser state, or collected personal data to this repository.

## Discovery modes

The discovery implementation supports two explicit scopes.

### Focused group search

Current example config uses:

```json
{
  "discovery": { "scope": "group" },
  "groups": [
    {
      "id": "1569314343856132",
      "aliases": ["1569314343856132", "indiehackervn"]
    },
    {
      "id": "j2team.community",
      "aliases": ["j2team.community"]
    }
  ]
}
```

Aliases are explicit because Facebook can navigate a numeric group ID while rendering post URLs with a vanity slug. They permit only that configured numeric/vanity transition during root validation. The canonical evidence still keeps the actual group identifier observed on the root URL; a post ID alone never causes corpus reuse across groups.

### Global Posts search

Set:

```json
{
  "discovery": { "scope": "topic" }
}
```

This uses Facebook's global Posts search surface. It can broaden coverage but also introduces substantial cross-group noise. The strict body/review gate applies identically in either discovery mode.

## Prepare a semantic review queue

Run discovery and body preparation together:

```bash
npm run collect -- --config config.json --query "quản lý chi tiêu"
```

Or reuse a prior discovery artifact:

```bash
npm run collect -- \
  --config config.json \
  --from-discovery output/<run>/discovery.json \
  --output-dir output/<review-run>
```

v0.8 writes:

```text
review-queue.json
relevance-decisions.template.json
body-capture-diagnostics.json
body-capture-failures.json      # only when capture fails
review-preparation.json         # durable strict-body progress/checkpoint
TOPIC_RUN.json
```

Strict root-body preparation is batched. The default queue contains at most 10 new, unreviewed bodies, so an assessor can begin a small safe review without browser-capturing every discovered candidate first. `review-preparation.json` is updated after each candidate and every successful strict body is checkpointed in the corpus registry before the next Facebook navigation. If the process stops, rerun preparation against the same `discovery.json`; already-checkpointed bodies are reused only under the strict body trust contract.

If any candidate in the batch cannot produce a verified root body after bounded retries, `TOPIC_RUN.status` becomes `blocked-body-capture` and the command fails. Do not assess or apply a partial queue as complete evidence.

Relevant review configuration:

```json
{
  "review": {
    "topicKey": "personal-expense-management",
    "bodyCaptureRetries": 2,
    "bodyCaptureRetryDelayMs": 800,
    "preflightBatchSize": 10
  }
}
```

Discovery emits terminal progress every `discovery.progressEveryRounds` scroll rounds (10 by default). This is observability only: it does not weaken the recorded completion or truncation semantics.

## Assess and apply

The assessor reads each `review-queue.json.items[].body` in full and fills the generated decision template. A decision must preserve the generated `bodyContentHash` for that post.

Then apply:

```bash
npm run collect -- \
  --config config.json \
  --from-review output/<review-run>/review-queue.json \
  --decisions output/<review-run>/relevance-decisions.json \
  --output-dir output/<collection-run>
```

`collection.maxPosts` is the default safety budget for deep comment collection. The same explicit `--limit` also bounds the number of newly prepared review rows, making a one-post live gate bounded through preparation and deep collection (discovery remains complete and reports its own scope):

```bash
npm run collect -- \
  --config config.json \
  --from-review output/<review-run>/review-queue.json \
  --decisions output/<review-run>/relevance-decisions.json \
  --limit 1
```

When a review batch has `TOPIC_RUN.reviewPreparation.deferredCandidates > 0`, apply the current decisions, then prepare the next batch from the same immutable discovery artifact:

```bash
npm run collect -- \
  --config config.json \
  --from-discovery output/<discovery-run>/discovery.json \
  --output-dir output/<next-review-run>
```

The deep collector still recaptures the strict root after review before comment expansion. That second navigation is intentional: it rejects a decision if the root evidence changed; the collector must not apply a relevance judgment to a different body.

The v0.8 apply gate rejects:

- old review schema;
- decisions for another topic;
- missing/non-boolean relevance decisions;
- a decision whose `bodyContentHash` no longer matches the queued body;
- a body that became stale/untrusted after queue generation.

Only verified relevant posts proceed to the expensive deep comment collector.

## Corpus and reuse

Local corpus layout:

```text
corpus/
  index.json
  posts/
    <source-key-hash>.json
```

Hard reuse boundary: exact Facebook source/post identity. Same-body/near-body fingerprints can flag probable reposts but do not collapse different post threads automatically.

Reuse rules:

1. accepted `v0.8-strict-deep-collection-v2` record + cache file => body and comments can be reused;
2. strict v0.8 preflight body => body can be reused for review;
3. legacy seen body without strict validation => recapture once before review;
4. topic judgment on a seen body => reuse only when body hash and body acceptance version still match;
5. a configured alias can only help prove a root during browser capture; it does not turn an unverified post-id match into corpus reuse;
6. different group/post identities remain distinct evidence even when text is identical.

Collector JSON artifacts use temp-write, flush, and rename. A crash may leave an unreferenced temporary/cache file, but it cannot make a partial JSON artifact look complete through the corpus index.

When comment expansion is truncated or fails, `collection-dataset.json` retains the diagnostic output, while the final `dataset.json` and corpus contain only strict-complete records. `TOPIC_RUN.json` is then `completed-with-incomplete-collection`, never `completed`.

## Deep comment completeness

Comment extraction is still bounded by what normal Facebook UI exposes to the signed-in account. The accepted deep collector attempts to:

- switch to `Tất cả bình luận / All comments` when available and verify the transition;
- interact only inside the selected post surface;
- expand visible comment/reply controls;
- scroll the post's internal scroll container, not the background feed;
- continue until bottom-stable convergence;
- record truncation/failure instead of pretending success.

A “complete” record means complete under these collector invariants for the accessible UI surface. It is not a claim of global Facebook exhaustiveness.

## Import prior strict-complete runs

```bash
npm run corpus:import -- \
  --config config.json \
  --from-run output/<prior-run>
```

The importer can seed accepted complete records so later topics do not re-fetch the same discussion unnecessarily.

## Tests

```bash
npm test
```

v0.8 regression coverage includes comment-highlight rejection, cross-group same-post-ID refusal, configured alias-only root validation, stale cache rejection, and the requirement that a reusable deep record carries the strict root validation used for review.

## Debug paths

The current strict path is the default:

```bash
npm run collect
npm run collect:review
```

Both commands route through discovery plus the v2 review gate when no prepared artifact is supplied. Passing `--from-discovery` or `--from-review --decisions` preserves the same strict gate.

Older paths remain available only for diagnosis/comparison:

```bash
npm run collect:review:legacy
npm run collect:legacy
npm run collect:semantic
npm run collect:heuristic
```

Do not use a legacy path as acceptance evidence for new corpus judgments.

## Failure policy

- Login/checkpoint appears: handle login manually; do not automate around it.
- Facebook blocks activity: stop; do not add bypass or stealth behavior.
- Root body cannot be proven: fail and preserve diagnostics; do not select a comment as fallback.
- Corpus accepted cache is missing/corrupt: fail visibly; re-import/recollect rather than invent reuse.
- UI/search shape changes: inspect diagnostics/live UI, update the smallest validated contract, and add a regression test for the observed failure.
- Ranking/privacy/account visibility limits evidence: record the limitation; never call a finite query set “all Facebook”.
