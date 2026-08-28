# Community corpus decision intelligence — 2026-08-28

- **Status:** active
- **Date:** 2026-08-28
- **Area:** product / user research / acquisition / review UX
- **Decision boundary:** qualitative community evidence and project-wide research routing. This record does not establish market size, prevalence, willingness to pay, or implementation authority.
- **Corpus snapshot:** 785 canonical posts, 13,671 canonical comments, 14,456 searchable analysis records.

## Bounded question

What durable MoneyFlow product signals are supported by the current Vietnamese community corpus, how strong are they inside this corpus, and what evidence is still missing before broader product claims are justified?

## Corpus provenance and limits

The current master corpus consolidates historical and newly supplied Facebook research bundles with stable source identity, bundle fingerprinting, lineage, privacy sanitization, and duplicate-family tracking.

Current evidence state:

- 785 canonical posts;
- 13,671 canonical comments;
- 27 adjudicated core-PFM posts;
- 1,959 core-PFM comments;
- 182 strong direct financial/user-evidence comments;
- 572 posts are post-only (`commentCoverage=not_collected`) and may inform project knowledge but cannot increase user-demand counts;
- corpus concentration remains heavily skewed toward J2TEAM Community and Build in Public / Indie Hackers Vietnam, so market-generalization confidence is capped.

Repeated or semantically similar comments from independent users are preserved as independent evidence. Duplicate source observations, derived bundles, repost candidates, and exact-content families are tracked separately so repeated acquisition does not inflate evidence counts.

## Strongest current product signals

The following confidence labels are project heuristics based on adequacy, coherence, relevance, and methodological limitations. They are not a formal GRADE-CERQual assessment.

| Theme | Strong comments | Authors | Posts | Within-corpus confidence | Market-generalization |
|---|---:|---:|---:|---|---|
| Manual entry / quick capture | 42 | 39 | 12 | high | moderate |
| Bank sync / import | 30 | 29 | 12 | high | moderate |
| Habit / discipline burden | 34 | 32 | 11 | high | moderate |
| Acquisition automation | 15 | 15 | 9 | high | moderate |
| UX simplicity | 19 | 18 | 8 | high | moderate |
| AI / natural-language capture | 21 | 20 | 7 | moderate | moderate |
| Reliability / data integrity | 10 | 10 | 7 | moderate | moderate |
| Cash handling | 13 | 13 | 6 | moderate | low |
| Planning / insight | 19 | 18 | 9 | moderate | moderate |
| Spreadsheet workaround | 28 | 25 | 9 | moderate | moderate |

## Facts supported by the corpus

### Capture maintenance is the clearest repeated friction

The strongest recurring evidence is not lack of features; it is the recurring burden of remembering, entering, correcting, and maintaining transaction data. Natural-language capture, chat entry, widgets, bank import, OCR, and automation should therefore be evaluated primarily by how much trusted maintenance work they remove.

### Trust and reconciliation are product concerns, not backend details

The corpus contains repeated failure modes around missing records, broken sync, incorrect classification, account/source ambiguity, cash gaps, transfer handling, and the need to correct or delete entries. Faster capture that produces uncertain ledger state does not solve the core job.

### Users commonly retain external workarounds

Spreadsheet and native bank/wallet workflows recur as alternatives because they provide some combination of inspectability, control, low incremental cost, and source truth. MoneyFlow should treat these as competing workflows rather than only competing apps.

### AI is a means, not the strongest product thesis

AI / natural-language capture has real direct evidence, but the stronger underlying problem is capture and reconciliation friction. The evidence does not justify positioning MoneyFlow primarily as an “AI finance app.” AI should be adopted where it measurably reduces user intervention without weakening correctness or trust.

### Bank/import automation is promising but bounded

Bank or statement import can reduce manual capture, but the evidence also contains privacy concerns, source-coverage gaps, sync/reliability failures, cash/off-system transactions, and reconciliation burden. Treat bank/import as one acquisition adapter into a canonical ledger, not as the ledger itself.

## Inferences for MoneyFlow

1. **Optimize the whole maintenance loop, not only entry speed.** A useful product metric is interventions per 100 transactions or maintenance minutes per period, not only fields per form.
2. **Preserve source/account identity and transfer semantics.** A whole-money view requires knowing where money came from and whether movement is a transfer rather than income/expense.
3. **Make correction and exception handling first-class.** Duplicate review, category/source correction, amount/date correction, reject/delete, and transfer pairing are normal states.
4. **Keep manual capture first-class while progressively reducing retyping.** Automatic and assisted acquisition should lower work without making the ledger opaque.
5. **Do not let feature breadth outrun ledger trust.** Planning, AI advice, household features, and broader wealth scope depend on trustworthy underlying records.

## Contrary / caution evidence

- Community data is self-selected and tech-skewed.
- Builder comments and maker responses are not equivalent to independent user demand.
- Repeated mentions in post text are not equivalent to strong direct evidence.
- Post-only records provide useful project/market context but do not establish comment-level demand.
- Routing tags such as `ai_ml`, `product_strategy`, or `security_privacy` are retrieval/coverage metadata, not prevalence estimates.
- Current evidence cannot establish pricing, retention lift, market size, or feature adoption rates.

## Highest evidence gaps

### P0

1. **Capture outside tech communities:** does capture friction remain dominant among non-technical Vietnamese users?
2. **Real-use reconciliation:** which duplicate, transfer, persistence, latency, and trust failures appear during seven days of actual phone use?
3. **Source diversity:** which user segments and communities are missing from the current corpus?
4. **Design failure history:** what prior UI/design failures and missing gates caused repeated refactors?

### P1

1. Bank/statement import tradeoffs: friction removed versus privacy, coverage, idempotency, transfer, and reconciliation cost.
2. OCR/document capture benchmark on Vietnamese receipts, transfer screenshots, and statements using field accuracy, not character accuracy alone.
3. Runtime correctness/sync failure modes that need representative tests before broader feature expansion.
4. Pricing/willingness-to-pay after core capture and reconciliation friction is actually reduced.
5. Security/privacy guarantees required for imports, OCR, auth, local/offline data, and derived evidence.

## Recommendation

**Adapt as active product evidence; do not translate directly into feature requirements.**

For the current MoneyFlow mission, prioritize proving a trustworthy daily-ledger loop and reducing interventions required to keep that ledger correct. Use AI, OCR, bank import, and automation as bounded acquisition/reconciliation experiments rather than product identity claims.

Shared/family and broader asset/investment expansion should remain lower priority unless the target ICP changes or new evidence materially strengthens those wedges.

## Verification before implementation

- run the required physical-phone and seven-day daily-ledger test;
- measure interventions per 100 transactions and maintenance minutes;
- classify every correction/reconciliation event;
- distinguish cash/off-system events from digitally sourced events;
- benchmark import/OCR by field-level accuracy and review burden;
- expand research beyond the current tech-skewed communities before making market-wide claims.

## Refresh / invalidation triggers

Refresh this record when:

- materially new community/source segments are ingested;
- the 572 post-only records gain comment snapshots;
- MoneyFlow completes the seven-day real-use validation;
- OCR/import experiments produce measured field accuracy and review burden;
- product strategy changes the target ICP;
- contradictory evidence materially changes one of the high-confidence themes.

## Related records

- `docs/product/2026-08-27-build-in-public-vn-pfm-community-signals.md` — earlier two-thread bounded record; still useful as source-level history but superseded for corpus-wide conclusions by this record.
- `docs/engineering/2026-08-28-research-corpus-ingestion-and-dedup.md` — corpus integrity, lineage, deduplication, privacy, and retrieval mechanics.
- `decisions/2026-08-28-project-intelligence-corpus-policy.md` — interpretation policy for project-wide knowledge versus user evidence.
