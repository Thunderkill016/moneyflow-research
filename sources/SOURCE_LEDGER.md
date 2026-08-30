# MoneyFlow Research — source ledger

**Purpose:** reusable source index. This is not a bibliography of everything ever read. Add a source only when it has repeated decision value.

## Source evaluation fields

For each source record:

- **Type:** official / standard / primary repository / paper / practitioner / community / secondary.
- **Use:** what research questions it can support.
- **Limits:** what must not be inferred from it.
- **Refresh trigger:** when it should be rechecked.

## MoneyFlow product truth

| Source | Type | Use | Limits / refresh |
|---|---|---|---|
| https://github.com/Thunderkill016/moneyflow | primary product repository | Current code, tests, architecture, product policy, execution authority | Always verify current branch/main; this research repo never overrides it |

## Personal-finance / ledger references

| Source | Type | Use | Limits / refresh |
|---|---|---|---|
| https://github.com/actualbudget/actual | primary OSS repository | Import IDs, dedup/reconciliation, rules, transfers, pending/cleared, budgeting | Product/storage architecture differs; verify current docs/license before reuse |
| https://github.com/firefly-iii/firefly-iii | primary OSS repository | Ledger semantics, transfers, recurring, rules, importer, reports | AGPL; accounting-heavy scope; primarily concepts and behavior |
| https://github.com/ledger/ledger | primary OSS repository | Mature double-entry/reporting invariants | CLI/accounting model is not a MoneyFlow UX requirement |
| https://github.com/blnkfinance/blnk | primary OSS repository | Ledger, balances, inflight transactions, reconciliation concepts | Service architecture should not be adopted without demonstrated need |
| https://github.com/flash-oss/medici | primary OSS repository | Balanced journals, void/reversal patterns | MongoDB architecture does not fit MoneyFlow by default |

## Provider / acquisition references

| Source | Type | Use | Limits / refresh |
|---|---|---|---|
| https://github.com/OpenBankProject/OBP-API | primary OSS repository | Provider-neutral account/transaction/consent API boundaries | EU/open-banking assumptions do not establish Vietnam availability/economics |
| https://developer.android.com/reference/android/service/notification/NotificationListenerService | official | Android notification acquisition capability | Recheck with target Android version and distribution policy |
| https://support.google.com/googleplay/android-developer/answer/10208820 | official | Google Play SMS/Call Log sensitive-permission policy | Policy can change; refresh before native Android scope decisions |

## Security / privacy references

| Source | Type | Use | Limits / refresh |
|---|---|---|---|
| https://cheatsheetseries.owasp.org/ | standard/practitioner reference | Auth, sessions, secrets, access control, logging, privacy implementation guidance | Apply to actual MoneyFlow architecture, not as a checklist detached from threat model |
| https://owasp.org/www-project-application-security-verification-standard/ | standard | Security acceptance and verification framing | Select relevant controls; does not replace provider/runtime evidence |
| https://supabase.com/docs/guides/database/postgres/row-level-security | official | PostgreSQL/Supabase RLS behavior and patterns | MoneyFlow policies/tests remain implementation truth |

## Research/documentation method

| Source | Type | Use | Limits / refresh |
|---|---|---|---|
| https://diataxis.fr/ | primary methodology | Separate tutorial/how-to/reference/explanation needs; improve knowledge navigation | Do not force taxonomy when research records need evidence-centric structure |
| https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record | official practitioner guidance | Decision context, alternatives, consequences, confidence/status | Research decisions here do not replace MoneyFlow product/architecture authority |

## Research collection tooling

| Source | Type | Use | Limits / refresh |
|---|---|---|---|
| https://playwright.dev/docs/locators | official | Resilient browser-research locator strategy; prefer user-facing role/text contracts over brittle DOM chains | Does not guarantee stability/completeness on third-party sites; refresh on major Playwright changes |
| https://www.npmjs.com/package/playwright | primary package registry | Current Playwright package/version/license check for research tooling | Package availability does not authorize automation against a specific service; refresh before dependency upgrades |
| https://www.facebook.com/help/463983701520800 | official platform help | Meta definition of scraping and anti-scraping/rate/data-limit behavior; informs collection boundaries | Does not grant scraping permission; refresh when Meta platform/terms policy changes |

## Adding a source

A reusable source entry should answer:

1. What repeated MoneyFlow question does this source help answer?
2. Why is this source trustworthy enough for that question?
3. What common overreach must readers avoid?
4. What event makes the source stale?

Do not add a source just because it was cited once.
