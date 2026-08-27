# Facebook PFM query coverage plan — corpus-derived v1

- **Status:** active tooling input
- **Date:** 2026-08-28
- **Source corpus:** local run `2026-08-27T19-01-01-462Z`
- **Scope:** maximize recall for Vietnamese personal-finance / expense-management research in the Facebook UI that the authenticated research account can legitimately access.
- **Boundary:** this plan cannot prove global Facebook completeness. Acceptance is practical UI coverage under diversified queries + stable discovery + persistent exact-source dedupe.

## Why the query set changed

The first collected run returned 69 collector-complete posts, but full-body audit showed only 13 core PFM threads, 8 adjacent threads and 48 out-of-topic threads. A single query or preview-keyword filter therefore does not represent the information need well enough.

The audited core corpus also uses many different expressions for the same underlying problem. Examples by thread coverage in the 13 core post bodies include:

- `quản lý chi tiêu`: 10/13
- `quản lý tài chính`: 5/13
- `nhập liệu`: 4/13
- `tự động`: 5/13
- `ngân hàng`: 3/13
- `giọng nói`: 3/13
- `Telegram`: 3/13
- `ngôn ngữ tự nhiên`: 3/13

The comment corpus broadens the vocabulary further into statements, e-wallets, multiple accounts/wallets, correction, duplicate handling, transfers, privacy, recurring payments and planning.

This motivates a relevance-feedback style query-expansion plan: use observed relevant documents to broaden lexical and facet coverage, while keeping broad terms attached to a PFM intent so they do not dominate retrieval with unrelated content.

## Query families

### 1. Topic identity

Primary lexical descriptions of the whole problem:

- quản lý chi tiêu
- quản lý thu chi
- tài chính cá nhân
- ghi chép chi tiêu
- theo dõi chi tiêu
- expense tracker
- personal finance

### 2. Maintenance / intervention burden

- nhập liệu chi tiêu
- tự động ghi chi tiêu
- đồng bộ giao dịch ngân hàng
- sao kê ngân hàng chi tiêu
- biến động số dư chi tiêu

Secondary expansions include `nhập tay chi tiêu`, `tự động nhập giao dịch`, `quên nhập chi tiêu`, and `không cần mở app chi tiêu`.

### 3. Financial sources

- giao dịch ngân hàng chi tiêu
- ví điện tử chi tiêu
- MoMo quản lý chi tiêu
- SePay quản lý chi tiêu
- tiền mặt quản lý chi tiêu
- email giao dịch ngân hàng

Secondary expansions include ZaloPay and Apple Pay.

### 4. Capture modalities

- giọng nói quản lý chi tiêu
- OCR chi tiêu
- Telegram quản lý chi tiêu
- Zalo bot quản lý chi tiêu
- ngôn ngữ tự nhiên chi tiêu
- Google Sheet quản lý chi tiêu

Secondary expansions include voice/English wording, receipt scanning, widgets and shortcuts.

### 5. Account / transfer / trust semantics

- nhiều tài khoản quản lý chi tiêu
- nhiều ví quản lý chi tiêu
- duplicate giao dịch chi tiêu
- chuyển tiền giữa ví
- phân loại giao dịch chi tiêu
- bảo mật app chi tiêu

Secondary expansions include source-of-funds wording, transfer transaction, edit/delete and encryption wording.

### 6. Planning / recurring burden

- ngân sách cá nhân
- mục tiêu tiết kiệm
- chi tiêu định kỳ

Secondary expansions include subscriptions, six-jars, assets and reports.

### 7. Comparative / incumbent language

- Money Lover chi tiêu
- MISA thu chi

Secondary expansions include Rolly and Excel. These queries are intended to find comparison, switching, failure and long-term usage discussions, not to treat competitor mentions as positive evidence by themselves.

## Search rules

Do **not** issue generic terms such as `AI`, `app`, `voice`, `bank`, `ngân hàng`, `Telegram`, `MISA`, or `Money Lover` alone for topic collection. These are either too broad or highly polysemous in the observed corpus. Pair them with a PFM intent unless the term itself is sufficiently domain-specific.

Every discovered post still goes through corpus identity/dedupe and full-body topic classification. Query expansion increases retrieval recall; it does not bypass the relevance gate.

## Coverage / saturation contract

For each query, record at least:

- discovered canonical post IDs;
- IDs already present in persistent corpus;
- newly discovered IDs;
- full-body `in-topic / adjacent / ambiguous / out-of-topic` counts;
- newly found `in-topic + adjacent` IDs that no earlier query produced.

Primary queries run first. Secondary queries are then run by family. A family is considered locally saturated only when its remaining expansions repeatedly produce no new relevant canonical IDs after corpus dedupe. Do not infer global Facebook completeness from saturation; this only bounds the accessible search UI under the current account and period.

## Dedupe contract

- same Facebook source/post identity: reuse cached normalized post/comments and only append query provenance;
- URL variants of the same source: canonicalize to one corpus record;
- same/near-same body under different post IDs: flag a content cluster, but do **not** auto-drop because comment communities may differ;
- a post seen under multiple query families must count once in corpus size but retain all query provenance.

## Current implementation

`tools/facebook-research-collector/config.example.json` contains:

- `queryPlan.primaryQueries`: 35 corpus-derived primary queries;
- `queryPlan.secondaryQueries`: 23 long-tail expansions;
- `queries`: currently set to the 35 primary queries so the existing discovery runner can execute them without a new search dependency.

The persistent corpus layer prevents an already strict-complete post from being deeply collected again when another query/topic discovers it.

## Refresh rule

Update this query plan after each audited topic run by promoting terms/facets that occur across multiple independently relevant threads and demoting queries with persistent zero marginal relevant yield. Never promote a term solely because it is frequent in one high-volume comment thread.
