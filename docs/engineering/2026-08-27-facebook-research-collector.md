# Facebook browser-assisted research collector

- **Status:** active experiment/tooling
- **Date:** 2026-08-27
- **Area:** engineering / product research acquisition
- **MoneyFlow baseline:** master program #432 prioritizes low-maintenance acquisition and exception-first review while preserving source provenance and trustworthy ledger semantics.
- **Decision boundary:** this record justifies a bounded research-collection tool only. It does not authorize Facebook data ingestion into the MoneyFlow product or claim permission to scrape Facebook at scale.

## Bounded question

Can MoneyFlow research reduce manual copy/paste when reviewing relevant Facebook community discussions while keeping source selection explainable, collection bounded, and raw evidence out of the public research repository?

## Current baseline

Two Build in Public VN discussions were manually copied into the research process on 2026-08-27. They produced useful qualitative evidence about manual-entry fatigue, account/source identity, correction flows and sync reliability, but the copy/paste workflow does not scale.

The research repository already prohibits secrets, private financial data and copyrighted source dumps. Community discussions are evidence for pain/failure modes, not implementation authority.

## Sources

| Source | What it establishes | What it does not establish |
|---|---|---|
| Playwright locators: https://playwright.dev/docs/locators | Playwright recommends user-facing locators such as role/text and warns that long CSS/XPath chains are brittle as DOM structure changes. | Does not make Facebook DOM stable or guarantee comment completeness. |
| Playwright npm package: https://www.npmjs.com/package/playwright | As reviewed 2026-08-27, current stable package is 1.62.1 and supports browser automation scripts. | Package availability does not authorize collection from any particular site. |
| Meta Help — data scraping: https://www.facebook.com/help/463983701520800 | Meta defines scraping as automated collection and documents rate/data limits, request blocking and enforcement against unauthorized scraping. | The help page does not grant this project permission to scrape content; applicable terms and permissions still matter. |
| Current MoneyFlow research/program evidence | Research should lower repeated manual work but preserve provenance, uncertainty and verification boundaries. | Product program does not authorize Facebook platform automation. |

## Facts

- A headed persistent browser profile can keep a local authenticated session without putting credentials into source code.
- Facebook search result cards expose post/permalink links that can be canonicalized by group/post ID before opening every post.
- A cheap candidate pass can score previews before the more expensive comment-expansion pass.
- Facebook UI/DOM is dynamic and comment visibility can depend on ranking, privacy, account state, experiments and lazy loading.
- Automated collection can trigger Meta technical controls; a research tool must not attempt to evade them.

## Inferences

A two-stage collector is a better fit than copying every result manually:

```text
search -> candidate URL/preview -> deterministic relevance score
       -> relevant permalink only -> visible comment expansion
       -> local raw snapshot -> normalized JSON/Markdown
```

Deterministic relevance rules are preferable for v1 because they make selection auditable and avoid sending Facebook content to another external AI service during collection. Semantic/LLM analysis can happen later on the locally reviewed dataset.

## Risks and controls

| Risk | Control in v1 |
|---|---|
| Facebook policy / anti-automation | Headed normal browser, explicit pacing/limits, no stealth plugins, no CAPTCHA/checkpoint/rate-limit bypass; stop when blocked. |
| Credentials/session leakage | Persistent profile is local and gitignored; tool never asks the user to paste Facebook credentials. |
| Copyright/privacy leakage into public repo | `profile/`, `output/`, `config.json` are gitignored; durable repo records contain summaries/links rather than source dumps. |
| Brittle selectors | Prefer role/text locators and generic `role=article` structure; avoid generated CSS class names and deep XPath chains. |
| False claim of completeness | Every normalized record marks extraction as best-effort and explicitly notes ranking/privacy/lazy-loading limits. |
| Wrong post selection | Store relevance score and matched rules; preserve discovery query and canonical URL. |
| Parser mistakes | Keep a bounded local raw subtree snapshot beside normalized output for later checking. |

## Recommendation

**Experiment.** Use the collector for small, bounded research runs where the user is already authorized to view the content. Do not turn it into a high-throughput crawler or a MoneyFlow production ingestion source without a separate platform/legal/privacy review.

## Verification

Before relying on collector output for a research conclusion:

1. run a 3-post sample with `--limit 3`;
2. compare the normalized post text and comment hierarchy against the visible Facebook page;
3. record missed/duplicated comment patterns;
4. verify URL canonicalization dedupes slug/numeric group variants;
5. confirm no browser profile/output files are staged for commit;
6. only then expand to a larger bounded sample.

Automated unit tests cover URL canonicalization, Vietnamese relevance scoring, UI-noise cleanup and deterministic comment fingerprints. Live Facebook completeness cannot be asserted by unit tests.

## Confidence

- **High** that the two-stage workflow removes most manual copy/paste work.
- **Medium** that generic role/text extraction will survive ordinary UI changes better than generated CSS selectors.
- **Low** that any browser collector can guarantee all Facebook comments across ranking/privacy/UI variants.

## Invalidation / refresh triggers

Revisit when Facebook materially changes group search/permalink/comment UI, Meta terms/policies change, Playwright locator APIs change, collection starts receiving blocks/checkpoints, or a supported official API/export becomes a better fit.
