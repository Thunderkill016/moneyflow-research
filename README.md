# MoneyFlow Research

Research knowledge base for the MoneyFlow personal-finance product.

This repository exists to collect, evaluate, and preserve **research evidence** that can improve MoneyFlow product and engineering decisions. It is deliberately separate from the product repository.

## Authority boundary

This repository is **not** the source of truth for current MoneyFlow runtime behavior, product capability, implementation status, execution order, or release readiness.

For those questions, the authoritative repository is [`Thunderkill016/moneyflow`](https://github.com/Thunderkill016/moneyflow).

Research here may propose, compare, challenge, or recommend. It does not authorize implementation by itself.

## What belongs here

- product and user research;
- Vietnam personal-finance market/context research;
- competitor and alternative analysis;
- financial-domain research;
- acquisition/import/reconciliation research;
- security, privacy, compliance, and trust research;
- UX/accessibility research;
- open-source/reference-repository analysis;
- technology and architecture trade studies;
- experiments, negative results, and reusable findings;
- source inventories and research methodology.

## What does not belong here

- current execution queue or roadmap authority;
- product implementation truth that should be verified from code/tests;
- secrets, private user data, provider credentials, or raw production data;
- copied proprietary content;
- speculative claims presented as facts.

## Start here

1. Read [`AGENTS.md`](./AGENTS.md) for research rules.
2. Read [`docs/README.md`](./docs/README.md) for the knowledge map.
3. Use [`templates/RESEARCH_RECORD.md`](./templates/RESEARCH_RECORD.md) for new bounded research.
4. Add reusable sources to [`sources/SOURCE_LEDGER.md`](./sources/SOURCE_LEDGER.md).
5. Record implementation-impacting recommendations as evidence, then validate them against the current MoneyFlow repository before acting.

## Repository shape

```text
moneyflow-research/
├── AGENTS.md
├── README.md
├── docs/
│   ├── README.md
│   ├── product/
│   ├── domain/
│   ├── acquisition/
│   ├── engineering/
│   ├── security-privacy/
│   ├── ux/
│   └── experiments/
├── sources/
│   └── SOURCE_LEDGER.md
├── decisions/
│   └── README.md
├── templates/
│   ├── RESEARCH_RECORD.md
│   ├── TRADE_STUDY.md
│   └── EXPERIMENT_RECORD.md
└── tools/
    └── facebook-research-collector/
```

## Research tooling

[`tools/facebook-research-collector/`](./tools/facebook-research-collector/) is a bounded, browser-assisted collector for reducing manual copy/paste when studying Facebook community posts. It keeps browser state and collected source material local/gitignored; it is not a production MoneyFlow ingestion path and must not be used to bypass Facebook access controls or anti-automation measures.

## Core research rule

A useful research record must answer five things:

1. **What question are we answering?**
2. **What does MoneyFlow already know or implement?**
3. **What evidence did we inspect?**
4. **What applies, what does not, and with what confidence?**
5. **What should be tested or decided next?**

Research quality is measured by decision value and reproducibility, not by document length or source count.
