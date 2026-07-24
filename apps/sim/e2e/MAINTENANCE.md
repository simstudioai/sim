# Settings E2E maintenance

Use this guide when a product change can alter observable behavior on an account,
organization, or workspace settings surface. The browser datasets are literal
acceptance contracts, intentionally independent of production navigation and
authorization implementations.

For the step-by-step authoring workflow, invoke `/add-settings-e2e-test`; its
canonical source from the repository root is
`.agents/skills/add-settings-e2e-test/SKILL.md`.

## Decision rule

- An intended observable contract change requires the product code and the
  matching literal E2E contract or workflow proof to change in the same PR.
- An implementation-only change that preserves the observable contract requires
  focused verification, not artificial expectation churn.
- The categories below are non-exclusive. For example, a credential access
  change can require both authorization and credential-workflow coverage.
- Never import from or derive expectations from `SETTINGS_SECTION_REGISTRY`,
  `buildUnifiedSettingsNavigation()`, or another production implementation.

Observable behavior includes paths, redirects, labels, headings, descriptions,
sidebar visibility, direct-route outcomes, plan and role gates, mutation
availability, accessible control names, unsaved-change behavior, and persisted
workflow results. Purely visual changes do not require a new browser case unless
they change one of those contracts.

## Change map

### Navigation and routing

Update `e2e/settings/navigation/contracts.ts` and its matching specs when changing:

- canonical sections, paths, labels, headings, descriptions, semantic readiness,
  ordering, or active-sidebar behavior;
- default routes, aliases, legacy redirects, unknown sections, unavailable
  states, or direct-entry outcomes;
- the complete visible set or important hidden items for a representative
  persona.

Update `e2e/settings/navigation/history.spec.ts` directly when changing browser
Back, app Back, direct-entry fallback, or return destinations. Change the
navigation contract dataset only when one of its own section, route, or
visibility expectations also changes.

Keep the relevant production-level coverage aligned, especially:

- `components/settings/navigation.test.ts` for the shared registry, projections,
  aliases, ordering, and access metadata;
- `app/workspace/[workspaceId]/settings/navigation.test.ts` for the workspace
  adapter and route-facing behavior.

### Authorization and entitlements

Update `e2e/settings/authorization/contracts.ts` and its matching specs when
changing:

- direct URL access by role, permission, plane, plan, or entitlement;
- sidebar availability that is also an authorization promise;
- enabled, disabled, hidden, or upgrade-gated mutation controls.

Update `e2e/settings/authorization/unsaved-changes.spec.ts` directly when
changing shared unsaved-change behavior. Change the authorization contract
dataset only when one of its own access or mutation-control expectations also
changes.

Every mandatory gate needs representative allowed and denied proof. Keep
unit-level access tests, including `lib/organizations/settings-access.test.ts`
and affected consumer tests for `@sim/platform-authz` behavior, aligned with the
browser contract.

### Credentials

Update the affected Secrets or API key spec when changing personal/workspace
ownership, creation, editing, discard/save, deletion/revocation, binding policy,
or credential permissions. Update `e2e/settings/credentials/contracts.ts` only
when the reused authorization proof IDs or boundaries change; lifecycle
expectations live directly in the specs. Sensitive-value handling and diagnostic
suppression must remain intact.

### Stateful workflows

Update `e2e/settings/workflows/contracts.ts` and the affected workflow spec when
changing:

- workspace or organization invitations, roles, grants, or removals;
- permission-group creation, assignment, enforcement, or restoration;
- SSO provider creation, editing, verification instructions, or deletion;
- data-retention defaults, overrides, or exact restoration;
- MCP domain validation, connection, discovery, editing, or deletion.

Register cleanup before mutation and preserve exact baseline restoration.

### Personas and scenarios

Update `e2e/settings/personas.ts`, the relevant fixture/scenario definition, and
persona integrity or isolation proof when changing seeded roles, memberships,
plans, grants, subscriptions, or resource relationships. Do not weaken trusted
invariants to make an impossible persona pass.

## Verification

Run the affected unit tests and the focused orchestrated Playwright project. The
commands and project boundaries are maintained in:

- [Settings navigation contracts](README.md#settings-navigation-contracts)
- [Settings authorization contracts](README.md#settings-authorization-contracts)
- [Settings credential workflows](README.md#settings-credential-workflows)
- [People and access-control workflows](README.md#people-and-access-control-workflows)
- [Enterprise integration workflows](README.md#enterprise-integration-workflows)

Run browser tests only through `bun run test:e2e`; the operational and safety
requirements, acceptance boundaries, and CI policy live in
[README.md](README.md). Required CI remains the authoritative complete-suite
gate.
