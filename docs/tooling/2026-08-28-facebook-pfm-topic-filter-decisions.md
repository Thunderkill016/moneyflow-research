# Facebook PFM topic filter decision semantics

Date: 2026-08-28

## Purpose

The topic preflight filter is a cost-control and review-routing layer, not product truth and not a market-relevance classifier. Its highest-cost error is a false negative that prevents a relevant Facebook thread from ever reaching comment collection.

The filter therefore uses an explicit abstention path:

- `COLLECT`: strong positive topic evidence.
- `REVIEW-COLLECT`: partial or insufficient evidence; still collect comments so uncertain posts are not silently lost.
- `REUSE`: an already strict-complete source is reused from the persistent corpus instead of scraping again.
- `HARD-REJECT`: only clear negative-domain evidence with no strong PFM signal.

`out-of-topic` is reserved for `HARD-REJECT`. A low score by itself is not enough to exclude a post.

## Hard-reject gate

A post can be hard-rejected only when all of these hold:

1. no exact query match;
2. no strong positive PFM anchor;
3. at least one strong negative anchor;
4. total negative magnitude reaches `hardRejectMinNegativeScore` (default 8);
5. positive evidence is below the adjacent threshold.

The full classification result persists:

- `decision`, `reason`;
- `positiveScore`, `negativeScore`;
- `strongHits`, `strongNegativeHits`;
- `matchedPositive`, `matchedNegative`;
- thresholds used.

This makes later review explainable without depending on transient terminal logs.

## Regression against the first audited corpus

Source run: `2026-08-27T19-01-01-462Z`, query `quản lý chi tiêu`, 69 collected posts.

With the current corpus-derived anchors and new abstention semantics:

- in-topic: 21
- adjacent / review-collect: 13
- ambiguous / review-collect: 28
- hard-reject: 7
- retained for comment collection/reuse: 62
- audited core PFM threads missed: 0 / 13

The seven hard rejects were dominated by clear unrelated domains such as sales/POS/inventory, cloud gaming, and CV/AI-web content. This is a regression check, not an estimate of Facebook-wide precision or recall.

## Research basis

This design follows the retrieval priority of preserving recall when the downstream research can review extra candidates. Stanford IR notes that relevance feedback/query expansion is particularly useful where recall matters and that query expansion can reduce precision when terms are ambiguous. The filter therefore avoids treating uncertainty as non-relevance.

Selective-classification/reject-option literature similarly distinguishes uncertain/ambiguous cases from confident decisions. Here the safe analogue is to abstain from exclusion: uncertain posts are routed to `REVIEW-COLLECT`, while only clear negative evidence is excluded.

## Next live gate

Before resuming broad query coverage, validate a bounded mixed sample in the authenticated Facebook UI:

- obvious PFM posts -> `COLLECT` or `REVIEW-COLLECT`;
- known corpus hits -> `REUSE`;
- clear unrelated posts -> `HARD-REJECT`;
- uncertain posts -> `REVIEW-COLLECT`, never silent exclusion.

Do not tune thresholds from one or two anecdotes. Record false-positive/false-negative examples and update the corpus-derived rule set only from reviewed batches.
