# Facebook PFM filter live validation gate

Use this only after the topic-filter abstention change is on the collector branch.

## Goal

Verify the decision semantics against the authenticated Facebook UI before broad query coverage resumes.

## Required sample

Use a bounded mixed sample containing:

- at least 3 obvious PFM posts from the audited corpus;
- at least 3 obvious unrelated posts (sales/POS, cloud gaming, CV/AI-web are known examples);
- at least 3 uncertain/adjacent posts;
- at least 3 already strict-complete corpus posts that should be reused.

Do not cherry-pick only examples that pass.

## Expected decisions

- strong PFM evidence -> `COLLECT`;
- uncertain or partial evidence -> `REVIEW-COLLECT` and comments remain eligible;
- existing strict-complete source -> `REUSE` and no Facebook comment re-scrape;
- clear negative-domain evidence with no strong PFM signal -> `HARD-REJECT`.

A low score alone must never produce `HARD-REJECT`.

## Evidence to report per post

- post id and canonical/final URL;
- visible one-line content description;
- decision/classification/reason;
- positiveScore/negativeScore;
- matchedPositive/matchedNegative;
- preflight source (`browser` or `corpus-body-cache`);
- whether comments were fetched, reused, or not fetched;
- owner-visible judgment: correct / false-positive / false-negative / uncertain.

If any visible relevant post is `HARD-REJECT`, stop and report it as a blocker. Do not continue the 35-query coverage run.
