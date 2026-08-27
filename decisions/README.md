# Research decisions

This directory records **research interpretation decisions**: how evidence was selected, scoped, or interpreted when that choice has reusable value.

It does not replace product, architecture, execution, release, or implementation authority in the MoneyFlow product repository.

## When to create a research decision

Create one when future researchers are likely to ask “why did we trust/reject/use this evidence or method?” Examples:

- choosing one benchmark methodology over another;
- deciding a provider/source class is not comparable to MoneyFlow;
- accepting a known evidence limitation for a research conclusion;
- changing a long-lived research taxonomy or source-quality rule.

Do not create one for routine findings that fit inside a normal research record.

## Suggested format

```text
# R-DEC-XXXX — title

Status: proposed | accepted | superseded
Date: YYYY-MM-DD

## Context
## Decision
## Alternatives considered
## Consequences
## Evidence
## Superseded by
```

Keep decisions short. Link supporting research instead of duplicating it.
