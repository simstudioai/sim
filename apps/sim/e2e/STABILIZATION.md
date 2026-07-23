# Settings E2E stabilization record

This record is the non-waivable acceptance crosswalk for the first hosted,
billing-enabled Chromium milestone. It complements the operational runbook in
`README.md`; it does not replace the literal contracts or their assertions.

## Review baseline

- Integration head before Step 7: `1a631d9cd27cb917dbf131f178c934d5cf2250db`
- Reviewed staging reference: `26e4c308887de566144cdedaee223ce1c7f6c050`
- Inventory at that boundary: 194 changed files, 59,367 insertions, and 1,904
  deletions. Generated Drizzle snapshots are classified as generated review
  material; migration SQL, schema declarations, and preflight code remain
  hand-reviewed.
- Current Step 7 source discovers 256 tests: 131 navigation/foundation, 84
  authorization, 13 credentials, 11 workflows, 15 persona contracts, and 2
  isolation tests. The pre-Step-7 baseline was 254; Step 7 adds two foundation
  safety policies for selective trace suppression and auth-screenshot clearing.
- Regenerate the exact inventory instead of copying a stale list:

  ```bash
  git diff --name-status \
    26e4c308887de566144cdedaee223ce1c7f6c050...1a631d9cd27cb917dbf131f178c934d5cf2250db
  ```

The final Step 7 SHA, timings, and gate evidence are recorded in the PR after
the source is frozen. Raw reports, auth states, and secret-bearing artifacts
are never committed.

## Architecture proof

- `playwright.config.ts` fixes Chromium, zero retries, project dependencies, and
  worker budgets. `e2e/scripts/run.ts` is the only test entry point.
- `e2e/support/deployment-profile.ts` gives build, app, realtime, migration,
  seed, auth capture, and Playwright separate allowlisted environments.
- `e2e/support/database.ts` creates and drops only guarded per-run
  `sim_e2e_*` databases. Migrations run before any scenario is seeded.
- `e2e/fixtures` and `e2e/settings/personas.ts` define deterministic users,
  organizations, memberships, subscriptions, workspaces, grants, permission
  groups, and 14 named personas plus an independent isolation twin. Scenario
  validation rejects duplicate organization membership.
- `e2e/scripts/capture-auth-states.ts` signs in through the real Better Auth UI
  and writes mode-0600 storage states. Playwright receives no password,
  database URL, or admin key.
- Same-origin Sim APIs stay real. Stripe and MCP are strict loopback fakes;
  mail uses the production mock-success path with provider credentials absent.
  Browser HTTP(S) egress is allowlisted. Provider log scans are residual-risk
  tripwires, not proof of an OS-level server firewall.
- `e2e/support/leak-canary.ts` scans eligible diagnostics and fails closed.
  Auth/private/home roots are excluded from uploads, and CI uploads only after
  the successful scan marker exists.

## Navigation contract

The explicit datasets in `e2e/settings/navigation/contracts.ts` are independent
of `SETTINGS_SECTION_REGISTRY`: 37 canonical sections, 21 special route cases,
and 11 representative visibility cases.

- `canonical-navigation.spec.ts` iterates every literal account, organization,
  and workspace section, clicks its semantic sidebar item, asserts the exact
  pathname, heading, description, active item, dynamic API response when
  required, and semantic readiness without an error state.
- `persona-visibility.spec.ts` asserts complete visible sets and important
  hidden items for personal, organization, workspace, restricted, and platform
  personas.
- `route-cases.spec.ts` owns account/organization/workspace default redirects,
  aliases, legacy redirects, unavailable states, unknown sections, and direct
  non-member/member outcomes.
- `smoke/unauthenticated.spec.ts` owns all three login redirects.
- `history.spec.ts` owns browser Back, app Back, direct-entry fallback, and
  account/organization return destinations.
- `navigation/contract-integrity.spec.ts` rejects duplicate identities,
  incoherent drivers, and accidental coupling between the scenario and
  acceptance datasets.

No navigation requirement may be deferred. Product route/copy changes require
an explicit product decision and a paired update to the independent contract.

## Authorization and entitlement contract

`e2e/settings/authorization/contracts.ts` owns literal access outcomes and
semantic mutation probes: 47 direct access cases and 31 mutation-control cases.
Its integrity spec requires every declared gate axis.

- Read, write, and admin workspace personas cover view/mutation boundaries for
  Secrets, Custom tools, MCP tools, workflow MCP servers, Recently deleted,
  Teammates, BYOK, API keys, Inbox, Forks, and Custom blocks.
- Permission-group visibility and direct-route cases deny Secrets, API keys,
  Inbox, MCP tools, and Custom tools.
- Organization member cases prove Members visibility without management and
  direct denial of admin-only sections. Admin cases prove eligible controls.
- Lapsed/free and entitled organizations provide negative and positive
  Enterprise gates. Inbox has both locked-upgrade and enabled-Max proof.
- Account and workspace Admin/Mothership have platform-admin positives and
  non-platform direct-route negatives.
- `unsaved-changes.spec.ts` covers Keep editing and Discard changes for sidebar,
  app Back, browser history, and native `beforeunload`. Credential detail tests
  add in-app and popstate guards.

Existing Step 3 proof IDs are referenced rather than rerun; integrity tests
fail if a reference disappears. Every mandatory gate needs allowed and denied
browser proof, including direct URL access.

## Critical workflows

All workflows use the real UI and same-origin production contracts, register
cleanup before mutation, use unique resources, and verify observable API or
database-backed state.

1. Secrets: `credentials/secrets.spec.ts` covers personal creation, workspace
   create/edit/discard/save/delete, detail routes, read-only behavior,
   cross-workspace binding rejection, and permission-group denial.
2. API keys: `credentials/api-keys.spec.ts` covers personal/workspace
   create/revoke, write-user denial, and workspace personal-key policy.
3. People: `workflows/people.spec.ts` covers workspace and organization invites,
   role/grant changes, revocation, existing-member permission/role changes, and
   removal with exact baseline restoration.
4. Access control: `workflows/access-control.spec.ts` creates and assigns a
   permission group, proves five restrictions in a fresh persona context, then
   deletes it and proves restoration.
5. SSO: `workflows/sso.spec.ts` creates, edits/discards/saves, requests
   verification instructions, and deletes a pending SAML provider without an
   IdP login or provider egress.
6. Data retention: `workflows/data-retention.spec.ts` edits defaults, adds and
   removes a workspace override, restores the exact snapshot, and is followed
   by an orchestrator database probe.
7. MCP tools: `workflows/mcp.spec.ts` proves a denied domain, then
   test/connect/create/discover/edit/reprobe/delete against the strict
   multi-session loopback fake.

`credentials/contract-integrity.spec.ts` and
`workflows/contract-integrity.spec.ts` keep these workflows tied to durable
navigation, persona, authorization, and lifecycle proof IDs.

## Quality and diagnostics gates

- No raw Playwright invocation, retries, worker override, arbitrary browser
  sleep, CSS-class assertion, `test.only`, shared mutable fixture, or
  unexplained skip is allowed.
- Credentials suppress traces, screenshots, videos, and authored attachments.
  People and SSO suppress network-bearing traces. Safe workflows retain
  failure traces and screenshots. Every exception is security-motivated and
  remains covered by the leak scan.
- Existing Vitest navigation, billing, SSO, route, permission, and
  business-rule tests remain required.
- The ordinary required CI job runs the full chain once. The final stability
  gate runs `--repeat-each=5` with retries zero against one verified production
  build and one healthy app/realtime boot, as specified by roadmap Step 7.

## Explicit milestone boundaries

The only deferred product boundaries are those authorized by the objective:
real payment execution, real email delivery, live SSO login/TXT verification,
destructive fork synchronization, and later self-hosted, billing-disabled, and
cross-browser nightly profiles. Production SSO quiescence, migration approval,
domain-ownership backfill/read-back, live TXT proof, and branch-protection
changes are manual operational gates rather than missing browser coverage.
