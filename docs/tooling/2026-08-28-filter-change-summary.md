# Topic-filter change summary

The broad primary-query coverage run is paused until the bounded live filter gate passes.

Current semantics:

- `COLLECT`: strong positive PFM evidence.
- `REVIEW-COLLECT`: uncertain or partial evidence; comments remain eligible.
- `REUSE`: strict-complete corpus source; no re-scrape.
- `HARD-REJECT`: clear negative-domain evidence plus no strong PFM signal.

A low relevance score alone no longer excludes a post. Full decision evidence is persisted in the classification object (`reason`, positive/negative scores, matched positive/negative terms).

Offline regression against the 69-post audited corpus retained all 13 known core PFM threads and produced only 7 hard rejects, all inspected as clearly unrelated domains.
