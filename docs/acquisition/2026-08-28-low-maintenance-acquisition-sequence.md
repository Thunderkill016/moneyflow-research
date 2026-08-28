# What should MoneyFlow build next to reduce transaction-maintenance work without reducing trust?

- **Status:** active
- **Date:** 2026-08-28
- **Area:** acquisition
- **MoneyFlow baseline:** `Thunderkill016/moneyflow@6298e6c52cfff6f3a972cf72cf79022e341ce638`; current master program #432; bounded candidate issue #511
- **Decision boundary:** sequence the next low-maintenance acquisition/review experiments. This record does not authorize implementation, provider access, automatic posting, AI mutation, or a native-app rewrite.

## 1. Question

Given the current MoneyFlow acquisition foundation and the 2026-08-28 community corpus, which near-term work should come first among:

1. exception-first Inbox review;
2. broader/stronger statement and file ingestion;
3. OCR/document capture;
4. direct provider/native acquisition?

The decision criterion is not feature novelty. It is whether a bounded slice can reduce **manual interventions per 100 observed transactions** and maintenance time without weakening ledger correctness, source provenance, duplicate handling, correction/recovery, or reconciliation.

## 2. Current MoneyFlow baseline

Current MoneyFlow already has a provider-neutral acquisition path with persisted source batches/candidates/provenance, Direct CSV, paste/share capture, deterministic candidate rules, duplicate/possible-transfer detection, explicit Inbox review, idempotency/recovery semantics, and a user-owned ledger. It does not currently ship broad bank/provider sync, native-device acquisition, AI mutation, or trustworthy PDF/OCR ingestion as general product capabilities.

Issue #511 proposes a bounded exception-first review slice using existing deterministic facts. It explicitly forbids auto-posting and forbids using fallback guesses as proof that a candidate is ready.

Community evidence in the current research corpus identifies capture/maintenance burden as the strongest recurring product problem, while bank/import interest is also strong. The evidence supports reducing maintenance work; it does not by itself prove which OCR engine, bank provider, or native platform path should be adopted.

## 3. Why this question matters

MoneyFlow has already spent substantial engineering effort establishing source identity, candidate review, idempotency, lifecycle evidence and reconciliation safety. The next mistake would be to add a new acquisition channel faster than the user can safely clear the resulting Inbox, or to add heuristic automation that lowers clicks by increasing hidden financial errors.

The near-term sequence should therefore maximize reuse of the existing trust architecture and produce measurable evidence before introducing more expensive acquisition surfaces.

## 4. Sources reviewed

| Source | Type | What it establishes | What it does not establish |
|---|---|---|---|
| Current MoneyFlow code/docs, master #432 and issue #511 | primary project truth | Existing Inbox, candidate/review boundaries, current authorization and program metrics | Does not prove user-market prevalence or future provider availability |
| Actual Budget official import/merge/rules documentation | primary product documentation | Stable import IDs are preferred; weaker sources need fallback matching; imported/manual copies can reconcile; users need visibility and correction when matching is uncertain | Actual's matching thresholds, storage architecture and automatic rule learning are not MoneyFlow requirements |
| Firefly III official Data Importer duplicate/reconciliation documentation | primary product documentation | Duplicate checks need explicit semantics; false positives/negatives occur; identifier-based detection is strongest when available; reconciliation is a distinct verification workflow | Firefly's AGPL codebase and accounting-heavy UX are not implementation authority for MoneyFlow |
| YNAB official import/approval/matching documentation | primary commercial product documentation | Imported transactions remain reviewable; bulk actions exist; matching and rejection/correction stay visible; file import remains a fallback when direct import is unavailable | YNAB's provider stack and commercial UX do not establish Vietnam source coverage |
| Chrome Web Share Target documentation / W3C share-target specification | official web-platform documentation | Installed PWAs can receive shared text and files through explicit MIME/extension declarations and multipart POST; incoming shared data must be treated as untrusted | Does not guarantee every Android app shares useful transaction payloads or every platform supports identical behavior |
| Techcombank Business and PVcomBank official user guides | official bank documentation | Vietnamese banking channels can expose transaction/statement exports in CSV/XLSX/PDF depending on product/channel; file-based acquisition is a real source family, not a hypothetical one | Business-channel formats do not prove consumer-channel availability or a universal Vietnam format |
| MinerU official repository/docs | primary OSS project documentation | MinerU 3.x parses PDF/images/Office files to structured Markdown/JSON, supports scanned documents, tables and multilingual OCR, and can run locally | Does not establish MoneyFlow field-level accuracy on Vietnamese receipts/statements or acceptable latency/cost/privacy in our deployment |

## 5. Findings

### Facts

1. **The current bottleneck is not absence of an ingestion architecture.** MoneyFlow already has the source-evidence → candidate → review → ledger path required to test lower-maintenance workflows without opening a second financial truth path.

2. **Existing mature PFM products separate identity, matching and review.** Actual prefers stable imported IDs when present, falls back to weaker matching when they are absent, and exposes reconciliation outcomes because heuristic matches are not certain. Firefly III separately documents identifier/content duplicate detection and explicitly documents false-positive/false-negative troubleshooting. YNAB imports/matches transactions but still requires review/approval and provides reject/manual-match paths.

3. **Fuzzy matching can create real correctness failures.** Actual has historical bug reports where different imported IDs were incorrectly collapsed by fuzzy deduplication. This is direct evidence against using semantic/fuzzy similarity as a shortcut to expand MoneyFlow's `ready` set.

4. **File acquisition is a real Vietnam-compatible source family.** Official Vietnamese bank guides show CSV/XLSX/PDF statement or transaction export capabilities in at least some channels. Formats vary, so provider-neutral parsers and explicit account/source mapping remain appropriate.

5. **MoneyFlow can extend acquisition on the existing PWA before committing to native.** Web Share Target supports user-selected file sharing into an installed PWA through declared MIME types/extensions and multipart POST. MoneyFlow already has a Share Target path, so additional bounded file/image experiments can reuse an existing platform seam.

6. **MinerU is technically credible enough to benchmark, not credible enough to adopt by assertion.** Its current official documentation supports scanned PDF/image parsing, tables, structured output and multilingual OCR. None of those claims establish correct extraction of `amount`, `date`, `merchant`, `account/source`, transfer identity, or duplicate identity for MoneyFlow's Vietnamese documents.

### Inferences

#### A. Exception-first Inbox review should come first

Issue #511 has the best dependency fit because it reduces work using information MoneyFlow already possesses. It requires no new external source, no new provider contract, no OCR model, and no weaker matching semantics.

A candidate should be considered `ready` only when deterministic existing evidence is sufficient to build a valid ledger post without fallback guessing. Everything else should remain an explicit exception.

This produces the cleanest first measurement of whether **grouping known-safe review** reduces interventions without increasing corrections.

#### B. The next acquisition lane after #511 should be file/statement robustness, not provider sync

Once review burden is measurable, MoneyFlow should improve the sources users can already obtain themselves: CSV/XLSX/PDF statement exports and shared files. This has several advantages:

- provider-independent;
- user-controlled acquisition;
- compatible with the existing source/batch/candidate model;
- can be tested with fixtures and synthetic/private local samples;
- creates evidence about actual Vietnam format diversity before negotiating provider integrations.

The product should not assume one universal schema. The experiment should inventory real fields, stable transaction identifiers, amount/date/payee conventions, account metadata, running balances and export quirks per source/version.

#### C. OCR/document capture should be an adapter benchmark after structured-file ingestion is understood

OCR can remove retyping when the source is image/PDF-only, but it introduces another uncertainty layer. The correct benchmark is field-level transaction usability, not OCR character accuracy.

A useful benchmark should measure at least:

- amount exact-match accuracy;
- transaction date exact-match accuracy;
- merchant/payee extraction accuracy;
- account/source detection accuracy when present;
- transfer/reference identifier preservation;
- row completeness for multi-row statements;
- duplicate/source-identity preservation;
- review interventions required per 100 extracted rows;
- latency and resource cost;
- failure-mode visibility and user correction burden.

MinerU, PaddleOCR or another parser should compete behind the same adapter contract. The engine name must not leak into ledger semantics.

#### D. Direct provider/native acquisition remains later

Provider/native paths may eventually remove more maintenance, but they add consent, token, policy, source-health, retry, privacy, platform-distribution and operational dependencies. Current MoneyFlow and corpus evidence do not justify skipping the cheaper provider-independent experiments that can validate the same core thesis first.

### Contrary evidence / tensions

- File import is still user-initiated and may not solve habitual capture for users who never download statements.
- Exception-first review can reduce clicks only if enough candidates are deterministically ready. If most real imported rows lack explicit account/category evidence, #511 may expose rather than solve the next bottleneck.
- OCR may be more valuable earlier for users whose banks expose only PDF/image artifacts. Current corpus does not quantify that segment well enough.
- Techcombank/PVcomBank evidence is not a representative sample of all Vietnamese consumer banking products.
- YNAB/Actual/Firefly operate in different markets and product models; their patterns support trust principles, not Vietnam prevalence.

## 6. Applicability to MoneyFlow

### Applies

- stable source identity outranks fuzzy similarity;
- deterministic `ready` classification before grouped approval;
- explicit review/correction for uncertain matches;
- file sources should remain provider-neutral adapters;
- source-specific quirks belong in parser/version provenance, not ledger truth;
- import/OCR outputs remain candidates until the existing ledger path validates them;
- file/share acquisition can continue on the PWA while native/provider work stays unselected.

### Does not apply

- Actual's automatic rule learning from behavior is outside current MoneyFlow authorization;
- Firefly's content-hash semantics should not be copied into MoneyFlow runtime without a dedicated spec;
- YNAB's bank-connection providers do not establish Vietnam availability/economics;
- business-banking export formats do not prove consumer-banking parity;
- MinerU benchmark claims on general document datasets do not prove MoneyFlow financial-field accuracy.

## 7. Risk review

| Risk | Finding |
|---|---|
| Financial correctness | Highest risk is false `ready` classification or heuristic merging. Keep readiness deterministic and ledger validation unchanged. |
| Security | New file parsers must remain bounded, treat uploads as untrusted, and avoid executing embedded content/macros. |
| Privacy/data ownership | Statement/receipt inputs contain sensitive financial/identity data. Prefer local/private processing where practical; never send samples to third parties without explicit data-flow review. |
| License/IP | Actual/Firefly are references, not code sources by default. MinerU has a custom license based on Apache 2.0 and requires exact license review before adoption. |
| Operational complexity | #511 adds minimal operations. OCR/provider paths add model/service/runtime health and resource cost. |
| Rollback/recovery | #511 should be revertable without data migration. New source adapters must remain replayable/idempotent and preserve raw/source provenance according to current product policy. |

## 8. Recommendation

**Adapt.** Execute the sequence **exception-first review → structured file/statement robustness → OCR/document benchmark → provider/native acquisition only after measured evidence**. #511 is the right next bounded product slice because it exploits existing trusted data and can measure maintenance reduction without adding an uncertain source. After #511, run a Vietnam statement-format experiment against user-obtainable CSV/XLSX/PDF exports. Use the results to define a parser adapter contract and only then benchmark MinerU/PaddleOCR on the document cases that structured parsing cannot cover.

Do not broaden matching or auto-posting to manufacture a larger `ready` set.

## 9. Confidence

**High for sequencing #511 before OCR/provider work; Medium for statement/file robustness being the immediate next acquisition lane.**

The first conclusion is supported by current MoneyFlow architecture, corpus signals and convergent review/dedup patterns from three mature PFM products. The second is limited by incomplete consumer-bank format coverage in Vietnam and needs a real-source inventory.

## 10. Verification before implementation

### For #511

- prove the readiness classifier never relies on fallback account/category selection;
- unit-test every exclusion reason;
- browser-test a mixed batch where only deterministic-ready rows are selected and explicitly approved;
- measure before/after interaction count on the same representative fixture;
- verify exceptions remain pending and single-review/reject/duplicate/transfer paths remain intact.

### For the following statement/file experiment

- collect a small private fixture set from multiple Vietnamese banks/channels with secrets/account numbers sanitized or synthetically replaced;
- record format, columns, encoding, date/amount conventions, account metadata, transaction/reference IDs and running-balance behavior;
- distinguish consumer from business exports;
- define parse success and source-identity coverage before choosing parser implementations;
- do not commit raw personal statements to Git.

### For OCR

- create a sealed benchmark set covering digital PDFs, scanned PDFs, photographed receipts, transfer screenshots and table-heavy statements;
- compare MinerU/PaddleOCR/structured extraction using field-level metrics and review burden;
- document local/remote data flow, model license, resource cost and failure behavior;
- adopt only if measured benefit exceeds the simpler parser path.

## 11. Invalidation / refresh triggers

Re-review when:

- #511 produces real interaction/correction measurements;
- MoneyFlow's Inbox/candidate model materially changes;
- a representative Vietnam bank-source inventory is completed;
- a bank/provider offers a materially different official consumer export/API path;
- MinerU/PaddleOCR licensing, architecture or benchmark behavior changes;
- product evidence shows users do not value a combined/reconciled ledger despite reduced maintenance.

## 12. Open questions

1. What percentage of real MoneyFlow import candidates can satisfy deterministic `ready` criteria without new inference?
2. Which Vietnamese consumer banks expose CSV/XLSX versus only PDF, and which include stable transaction/reference IDs?
3. How often do statement rows represent pending versus posted transactions, and can those states be identified reliably from files?
4. What private fixture policy lets the project benchmark financial documents without retaining user PII?
5. Does OCR reduce total review interventions once extraction errors are included, rather than only reducing keystrokes?

## 13. Links back to MoneyFlow

- Issue/spec/packet: `Thunderkill016/moneyflow#511`, master program `#432`
- PR/implementation: none yet
- Related research: `docs/product/2026-08-28-community-corpus-decision-intelligence.md`; `docs/engineering/2026-08-28-research-corpus-ingestion-and-dedup.md`; `decisions/2026-08-28-project-intelligence-corpus-policy.md`
