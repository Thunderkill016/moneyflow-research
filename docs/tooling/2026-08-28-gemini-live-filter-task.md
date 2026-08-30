# Gemini runner task — bounded topic-filter live validation

Role: runner/validator only. Do not redesign filters, query plan, corpus schema, dedupe semantics, or collector logic.

Use exact branch head `tooling/facebook-research-collector` at or after `4a0e5c01fe7368e0e1daa53fb82f62dbe309f46b`.

## Steps

1. Pull the exact branch head and run `npm test` inside `tools/facebook-research-collector`.
2. Preserve the local Facebook profile and corpus. Do not commit `profile/`, `corpus/`, `output/`, or `config.json`.
3. Do not resume the 35-query coverage run yet.
4. Run a bounded mixed validation sample using the current query/discovery artifacts or a small live discovery. Include at least:
   - 3 obvious PFM posts;
   - 3 obvious unrelated posts;
   - 3 uncertain/adjacent posts;
   - 3 already strict-complete corpus posts.
5. For every sampled post report from `preflight.json`:
   - post id and final/canonical URL;
   - one-line visible content description;
   - classification + `decision` + `reason`;
   - positiveScore / negativeScore;
   - matchedPositive / matchedNegative;
   - preflight source;
   - whether comments were fetched, reused, or not fetched.
6. Visually compare each decision with the actual Facebook post. Mark each `correct | false-positive | false-negative | uncertain`.
7. If any visibly relevant PFM post is `HARD-REJECT`, stop immediately and report a blocker. Do not continue coverage.
8. Confirm known strict-complete posts are reused from corpus and are not re-scraped.
9. Report test counts and exact head SHA. Do not modify or commit code.

Acceptance: zero observed false-negative hard rejects in the bounded sample, clear unrelated posts can be hard-rejected, uncertain posts are review-collected, known posts are reused.
