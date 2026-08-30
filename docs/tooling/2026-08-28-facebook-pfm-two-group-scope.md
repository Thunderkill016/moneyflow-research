# Facebook PFM research scope: Build in Public VN + J2TEAM Community

Date: 2026-08-28

## Decision

Default Facebook discovery for the PFM research collector is intentionally focused on two communities:

1. Build in Public VN — `1569314343856132`
2. J2TEAM Community — `j2team.community`

`discovery.scope` defaults to `group`, while `config.groups[]` supplies the ordered target list. Global Facebook Posts search remains available only as an optional experimental surface, not the default research path.

## Why

The original Build in Public VN corpus produced useful PFM product evidence but also substantial noise. Global Posts search added another layer of unstable DOM behavior and did not yet demonstrate enough marginal research value to justify the complexity. J2TEAM appeared directly in live global-search evidence for the same PFM query and is a second large Vietnamese technical community likely to contribute additional user/building perspectives.

The goal is therefore practical, bounded evidence quality rather than pretending to cover all of Facebook.

## Invariants

- Run the same query family against both configured groups.
- Preserve the actual group/post identity from each source URL.
- Do not rewrite a J2TEAM post to the Build in Public group or vice versa.
- Reuse strict-complete corpus records instead of re-expanding comments.
- Existing assessor judgments under `personal-expense-management` persist across queries.
- New candidates must be reviewed from the full post body before comments are collected.
- Different group/post identities remain separate evidence even when content is identical or near-duplicate; near-duplicate logic may flag them but must not auto-drop them.
- No raw Facebook data, browser profile, credentials, or session material is committed.

## Acceptance for focused discovery

For a bounded query such as `quản lý chi tiêu`:

- diagnostics contain one run for Build in Public VN and one for J2TEAM Community;
- each diagnostic search URL is group-scoped;
- `discoveryTargets` lists exactly the two configured groups;
- every candidate's `groupIdentifier` matches the group searched for that diagnostic;
- candidate provenance records `discoveryScopeGroupId` and `discoveryScopeGroupName`;
- previously judged/cached posts reuse corpus state instead of being reassessed or re-scraped;
- only newly discovered posts enter the review queue.

Do not reopen broad global discovery or a 35-query sweep until this two-group path is verified live and its marginal yield is measured.
