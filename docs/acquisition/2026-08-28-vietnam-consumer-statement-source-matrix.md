# Vietnam consumer statement source matrix — 2026-08-28

- **Status:** active research baseline; fixture verification still required
- **Question:** which consumer bank-history sources are real enough to benchmark against MoneyFlow's current parser before selecting the next acquisition slice?
- **Product baseline:** `moneyflow@133fa462d3cd5f90b1f70cccb179547815c2ba2d`
- **Privacy rule:** no personal statement belongs in Git; future test fixtures must preserve structure while replacing names, account numbers, balances, descriptions and identifiers.

## Why this matrix exists

The community corpus ranks capture/maintenance burden above feature breadth. Current MoneyFlow already makes manual Quick Capture close to amount-first/default-driven entry, while its file pipeline is broader in UI than in proven real-source compatibility.

This matrix deliberately separates:

1. **officially established source behavior**;
2. **current MoneyFlow parser facts**;
3. **hypotheses requiring a sanitized real-format fixture**.

A bank having an export button does not mean MoneyFlow parses that export correctly.

## Current MoneyFlow parser baseline

### Structured CSV / Excel

Current shared parser extracts a compact candidate model centered on:

- transaction date;
- amount or debit/credit;
- description → merchant/note;
- inferred income/expense/transfer kind;
- confidence/uncertainty.

Important current constraints:

- XLS/XLSX reads one sheet and then uses the same matrix heuristics as CSV;
- the first meaningful matrix row is treated as the header candidate;
- aliases cover common Vietnamese/English date, amount, debit/credit and description labels;
- stable bank reference/transaction IDs are **not** a first-class parsed output;
- account/source metadata and running balance are **not** first-class parsed output;
- unknown kind can fall back to expense with uncertainty rather than establishing source truth.

### PDF

Current product UI explicitly describes PDF as text-layer support for a narrow `MF DEMO BANK` template. General Vietnamese statement PDFs and scanned/image PDFs are not proven product capabilities.

## Consumer source families with official evidence

| Bank / channel | Officially established behavior | Known useful fields from official material | Current MoneyFlow compatibility | What remains unknown before implementation |
|---|---|---|---|---|
| **Vietcombank — VCB Digibank consumer web** | User can search account transaction history and **export Excel**. Official history UI shows transaction date/content, signed amount and a reference number. | date; content/description; signed amount; reference number visible in UI | **Unverified / likely partial.** Generic aliases plausibly cover date/content/amount, but exact exported headers/layout are unknown and reference identity would be dropped by current parsed-row shape. | exact Excel header row; account metadata/preamble; whether reference is exported; debit/credit representation; running balance; multiple tables/sheets |
| **ACB — ACB ONE consumer** | Official consumer guide states transaction listing can be **exported to Excel**. | exportability confirmed | **Unverified.** No safe claim about headers or current parse success without a fixture. | exact headers/layout; signed vs debit/credit; reference ID; account metadata; preamble; date formats |
| **VietinBank — iPay consumer web** | Official FAQ states iPay Web can produce a **PDF statement or Excel transaction-data file**; account history can be searched up to one year. FAQ also notes some older transactions may lack sender/receiver detail. | history window; PDF/Excel availability; counterparty detail can be incomplete for some historical data | **Excel unverified; PDF expected unsupported unless it accidentally matches the narrow demo parser, which must not be assumed.** Missing counterparty detail is a source limitation, not something MF should invent. | exact Excel/PDF schema; reference identity; signed/debit-credit fields; account metadata; whether PDF is text-layer; how often counterparty fields are absent |
| **Techcombank Mobile — consumer** | Official Techcombank consumer material confirms transaction-history inspection and **statement download** in the mobile app. | source family and user workflow exist | **Not benchmarkable yet** because current official page does not establish a reusable export schema/format. | file format; fields; schema; whether export can be shared directly from the app; reference/account metadata |

## Market-context source, not a parser source

NAPAS reported that by October 2025 nearly **90 million mobile-banking accounts** were using bank apps to scan VietQR and that VietQR transfers reached **3.6 billion transactions** in the first ten months of 2025.

Use this only to justify investigating bank-app history as a high-volume digital source family. It does **not** prove:

- MoneyFlow addressable users;
- PFM demand prevalence;
- that every VietQR transaction should be imported;
- that file export is the preferred workflow;
- that provider sync is justified.

## Failure hypotheses derived from current code

These are test candidates, not findings about real bank files.

### H1 — table/header discovery

If a real export contains title/account/date-range preamble rows before the transaction table, current `first meaningful row = header candidate` behavior may mis-map the file.

**Evidence needed:** sanitized fixture preserving the preamble and transaction-table start.

### H2 — reference identity loss

VCB's official history UI visibly exposes a reference number. Current parsed statement rows have no first-class reference/source-external-ID field.

**Potential consequence:** even when the bank provides stronger source identity, a generic parse can throw it away before candidate/reconciliation logic can use it.

**Evidence needed:** prove the reference number exists in the exported file, not only the UI.

### H3 — account/source metadata loss

Bank exports may contain account number/name/currency in preamble metadata rather than each row. Current generic parsed-row output does not preserve that metadata.

**Potential consequence:** user must reselect account or the import cannot prove which account a row belongs to.

**Evidence needed:** real-format fixture from a consumer export.

### H4 — PDF is a false breadth signal

The upload UI advertises PDF acceptance, but runtime text says only the demo text-layer template is supported and OCR is absent.

**Decision implication:** do not count `PDF accepted` as real consumer-bank coverage in product planning.

## Fixture protocol

For each bank family, create a synthetic fixture only after observing a legitimate user-obtainable export privately.

Preserve:

- row/column ordering;
- merged/preamble/header structure;
- date formats;
- number formatting;
- debit/credit/sign conventions;
- blank cells;
- reference/account metadata placement;
- multi-sheet/page structure where relevant.

Replace:

- names;
- account/card numbers;
- transaction descriptions containing personal data;
- balances;
- reference values themselves while preserving shape;
- any address/email/phone or other identifiers.

Do not derive a source adapter from screenshots of the banking UI when the exported file structure is unknown.

## Benchmark metrics

A fixture-backed parser run should report:

| Metric | Why it matters |
|---|---|
| rows detected / expected | basic acquisition coverage |
| exact amount | financial truth |
| exact transaction date | period/reconciliation truth |
| correct debit/credit or kind | prevents income/expense corruption |
| description/payee preservation | correction/category workflow |
| reference identity preserved | duplicate/replay/source truth |
| account/source identified | prevents wrong-account posting |
| rows needing manual correction | actual maintenance burden |
| duplicate/transfer false positives | trust cost |
| user actions from file selection to trusted candidate set | actual capture reduction |

## Current decision

The next implementation slice should **not** be chosen from this matrix yet because exact consumer export schemas remain unverified.

The next research action is to obtain privacy-safe structural fixtures for at least VCB, ACB and VietinBank (or document why one cannot be obtained), run the current parser against them, and rank actual failures. Only then select the smallest deterministic parser/adapter change.

Until then:

- #511/#522 is review-safety work, not capture-reduction evidence;
- manual Quick Capture should not be redesigned without observed remaining friction;
- SMS stays fallback;
- OCR stays behind a proven structured-data gap;
- provider/native sync stays later.

## Source notes

- Vietcombank VCB Digibank official user guide: consumer history search + Excel export; transaction UI includes date/content/signed amount/reference.
- ACB ONE official consumer guide: transaction listing Excel export.
- VietinBank official iPay FAQ (2025-05-05): consumer web history, PDF statement and Excel detailed transaction data; warns that some older rows can lack sender/receiver fields.
- Techcombank official personal-finance page: consumer Mobile supports transaction-history inspection and statement download; exact export schema not established by that page.
- NAPAS 2025 member/payment reporting: mobile-banking/VietQR scale context only.
