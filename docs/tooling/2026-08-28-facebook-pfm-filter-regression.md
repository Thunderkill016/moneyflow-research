# Facebook PFM filter regression — first audited corpus

Source run: `2026-08-27T19-01-01-462Z`

The new abstention semantics were replayed offline against all 69 normalized post bodies using the current corpus-derived PFM anchors/negative anchors.

Result:

- `in-topic`: 21
- `adjacent` / `REVIEW-COLLECT`: 13
- `ambiguous` / `REVIEW-COLLECT`: 28
- `out-of-topic` / `HARD-REJECT`: 7
- retained for collection/reuse: 62
- audited PFM core false negatives: 0 / 13

Audited core post IDs used as a regression recall set:

- `2138136333640594`
- `2186835792103981`
- `2031092667678295`
- `1808257543295143`
- `2136368187150742`
- `1718330252287873`
- `2206978050089755`
- `2210051236449103`
- `2186842225436671`
- `1879330999521130`
- `1876670169787213`
- `2234480620672831`
- `2177293349724892`

The seven hard rejects were inspected and were dominated by clear unrelated domains including sales/POS/inventory, cloud gaming, CV tooling, and AI-web operations. This regression protects recall on the known corpus; it does not prove Facebook-wide recall.
