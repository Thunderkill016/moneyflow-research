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
| https://actualbudget.org/docs/transactions/importing/ | primary product documentation | Current import matching, stable imported IDs, fallback matching, deleted/reimport behavior | Matching thresholds and automatic behavior are Actual-specific; refresh when import docs change |
| https://actualbudget.org/docs/transactions/merging/ | primary product documentation | Explicit duplicate merge behavior and precedence between synced/file/manual transactions | Do not copy merge semantics into MoneyFlow without a dedicated runtime spec |
| https://github.com/firefly-iii/firefly-iii | primary OSS repository | Ledger semantics, transfers, recurring, rules, importer, reports | AGPL; accounting-heavy scope; primarily concepts and behavior |
| https://docs.firefly-iii.org/references/data-importer/duplicate-detection/ | primary product documentation | Identifier-vs-content duplicate detection, source-data hashing and import failure modes | Firefly's importer/runtime split and hashing semantics are not MoneyFlow requirements |
| https://support.ynab.com/en_us/approving-and-matching-transactions-a-guide-ByYNZaQ1i | primary commercial product documentation | Imported transaction review, matching, rejection/correction and bulk-review patterns | YNAB provider stack and UX do not establish Vietnam provider availability or MoneyFlow requirements |
| https://github.com/ledger/ledger | primary OSS repository | Mature double-entry/reporting invariants | CLI/accounting model is not a MoneyFlow UX requirement |
| https://github.com/blnkfinance/blnk | primary OSS repository | Ledger, balances, inflight transactions, reconciliation concepts | Service architecture should not be adopted without demonstrated need |
| https://github.com/flash-oss/medici | primary OSS repository | Balanced journals, void/reversal patterns | MongoDB architecture does not fit MoneyFlow by default |

## Provider / acquisition references

| Source | Type | Use | Limits / refresh |
|---|---|---|---|
| https://github.com/OpenBankProject/OBP-API | primary OSS repository | Provider-neutral account/transaction/consent API boundaries | EU/open-banking assumptions do not establish Vietnam availability/economics |
| https://developer.android.com/reference/android/service/notification/NotificationListenerService | official | Android notification acquisition capability | Recheck with target Android version and distribution policy |
| https://support.google.com/googleplay/android-developer/answer/10208820 | official | Google Play SMS/Call Log sensitive-permission policy | Policy can change; refresh before native Android scope decisions |
| https://developer.chrome.com/docs/capabilities/web-apis/web-share-target | official | PWA receipt of user-shared text/files, MIME/extension declarations and multipart POST behavior | Requires installed PWA/user-agent support; incoming data remains untrusted; refresh with platform support changes |
| https://digibankm5.vietcombank.com.vn/get_file/ibomni/html/hdsdib/hdsd.pdf | official bank documentation | Consumer VCB Digibank transaction-history flow; confirms Excel export and exposes date/content/signed amount/reference information in the history UI | Guide/UI does not prove exact exported Excel schema; use a privacy-safe fixture before coding an adapter; refresh when Digibank export changes |
| https://online.acb.com.vn/news/images/hdsd%20acbo%20khcn.pdf | official bank documentation | Consumer ACB ONE guide confirming transaction listing can be exported to Excel | Exact exported headers/layout are not established by the guide snippet; fixture confirmation required before implementation |
| https://contact.vietinbank.vn/blog/obj_faq_42767083/fld_faqid_63024046/FAQ42 | official bank documentation | Consumer VietinBank iPay history; web can output PDF statements or Excel transaction data, useful as a third consumer source family | Does not establish file schema or guarantee all transactions contain sender/receiver identity; official FAQ notes some historical rows lack fields |
| https://napas.com.vn/cong-dong-ngan-hang-va-trung-gian-thanh-toan-cam-ket-dong-hanh-thuc-day-thanh-toan-noi-dia-va-xuyen-bien-gioi-182251119163215242.htm | official payment-network documentation | Current scale of mobile-banking/VietQR usage; supports bank-app history as an important acquisition source family to investigate | Network/account/transaction counts are not MoneyFlow adoption forecasts or PFM demand prevalence |
| https://techcombank.com/thong-tin/blog/phan-mem-lap-ke-hoach-tai-chinh-ca-nhan | official bank documentation | Consumer Techcombank Mobile supports transaction-history inspection and statement download | Page does not establish exported file format/schema; do not infer CSV/XLSX consumer parity from business products |
| https://techcombank.com/content/dam/techcombank/cdb-app/documents/pre-login/2-2-user-guide-techcombank-business-web-20251031.pdf | official bank documentation | Example Vietnam business-bank transaction CSV export and statement download behavior | Business banking only; does not prove consumer availability or universal schemas; refresh when guide changes |
| https://www.pvcombank.com.vn/static/2025/T8/HDSD_PVConnect%20Biz_MB_Ver1.8.2025.pdf | official bank documentation | Example Vietnam bank statement export to Excel/PDF | Business banking only; not market coverage evidence |
| https://github.com/opendatalab/MinerU | primary OSS repository | PDF/image/Office document parsing, OCR/layout/table extraction, local/API deployment patterns | Does not prove MoneyFlow field accuracy, latency, privacy fit or license suitability; benchmark and review exact current license before adoption |

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

## Adding a source

A reusable source entry should answer:

1. What repeated MoneyFlow question does this source help answer?
2. Why is this source trustworthy enough for that question?
3. What common overreach must readers avoid?
4. What event makes the source stale?

Do not add a source just because it was cited once.
