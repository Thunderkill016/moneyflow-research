# Facebook collector — corpus-first speed pipeline

## Decision

Adopt a corpus-first pipeline for the Build in Public VN research pass:

1. discover candidate post identities from a small broad query set;
2. deduplicate before opening posts;
3. harvest each missing strict root body once into the persistent corpus;
4. prepare semantic review entirely from local corpus evidence;
5. revisit Facebook only for posts judged relevant, to collect comments on the verified root-derived surface.

This replaces the default pattern where body capture and review-preparation were interleaved in small browser batches.

## Why

The previous workflow paid repeated orchestration/browser startup cost and made semantic review a barrier inside the Facebook phase. Earlier narrow-query pilots also produced high candidate/review volume with zero marginal relevant yield, so v0.9 uses a smaller broad Build in Public query plan by default in `config.example.json`.

## Performance contracts

- discovery deduplicates before body navigation;
- trusted body cache hits cause zero body browser navigations;
- a newly harvested candidate performs one full-body capture;
- offline review reports `browserNavigations: 0`;
- deep comment collection reuses the reviewed body and performs identity/surface verification only;
- body-harvest failures are durable and resumable; reruns skip trusted successes;
- offline review fails closed if any in-scope candidate lacks trusted body evidence.

## Correctness contracts retained

- exact post/group root identity validation;
- configured numeric/vanity aliases only authorize strict identity transitions;
- unique-root fail closed;
- comment sort/scroll/extraction remain bound to the verified root-derived surface;
- prior classifications remain bound to trusted body evidence;
- no CAPTCHA/checkpoint bypass, credential extraction, stealth/fingerprint spoofing, or private endpoint use.

## Research basis

Playwright locators are retryable and auto-wait for actionability, so browser readiness should be expressed through locator/root contracts rather than additional semantic-review browser passes. Playwright also supports earlier navigation readiness such as `commit`, but navigation timing changes should be live-gated before replacing conservative body-settle behavior.

## Verification

Before declaring live PASS:

- run `npm test` on the exact head;
- run a bounded `--limit 1` body harvest against an authenticated session;
- confirm `BODY_HARVEST_RUN.json` shows one capture or a trusted cache hit;
- prepare review and confirm `TOPIC_RUN.json` reports `preparationMode=offline-corpus-first` and `browserNavigations=0`;
- for one relevant decision, run comment collection and confirm it does not perform a second full-body capture.

Status at authoring: code path implemented; live integrated runner not yet verified.
