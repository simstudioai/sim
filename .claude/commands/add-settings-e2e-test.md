---
description: Add or update durable Playwright coverage for Sim settings using the correct literal contract or owning spec, existing personas, guarded orchestration, semantic assertions, cleanup, and secret-safe diagnostics. Use when asked to add a settings browser test, cover a settings regression, or update settings E2E acceptance behavior.
argument-hint: <settings-behavior-or-regression>
---

# Add Settings E2E Test

Add the smallest durable browser proof for the requested observable behavior.
Do not begin by copying a nearby test: first identify which acceptance dataset
or spec owns the behavior.

## Read first

1. `apps/sim/e2e/MAINTENANCE.md` — change type to contract/spec ownership.
2. `apps/sim/e2e/README.md` — orchestrator, project boundaries, focused commands,
   diagnostics, and CI policy.
3. `apps/sim/e2e/STABILIZATION.md` — non-waivable acceptance and security
   boundaries.

Those files are canonical. This skill is the authoring procedure, not a second
copy of their inventories or commands. If this procedure ever conflicts with a
canonical document, the canonical document wins.

## Procedure

### 1. Define the observable contract

Write down:

- the user persona and resource plane (account, organization, or workspace);
- the action or direct URL;
- the exact observable result: path, semantic readiness, visible/hidden item,
  access outcome, enabled/disabled control, warning, or persisted state;
- whether product behavior is intentionally changing or an implementation
  change must preserve the existing contract.

Intended behavior changes update product code and literal acceptance
expectations together. Behavior-preserving fixes add or strengthen proof without
rewriting unrelated expectations.

### 2. Choose the owner before writing code

- **Canonical section, route, copy, readiness, or persona visibility:** update
  `apps/sim/e2e/settings/navigation/contracts.ts`; its specs generate cases from
  the literal dataset, including unauthenticated redirect cases.
- **Browser Back, app Back, direct-entry fallback, or return destination:** edit
  `apps/sim/e2e/settings/navigation/history.spec.ts` directly.
- **Direct access, plan/role/entitlement gate, or mutation availability:** update
  `apps/sim/e2e/settings/authorization/contracts.ts`; its access and mutation
  specs generate cases from that dataset.
  - If an existing navigation case already owns the sidebar proof, add or reuse
    an `existingNavigationProofs` entry and set
    `sidebar.existingProofId`. Do not execute the same sidebar assertion again
    in the authorization case.
- **Unsaved-change behavior:** edit
  `apps/sim/e2e/settings/authorization/unsaved-changes.spec.ts` directly.
- **Secrets or API key lifecycle:** edit the owning credential spec directly.
  Change `apps/sim/e2e/settings/credentials/contracts.ts` only when reused
  authorization proof IDs or boundaries change.
- **People, access control, SSO, data retention, or MCP lifecycle:** edit the
  owning workflow spec. Change `apps/sim/e2e/settings/workflows/contracts.ts`
  when stable lifecycle or cross-contract proof references change.
- **Persona or seeded relationship:** update
  `apps/sim/e2e/settings/personas.ts` and the relevant
  scenario/factory/integrity proof.

The categories are non-exclusive. Prefer extending an existing literal row or
owning workflow over adding a duplicate standalone test.

### 3. Use the owning fixture wrapper

- Browser-touching settings specs must not import runtime `test` or `expect`
  from `@playwright/test`. Type-only imports such as `Page` or `Response` are
  allowed.
- Navigation, authorization, persona-contract, and persona-isolation browser
  specs use `apps/sim/e2e/fixtures/persona-test.ts`.
- Credential specs use the local `credential-test.ts`; workflow specs use the
  local `workflow-test.ts`; authenticated or unauthenticated smoke and
  browser-touching harness-level specs use
  `apps/sim/e2e/fixtures/browser-test.ts`.
- Pure dataset-only contract-integrity specs and non-browser foundation policy
  specs may use the Playwright test runner directly. If they begin creating a
  browser, context, or page, move them to the owning wrapper first.
- Persona-based tests must create contexts through `contextForPersona` or an
  owning helper that calls it. The inherited `page` and `context` fixtures on
  `persona-test` are not persona-authenticated or network-guarded.
- `browser-test` guards its default context. Every manual
  `browser.newContext()` must install `installBrowserNetworkGuard()` immediately,
  then close the context and assert the guard even when the test fails; follow
  the aggregate-cleanup pattern in authenticated smoke coverage. Do not use
  `browser.newPage()`: it creates an implicit unguarded context; create and guard
  an explicit context, then call `context.newPage()`.
- Reuse the owning directory's helpers. Credential tests use their local
  `newPersonaPage` helper so the page is registered for failure sanitization.
  Wrapper selection alone does not install every context, cleanup, attachment,
  redaction, or artifact safeguard; bypassing the guarded fixture/helper path is
  a test-safety bug.

### 4. Reuse the existing world

- Reuse an existing persona and seeded resource when it expresses the required
  role, plan, entitlement, and ownership boundary.
- Add a persona or scenario edge only when no existing driver can prove the
  contract without changing its meaning.
- Use run-namespaced factories and unique resources. Do not introduce shared
  mutable fixture state.
- Keep sensitive fixture values browser-resident through the existing helpers.
  The Playwright process must not receive database credentials, admin keys,
  persona passwords, or plaintext values that the owning spec keeps in-page.

### 5. Assert semantics, not implementation details

- Use accessible roles, labels, names, and visible text.
- Assert exact paths and user-facing contract copy when those are the behavior
  under test.
- Wait on semantic readiness, relevant same-origin responses, or explicit
  authorization state—not arbitrary sleeps or CSS classes.
- For access controls, prove direct URL behavior as well as sidebar visibility.
- Do not import production navigation or authorization implementations to
  generate expected values.

### 6. Make mutations reversible

- Register cleanup before the first mutation.
- Create uniquely named resources and restore the exact captured baseline.
- Use the production UI and same-origin APIs for behavior under test; use a
  trusted database probe only where the existing suite defines one.
- Keep cleanup LIFO and safe after partial failure. Never weaken fixture
  invariants merely to make a test pass.

### 7. Respect external and diagnostic boundaries

- Use the existing strict loopback Stripe and MCP fakes, the mail mock-success
  path with provider credentials absent, and the other reviewed test
  boundaries. An unexpected external request must fail rather than silently
  egress.
- Credentials, tokens, certificates, verification values, storage state, and
  sensitive response bodies may be used only through existing reviewed paths;
  never log, attach, or retain them in diagnostics.
- The SSO workflow's public-certificate browser input is one reviewed example;
  preserve its input clearing and diagnostic suppression.
- Preserve the owning spec's trace, screenshot, video, and attachment policy.
  New suppression requires a security reason and corresponding safety coverage.

### 8. Keep unit and integrity proof aligned

- Update affected production unit tests for navigation, route gates,
  authorization, billing, or business rules.
- Update the owning `contract-integrity.spec.ts` when adding IDs, references, or
  a new contract axis.
- Preserve stable proof IDs; do not rerun a browser case merely because another
  contract can reference its existing proof.

### 9. Verify through the orchestrator

- Run the affected unit and contract-integrity tests.
- Run the focused canonical project and path documented in
  `apps/sim/e2e/README.md`.
- Invoke only `bun run test:e2e`; never invoke raw `playwright test`.
- Use `--reuse-build` and a single explicit project with `--no-deps` for local
  iteration when the README permits it.
- Follow the retry policy in the canonical README and Playwright config. It is
  currently zero; do not enable retries or change worker policy in a feature
  test. Do not use `test.only`, unexplained skips, arbitrary browser sleeps, or
  test-local environment bypasses.
- After focused proof passes, rely on the required complete CI suite. Run a
  repeated stability gate only when the change's scope or acceptance plan calls
  for one.

## Completion checklist

- [ ] Every observable facet has one clear owner, and all applicable owners were
      updated.
- [ ] Allowed and denied outcomes exist where the feature is gated.
- [ ] Locators and readiness assertions are semantic and accessible.
- [ ] Mutations register cleanup first and restore the exact baseline.
- [ ] No secret or external-egress boundary was weakened.
- [ ] Related unit and contract-integrity tests are aligned and pass.
- [ ] Focused execution used the guarded orchestrator and complied with the
      canonical retry policy.
