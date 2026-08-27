# Research knowledge map

Use this page to find the smallest relevant research surface. Do not preload the whole repository for every task.

## Research domains

| Domain | Directory | Typical questions |
|---|---|---|
| Product & users | `docs/product/` | Who is the user, what job matters, why do people adopt/churn, what differentiates MoneyFlow? |
| Financial domain | `docs/domain/` | Ledger semantics, transfers, reconciliation, budgets, recurring, goals, reporting correctness |
| Acquisition | `docs/acquisition/` | CSV/share/device/provider evidence, normalization, dedup, matching, lifecycle, review burden |
| Engineering | `docs/engineering/` | Architecture, dependencies, durability, observability, testing, CI, performance |
| Security & privacy | `docs/security-privacy/` | Auth, RLS, sensitive data, privacy, Vietnam compliance, provider trust boundaries |
| UX & accessibility | `docs/ux/` | Capture friction, information hierarchy, responsive behavior, accessibility, review workflows |
| Experiments | `docs/experiments/` | Measured hypotheses, prototypes, benchmarks, negative results |

## Shared indexes

- [`../sources/SOURCE_LEDGER.md`](../sources/SOURCE_LEDGER.md) — reusable sources and why they matter.
- [`../decisions/README.md`](../decisions/README.md) — research interpretation/selection decisions; never product execution authority.
- [`../templates/RESEARCH_RECORD.md`](../templates/RESEARCH_RECORD.md) — default bounded research record.
- [`../templates/TRADE_STUDY.md`](../templates/TRADE_STUDY.md) — compare alternatives with explicit criteria.
- [`../templates/EXPERIMENT_RECORD.md`](../templates/EXPERIMENT_RECORD.md) — reproducible measured work.

## How to start a research task

1. Read the relevant current state from the MoneyFlow product repo.
2. Search this repository for prior research on the exact question.
3. If current evidence is sufficient, reuse it rather than creating another document.
4. If evidence is stale or incomplete, create a bounded record in the matching domain directory.
5. Update the source ledger only when a source has reusable value beyond one record.
6. Link the resulting research record back from the MoneyFlow issue/spec/PR that consumes it.

## Naming convention

Prefer descriptive responsibility-based names:

```text
YYYY-MM-DD-<topic>.md
```

Examples:

```text
2026-08-27-vietnam-bank-data-access.md
2026-08-27-transfer-lifecycle-clearing.md
2026-08-27-exception-first-review-benchmark.md
```

Long-lived indexes or maps may use stable descriptive names without a date.

## Status vocabulary

Use one of:

- `draft` — research in progress;
- `active` — current reusable evidence;
- `needs-refresh` — still useful but time-sensitive evidence needs re-checking;
- `superseded` — replaced by a named newer record;
- `archived` — historical context only.

A research record's status is about evidence validity, not MoneyFlow implementation status.
