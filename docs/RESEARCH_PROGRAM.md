# MoneyFlow Research Program

- **Status:** active research map
- **Date:** 2026-08-27
- **Authority:** research prioritization only; never product execution authority
- **Product authority:** https://github.com/Thunderkill016/moneyflow

## Purpose

This document identifies high-value research territories that can improve future MoneyFlow decisions. It does not select implementation work, create a roadmap, or authorize feature scope.

Research should start only when a current MoneyFlow question needs evidence that is not already sufficient in the product repository or existing research.

## Current high-value research territories

### 1. Low-maintenance acquisition for Vietnam

Core question: **Which acquisition paths can reduce interventions per 100 transactions without reducing precision or creating a second source of financial truth?**

Useful sub-questions:

- Which Vietnamese transaction sources are realistically available: CSV/export, share sheet, email, notifications, bank APIs, e-wallet exports, statements?
- Which sources provide stable external identity versus only descriptions/date/amount?
- What normalization can be deterministic and explainable?
- What exception-first review patterns minimize maintenance without hiding uncertainty?
- Which acquisition sources are viable under platform/store/privacy constraints?

Expected evidence: official provider/platform docs first, current MoneyFlow acquisition code/tests, Actual/Firefly source behavior, measured user-maintenance outcomes.

### 2. Provider / bank / e-wallet connectivity in Vietnam

Core question: **When does a read-only provider adapter become evidence-backed enough to justify implementation?**

Research must establish, for a specific provider/path:

- official API or contract availability;
- consent/auth model;
- transaction/account semantics;
- stable IDs and lifecycle states;
- pricing/economics;
- data-retention/privacy constraints;
- outage/retry/rate-limit behavior;
- provider identity and legal/commercial access requirements;
- rollback/offboarding behavior.

Do not infer Vietnam capability from PSD2/Open Banking implementations in other regions.

### 3. Transfer lifecycle clearing

Core question: **How should external source evidence affect multi-leg internal transfers without misclassifying income/expense or corrupting reconciliation?**

Research dimensions:

- source identity on one or both legs;
- pending → cleared transitions;
- transfer pairing and mismatched timestamps/amounts;
- provider corrections/removals;
- user edits versus source updates;
- statement reconciliation precedence;
- idempotent replay and rollback.

This should be treated as a financial-correctness research problem, not merely an import UX problem.

### 4. Merchant/payee normalization and deterministic rules

Core question: **What normalization/rule system lowers repeated review while remaining explainable, reversible, and provenance-preserving?**

Research dimensions:

- exact deterministic transformations;
- merchant aliases;
- category rules;
- rule versioning;
- confidence and ambiguity;
- rule conflict ordering;
- rollback and reprocessing semantics;
- measured false-positive cost.

Separate explicit user-authored/deterministic rules from inferred behavioral automation.

### 5. Exception-first review UX

Core question: **What should MoneyFlow show first when most imported evidence is routine but a minority requires judgment?**

Research dimensions:

- review queues and grouping;
- confidence/uncertainty communication;
- duplicate/transfer/source-correction explanations;
- bulk actions and safety boundaries;
- undo/recovery;
- mobile versus desktop review ergonomics;
- accessibility and non-color-only status communication.

Measure task completion and error recovery, not only subjective preference.

### 6. Vietnam privacy / personal-data operations

Core question: **What operational privacy obligations apply to MoneyFlow's actual data flows and deployment model in Vietnam?**

Research should distinguish:

- legal requirements;
- provider/platform contractual requirements;
- product policy choices;
- recommended security/privacy practice.

Competent legal review remains necessary for legal conclusions. Research should prepare the evidence/data-flow map, not impersonate legal approval.

### 7. Product evidence and privacy-preserving analytics

Core question: **What minimal telemetry can answer whether MoneyFlow reduces maintenance and improves financial understanding without collecting financial content?**

Possible measures:

- interventions per 100 acquired transactions;
- review completion rate;
- correction/reversal rate;
- time to reconcile;
- import failure rate;
- activation/retention milestones without amounts, balances, descriptions, account IDs, or raw source content.

Research Umami/simple first-party aggregation before adopting deeper analytics infrastructure.

### 8. Future domains — research only when dependencies justify it

The following remain horizon research, not default expansion targets:

- native mobile acquisition;
- household/shared finance;
- wealth/investments;
- multi-currency accounting;
- AI-assisted understanding or mutation.

Each requires its own product, financial, privacy, security, and operational specification before implementation.

## Research sequencing principle

Prefer questions that remove uncertainty for the next bounded MoneyFlow decision. Do not perform broad “future feature” research simply because a source or competitor makes it look interesting.

A good research task should end with one of:

- a decision can now be made;
- an option can be rejected;
- a bounded experiment is specified;
- a provider/legal/owner dependency is made explicit;
- the evidence is insufficient and the exact missing evidence is known.

## Success criteria for this repository

This repository is useful when it reduces repeated research and bad assumptions. Indicators:

- future tasks find prior evidence quickly;
- conclusions link to current MoneyFlow baselines;
- stale evidence is recognizable;
- negative results prevent repeated dead ends;
- implementation PRs cite bounded research instead of re-running broad discovery;
- research does not silently become roadmap authority.
