# Research decision — project-intelligence corpus policy

- **Status:** active
- **Date:** 2026-08-28
- **Scope:** interpretation of research corpus evidence only
- **Authority:** research repository decision; does not override MoneyFlow product/runtime authority

## Decision

MoneyFlow Research will treat the accumulated corpus as a **project-intelligence evidence base**, not only a personal-finance feature-demand dataset.

Useful evidence may support product, UX, engineering, data/automation, AI/ML, document intelligence, security/privacy, operations/reliability, tooling, growth/monetization, competition/market, project workflow, research method, or financial-domain questions.

Only true noise is disposable. “Not directly PFM” is not a valid reason to discard a source.

## Separation of evidence lanes

### User/financial evidence

Use for claims about user pain, behavior, requests, workarounds, failure modes, or demand.

Requirements:

- identify independent evidence units;
- separate users from makers/builders where possible;
- distinguish direct pain/request/workaround from incidental mention;
- do not increase demand counts from post-only records whose comments were not collected;
- preserve counterexamples and contradictory evidence.

### Project knowledge

Use for reusable product/engineering/operational lessons, technology candidates, failure patterns, benchmarks, methods, or architecture considerations.

A maker report, technical discussion, OCR workflow, security incident, platform limitation, or tooling lesson can be valuable project knowledge without being evidence of user demand.

### Project history / runtime truth

Current MoneyFlow code, tests, migrations, logs, measured behavior, and project decisions remain higher-authority evidence for what MoneyFlow actually does. Research findings must be verified against the product repository before implementation decisions.

## Routing rule

Project-intelligence domain tags are retrieval metadata, not prevalence or confidence scores. Machine routing may help discover related records but cannot transform repeated words into product-demand evidence.

A source can carry multiple domains and can be directly relevant, cross-cutting relevant, or reference-only. Reference-only records remain searchable when they may have future reuse value.

## Confidence rule

Claim confidence should consider at least:

- adequacy: how much independent evidence exists;
- coherence: whether evidence points in the same direction;
- relevance: how closely the sample matches the MoneyFlow decision;
- methodological limitations: source bias, missing comments, maker contamination, collection limitations, or coding uncertainty.

This is an internal decision-support heuristic, not a formal GRADE-CERQual assessment.

## Current corpus interpretation

As of 2026-08-28:

- 785 canonical posts;
- 13,671 canonical comments;
- 182 strong financial/user-evidence comments;
- 572 posts have `commentCoverage=not_collected`;
- routing identifies broad project knowledge beyond finance, but routing counts must not be reported as user-demand prevalence.

The strongest current product evidence inside the adjudicated financial subset concerns capture/manual-entry burden, habit/maintenance burden, bank/import interest, acquisition automation, and UX simplicity. Market-wide confidence remains limited by concentration in tech-skewed Vietnamese communities.

## Consequences

### Positive

- useful engineering/product knowledge is no longer discarded for being “non-finance”;
- user-demand claims stay protected from builder/technical-content contamination;
- future research can target coverage gaps instead of repeating already-known topics;
- corpus growth does not automatically inflate evidence strength.

### Costs

- two parallel interpretation lanes must be maintained;
- machine routing needs calibration and cannot be treated as final classification;
- more records remain searchable even when they are not immediately actionable;
- high-impact claims still require manual adjudication and product-repo verification.

## Invalidation / review triggers

Revisit this decision if:

- the repository changes from a research evidence base into a different product function;
- source diversity becomes broad enough that current market-generalization limits materially change;
- a validated automated evidence classifier can replace part of manual adjudication without losing source/author independence;
- privacy/licensing constraints require a narrower retention policy.

## Related records

- `docs/product/2026-08-28-community-corpus-decision-intelligence.md`
- `docs/engineering/2026-08-28-research-corpus-ingestion-and-dedup.md`
- `AGENTS.md`
