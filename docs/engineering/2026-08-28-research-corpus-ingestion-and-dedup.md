# Research corpus ingestion, deduplication, and lineage — 2026-08-28

- **Status:** active
- **Date:** 2026-08-28
- **Area:** research engineering / data integrity / privacy / retrieval
- **Decision boundary:** governs how research artifacts are normalized and interpreted inside the research repository. It does not authorize MoneyFlow runtime implementation.

## Bounded question

How should MoneyFlow Research ingest a growing set of overlapping ZIP exports without inflating evidence, losing provenance, leaking PII, or repeatedly reprocessing the whole corpus?

## Current state

The current project-intelligence snapshot contains:

- 785 canonical posts;
- 13,671 canonical comments;
- 14,456 searchable analysis records;
- 8 registered bundle observations in the current manifest;
- 27 adjudicated core-PFM posts / 1,959 core-PFM comments;
- 182 strong financial/user-evidence comments.

The persisted runtime index is SQLite with FTS5. Canonical/export records remain auditable JSON/JSONL artifacts in the local processing bundle, but raw copyrighted source dumps and PII-bearing corpora must not be committed to this Git repository.

## Ingestion contract

### 1. Fingerprint bundles before reading them as new evidence

Use SHA-256 of the bundle bytes as the bundle identity. Filenames are metadata, not identity.

- same filename + different SHA => different bundle versions;
- different filename + same SHA => same ingested bundle;
- previously ingested SHA => record/skip as an already-seen observation.

This prevents historical version collisions such as derived exports reusing the same filename with different contents.

### 2. Detect artifact role before canonicalization

Distinguish at least:

- raw/source acquisition bundle;
- structured research export with stable source identities;
- processed/normalized derivative;
- audit/recode/annotation layer;
- master snapshot;
- unknown/quarantined artifact.

Derived reports and recodes do not increase canonical post/comment counts. A structured research export may add unseen stable source identities when its provenance is explicitly marked processed/unverified rather than raw.

### 3. Stable source identity comes before text similarity

For posts prefer:

1. platform + source post ID;
2. canonical URL;
3. normalized exact-content hash;
4. fuzzy candidate generation.

For comments prefer a platform comment ID when available. When unavailable, use parent post identity + normalized author + normalized text + occurrence rank so repeated low-information comments are not accidentally collapsed.

### 4. Exact or semantic similarity does not erase independent evidence

Two independent users saying similar things are two evidence units. Text similarity is used to identify duplicate observations, repost families, or topical clusters — not to collapse independent people into one record.

A repeated crawl of the same source identity should produce another observation, not another canonical record.

A new source post with identical text should remain a distinct source identity and may be linked into an exact-content family.

### 5. Near-duplicate detection is candidate-only

Current fuzzy detection uses a MinHash + LSH candidate stage followed by similarity verification. Fuzzy candidates are review artifacts, not automatic deletions.

Semantic embeddings, when introduced, must remain candidate/cluster assistance unless an explicit reviewed identity rule proves the records are the same source observation.

### 6. Keep raw provenance; sanitize canonical/search text

Do not delete provenance merely because a record is duplicate, derived, low-information, or privacy-sanitized. Preserve lineage and observation metadata while ensuring canonical/searchable text does not retain literal secrets or personal contact data.

Current sanitization covers email, phone-like values, and secret/credential patterns. Analysis text additionally removes recurring Facebook UI artefacts such as `· Theo dõi` and malformed presentation prefixes where doing so does not alter the underlying evidence semantics.

SQLite should be rebuilt/vacuumed after privacy corrections when needed so redacted literals are not retained in free pages.

### 7. Missing comments are unknown, not zero

Post-only community catalog records use `commentCoverage=not_collected`. They may support project/market discovery but cannot increase comment-level user-demand counts.

Do not infer that a source post has zero real comments merely because the export lacks comments.

### 8. Analyze the delta, not the whole corpus

Each ingestion run should produce a delta containing at minimum:

- new canonical posts;
- new canonical comments;
- existing observations;
- variants/reconciliation matches;
- quarantined items;
- bundle role and fingerprint.

Only genuinely new records should enter expensive evidence coding or deep analysis. Existing canonical records should keep prior adjudication unless new evidence requires explicit review.

## Project-intelligence routing

Financial evidence coding and project-wide knowledge routing are separate lanes.

A record may be useful for engineering, AI/ML, document intelligence, UX, security, growth, operations, tooling, or research method even when it is not direct personal-finance user evidence.

Machine routing uses weighted Unicode-boundary-aware anchors and source priors for retrieval/coverage only. Routing counts are not market prevalence and do not replace manual claim adjudication.

## Validation gates

A releasable corpus state should verify:

- canonical post keys unique;
- canonical comment keys unique;
- no orphan comments;
- bundle fingerprint registry consistent;
- source lineage references resolve or are explicitly marked unresolved;
- SQLite `PRAGMA integrity_check = ok`;
- zero SQLite foreign-key violations;
- re-ingesting the same bundle yields `+0/+0` canonical delta;
- no literal email/phone/credential patterns remain in canonical/search text;
- FTS/index record counts agree with canonical counts;
- packaged ZIP/artifact integrity is clean.

## Why this matters for MoneyFlow research

Without these rules, a large corpus can become less trustworthy as it grows: the same Facebook source can be counted multiple times, annotation exports can masquerade as new evidence, post-only data can look like negative evidence, and text similarity can erase repeated independent complaints.

The goal is not maximum row count. The goal is a corpus where every durable claim can be traced to stable source identities, independent evidence units, and an explicit confidence/coverage boundary.

## Repository hygiene

This Git repository should store durable summaries, methodology, decision records, schema/contracts, and reusable scripts when appropriate. It should not store raw copyrighted community dumps, secrets, private financial data, or PII-bearing full corpora.

The large local corpus snapshot is an analysis artifact, not the public repository's durable evidence format.

## Refresh triggers

Review this contract when:

- a new source platform has different identity semantics;
- comment IDs become available where occurrence-based fallback is currently used;
- semantic/embedding dedup is introduced;
- the corpus reaches a scale that requires a different index/storage architecture;
- privacy findings reveal a new class of leakage;
- ingestion produces non-idempotent deltas or unexplained lineage collisions.
