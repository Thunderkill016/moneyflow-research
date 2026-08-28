# What should MoneyFlow build next to reduce actual retyping without reducing trust?

- **Status:** corrected after implementation-level review
- **Date:** 2026-08-28
- **Area:** acquisition / capture
- **MoneyFlow baseline:** `Thunderkill016/moneyflow@133fa462d3cd5f90b1f70cccb179547815c2ba2d`; master program #432; #511 selected by PR #521; implementation PR #522 remains draft
- **Decision boundary:** decide which near-term work most directly attacks the strongest observed user problem. This record does not itself authorize implementation, provider access, automatic posting, AI mutation, or native rewrite.

## 1. Correction

The earlier version of this record ranked exception-first Inbox review (#511) ahead of acquisition work because it had excellent architecture fit and low implementation risk. That was the wrong primary decision criterion.

The corpus does not say the main problem is "bulk review is too expensive." Its strongest repeated signal is the burden of remembering, entering, correcting, and maintaining transaction data. #511 can improve review safety, but it does **not** materially reduce the work required to get a transaction into MoneyFlow in the first place.

This corrected record therefore starts from the user problem, not from which existing subsystem is easiest to extend.

## 2. Evidence that should control priority

Current adjudicated PFM evidence:

| Signal | Strong comments | Authors | Posts | Interpretation |
|---|---:|---:|---:|---|
| Manual entry / quick capture | 42 | 39 | 12 | strongest direct capture-friction theme |
| Habit / discipline burden | 34 | 32 | 11 | repeated logging itself is hard to sustain |
| Bank sync / import | 30 | 29 | 12 | strong interest in avoiding retyping from digital sources |
| Spreadsheet workaround | 28 | 25 | 9 | users retain inspectable low-cost alternatives |
| Acquisition automation | 15 | 15 | 9 | automation is valuable when it removes trusted maintenance work |
| Reliability / data integrity | 10 | 10 | 7 | faster capture is not useful if the ledger becomes untrustworthy |

The corpus is tech-community-skewed, so these numbers are not Vietnam-wide prevalence. They are strong enough to rank problems inside the current evidence base, not to claim national market share.

## 3. Current product truth

### Manual quick capture is already highly compressed

MoneyFlow's current quick-entry path already contains several optimizations that a fresh roadmap should not pretend are missing:

- amount-first entry;
- current date by default;
- remembered account/category preferences;
- recent account/category presets;
- deterministic rule-assisted category selection from note text;
- `Lưu & thêm tiếp` for repeated entry;
- PWA manifest shortcuts directly to expense, income, and transfer quick capture.

For a returning user whose defaults are valid, the remaining direct-entry path can already approach **amount → save**. Further form polishing may still help, but current evidence does not show that another quick-form redesign is the highest-leverage next slice.

### File ingestion exists, but real-source compatibility is still shallow

MoneyFlow currently accepts CSV, XLS/XLSX, and PDF uploads, but the implementation is deliberately generic/narrow:

- CSV/XLSX share one heuristic parser centered on date, amount/debit/credit, and description;
- XLS/XLSX reads the first sheet and then reuses the CSV matrix heuristics;
- generic parsing does not preserve bank transaction/reference identity or account/source metadata as first-class parsed fields;
- PDF support is a narrow text-layer demo template, not general Vietnamese bank-statement support;
- scanned/image PDF OCR is explicitly unsupported.

This means the product has the **pipeline** for batch acquisition but has not yet proven that ordinary consumer bank exports can enter it with low correction burden.

## 4. Current external context

Current official sources support two bounded facts relevant to prioritization:

1. **Vietnamese day-to-day digital payments are heavily mobile-banking/QR mediated.** NAPAS reported that by October 2025 nearly 90 million mobile-banking accounts were using bank apps to scan VietQR, with 3.6 billion VietQR transfers in the first ten months of 2025. This does not tell us MoneyFlow's future user mix, but it makes bank-app transaction history a materially important source family to investigate.
2. **Consumer-exportable transaction history exists.** Vietcombank's official VCB Digibank guide allows users to search account transaction history and export it to Excel. Other official bank channels also expose statement/file downloads, but formats and consumer/business parity vary and must not be assumed universal.

The right inference is not "support every bank." It is: real user-obtainable bank history is a plausible high-volume acquisition source, and MoneyFlow should measure compatibility before investing in provider/native sync.

## 5. Split the problem by transaction source

A single capture strategy is wrong because the source problem differs.

### A. Digitally sourced bank / QR transactions

Primary outcome: **stop retyping transactions that already exist as bank-side digital records.**

Best near-term experiment: make MoneyFlow ingest a small set of real consumer statement/export families reliably through the existing source → candidate → review → ledger architecture.

Success must be measured as:

- transactions imported per user acquisition action;
- exact amount/date preservation;
- source/account identity coverage;
- transaction/reference identity preservation when the source provides it;
- percent of rows requiring manual correction;
- duplicate/transfer errors;
- interventions per 100 imported rows;
- reconciliation/correction burden after import.

### B. Cash / off-system transactions

Primary outcome: **keep direct entry near one-field friction.**

Current Quick Capture already has most obvious fast-path mechanics. The next manual-entry change should only be selected after a real-use test identifies a remaining repeated bottleneck (for example launch friction, wrong default, category correction, or save latency). Do not redesign the form merely because manual entry is the strongest theme.

## 6. Re-evaluation of #511

#511 is useful **trust/safety infrastructure**, not the primary capture-reduction feature.

The current pre-#511 Inbox already has one-click `Chọn tất cả` followed by review and confirmation. Therefore a `select Ready → review → confirm` path is not a general reduction from five clicks to three; the raw minimum bulk path was already three activations. #511's actual value is that deterministic Ready classification can keep duplicate/transfer/low-confidence/unresolved exceptions out of grouped posting and reduce row-by-row decision burden.

That can matter once batch acquisition is working at scale, but it should not be used as evidence that MoneyFlow has solved manual-entry friction.

A separate correctness issue discovered during #511 implementation is still valid: grouped/keyboard approval must never bypass explicit confirmation or admit unsafe exception classes. That safety defect should be fixed even if #511 is no longer treated as the roadmap's main acquisition bet.

## 7. Corrected sequence

### P0 — prove real consumer bank-file compatibility

Before adding a provider or OCR engine, inventory and benchmark user-obtainable consumer exports from multiple Vietnamese bank channels.

For each source family capture:

- exact export format and channel;
- preamble/header/table layout;
- date and posting/value-date fields;
- signed amount versus debit/credit columns;
- description/payee fields;
- account/source metadata;
- stable transaction/reference identifier;
- running balance;
- pending/posted signal if present;
- current MoneyFlow parse result and correction burden.

Use sanitized/synthetic fixtures; raw personal statements stay outside Git.

### P1 — implement the smallest fixture-backed compatibility slice

After the inventory exposes concrete failures, implement only the smallest parser/adapter changes that materially increase reliable row acquisition. Candidate changes may include header-row discovery, source-specific normalized field extraction, stable reference preservation, or explicit account/source mapping—but only when the fixture evidence demands them.

Do not create a universal heuristic by guessing unseen bank formats.

### P1 — preserve the manual fast path

Run a short real-use capture test on cash/off-system entries. Only build another manual-capture slice if observed friction remains after the existing amount-first/default/save-next/PWA-shortcut path.

### P2 — OCR only for source classes structured parsing cannot cover

Benchmark screenshots, transfer receipts, scanned statements, and image PDFs only after the source inventory identifies a real uncovered class. Compare by financial-field accuracy and correction burden, not character OCR accuracy.

### Later — provider/native acquisition

Provider/native sync can eventually remove more maintenance, but it adds consent, token, source-health, policy, privacy, retry, distribution, and operational dependencies. Do not pay those costs before provider-neutral file acquisition proves the core thesis.

### Fallback — SMS

SMS ingestion is legacy/fallback coverage, not a primary acquisition bet. Current bank behavior increasingly exposes app/OTT notifications and bank-app history; this is enough to deprioritize SMS but not enough to make a population-wide SMS usage claim.

## 8. What not to build from this evidence

- no "AI finance app" positioning;
- no family/shared roadmap promotion from weak evidence;
- no investment/wealth expansion before the daily ledger loop is proven;
- no fuzzy matching or fallback account/category guesses to manufacture automation metrics;
- no OCR engine commitment before a field-level benchmark;
- no provider integration merely because bank import is a strong theme;
- no additional quick-capture redesign without measured remaining friction.

## 9. Decision rule for the next MoneyFlow slice

A candidate feature should not become the current product slice unless it can answer all four questions:

1. **Which adjudicated user problem does it attack?**
2. **Which current product behavior proves the gap still exists?**
3. **What user-level metric should move if the feature works?**
4. **What evidence would cause us to reject or stop the feature?**

For the immediate next acquisition work, the target problem is manual retyping of already-digital bank transactions; the current gap is shallow real-source statement compatibility; the metric is trusted rows acquired per user action plus correction burden; the invalidation condition is that real consumer exports are inaccessible, too inconsistent, or require so much cleanup that they do not beat direct capture.

## 10. Recommendation

**Correct the roadmap.** Treat #511/#522 as review-safety work, not as the main answer to capture friction. The next product-selection decision should be gated by a real Vietnamese consumer statement-format inventory and should prefer the smallest fixture-backed import compatibility slice that reduces actual retyping.

For cash/off-system transactions, keep the current fast manual path until real-use evidence demonstrates another repeated bottleneck.

## 11. Confidence and limitations

- **High** that the previous claim equating #511 with manual-entry reduction was wrong; current code and existing `Chọn tất cả` behavior make that directly observable.
- **High inside the corpus** that capture/maintenance burden is the strongest recurring problem family.
- **Medium** that consumer statement/file compatibility is the highest-leverage next acquisition lane; official export evidence exists, but actual cross-bank format coverage and user willingness to export files remain insufficiently measured.
- **Low/unknown** for national prevalence, pricing, retention lift, and the proportion of users who will routinely export statements.

## 12. Verification before implementation

1. Complete the privacy-safe source-format matrix in research issue #5.
2. Test current MoneyFlow parsing against synthetic fixtures preserving observed bank structures.
3. Record failures by field, not by generic "parse failed" labels.
4. Select one bounded adapter/parser slice only after the failure distribution is known.
5. For the manual lane, run a real-use capture session before modifying Quick Capture again.
6. Keep import output as candidates until explicit ledger validation/review; source evidence never establishes `reconciled`.

## 13. Refresh triggers

Refresh this decision when:

- real consumer bank export fixtures are inventoried;
- current parser performance is measured against those fixtures;
- a seven-day phone-use test produces actual capture friction data;
- a provider offers a materially different official read-only path;
- new non-tech Vietnamese user evidence materially changes the capture ranking.

## 14. Links

- Corpus decision intelligence: `docs/product/2026-08-28-community-corpus-decision-intelligence.md`
- Source-format experiment: research issue #5
- MoneyFlow master: `Thunderkill016/moneyflow#432`
- Current review-safety slice: `Thunderkill016/moneyflow#511`
- Current draft implementation: `Thunderkill016/moneyflow#522`
