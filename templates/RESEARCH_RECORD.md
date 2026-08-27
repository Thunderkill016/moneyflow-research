# <Research question>

- **Status:** draft
- **Date:** YYYY-MM-DD
- **Area:** product | domain | acquisition | engineering | security-privacy | ux | experiment
- **MoneyFlow baseline:** link to relevant commit/docs/code/tests
- **Decision boundary:** what decision this research may inform

## 1. Question

State one bounded question. Avoid broad prompts such as “research banking”.

## 2. Current MoneyFlow baseline

Summarize only the current facts needed to understand the question. Link to the product repository rather than copying large sections.

## 3. Why this question matters

What user, correctness, trust, maintenance, cost, or delivery problem would a good answer improve?

## 4. Sources reviewed

| Source | Type | What it establishes | What it does not establish |
|---|---|---|---|
| | | | |

Default: 2–4 focused sources. Use more only when coverage genuinely requires it.

## 5. Findings

### Facts

Evidence directly supported by sources or current MoneyFlow behavior.

### Inferences

Reasoned conclusions that combine facts. State assumptions.

### Contrary evidence / tensions

Evidence that weakens, limits, or conflicts with the leading conclusion.

## 6. Applicability to MoneyFlow

### Applies

Which patterns or constraints transfer to MoneyFlow and why?

### Does not apply

Which source assumptions differ: geography, regulation, architecture, product model, scale, currency, platform, license, user segment, etc.?

## 7. Risk review

| Risk | Finding |
|---|---|
| Financial correctness | |
| Security | |
| Privacy/data ownership | |
| License/IP | |
| Operational complexity | |
| Rollback/recovery | |

Use `not applicable` only when justified.

## 8. Recommendation

Choose one:

- **Adopt** — pattern fits substantially as-is;
- **Adapt** — useful but MoneyFlow-specific changes are required;
- **Reject** — evidence indicates poor fit or unacceptable risk;
- **Defer** — useful question, wrong dependency order/timing;
- **Experiment** — evidence is insufficient; run a bounded test.

Then state the recommendation in one paragraph.

## 9. Confidence

**Low | Medium | High**

Explain why. Confidence is about this conclusion under current evidence, not certainty about the future.

## 10. Verification before implementation

What code/test/prototype/provider/legal/user evidence must MoneyFlow obtain before treating the recommendation as implementation-ready?

## 11. Invalidation / refresh triggers

List concrete events that should force re-review, such as:

- provider/regulation/API policy change;
- reference repository license or architecture change;
- MoneyFlow changes the affected subsystem;
- production/user evidence contradicts the conclusion;
- six or twelve months pass for time-sensitive evidence.

## 12. Open questions

Only unresolved questions that materially affect the decision.

## 13. Links back to MoneyFlow

- Issue/spec/packet:
- PR/implementation:
- Related research:
