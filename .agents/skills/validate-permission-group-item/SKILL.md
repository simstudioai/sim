---
name: validate-permission-group-item
description: Audit an existing enterprise permission-group item end-to-end — registry entry, schemas, type, defaults, tolerant parser, admin UI, capability rule, enforcement site, and tests — proving the gate actually refuses rather than assuming it. Use when checking a key in `PERMISSION_GROUP_FIELDS` or a capability in `CAPABILITY_RULES`.
argument-hint: <config-key-or-capability-id>
---

# Validate Permission Group Item Skill

You are auditing one governed item in Sim's enterprise permission-group system. The question you are answering is not "does this key exist in the right places" — the registry makes most of that compiler-enforced. The question is:

> **If an organization admin sets this, what refuses, and can I make that refusal happen?**

Twelve keys once shipped with an admin checkbox, a hint describing what they restrict, and no server check at all. Every one of them would have passed a structural audit. Assume nothing enforces until you have found the throw.

The authoring counterpart is the `add-permission-group-item` skill. It owns the procedure and the rationale for each invariant; this skill owns the audit. Where the two overlap, read that one for *why* and this one for *how to check*.

## Read the system first

- `apps/sim/lib/permission-groups/fields.ts` — the registry every config surface derives from, plus `permissionGroupConfigSchema`, `tolerantArray` and `parsePermissionGroupConfig`. There is **no `types.ts`** — it was folded into this file, and the two DB constraint maps live in `constraints.ts`
- `apps/sim/lib/permission-groups/capabilities.ts` — `CAPABILITY_IDS`, `CAPABILITY_RULES`, `capabilityRefusal`, `refuseCapability`
- `apps/sim/lib/permission-groups/capability-assertions.ts` — the canonical assertion API (and it re-exports `capabilityRefusal`)
- `apps/sim/lib/permission-groups/resolve.server.ts` — group resolution, moved out of `ee/`; `ee/access-control/utils/permission-check.ts` now re-exports it and keeps only the executor gates
- `apps/sim/lib/permission-groups/config-scope.server.ts` — `resolvePermissionGroupConfig`, the per-request memo every assertion resolves through
- `apps/sim/lib/permission-groups/request-scope.server.ts` — the import-free half of the scope, holding `withPermissionGroupScope`
- `apps/sim/lib/core/application/workspace-authorization.ts` — the funnel, and who bypasses it
- `scripts/check-permission-group-enforcement.ts`, `scripts/check-application-graph.ts`, `scripts/check-capability-subject.ts` — what the three audits do and do not prove

## Step 1: Registry entry

Find the key in `PERMISSION_GROUP_FIELDS`. Record its builder (`booleanRestriction` / `allowlist` / `denylist`), its `enforcement`, and its position.

- **Default is permissive?** Boolean `false`, allowlist `null`, denylist `[]`. The builders hardcode these, so the real risk is a key whose *name* inverts the meaning — an `allowX` boolean whose permissive value would be `true`. Every stored config predates the key, so a restrictive default silently applies retroactively to every existing group.
- **Named as a restriction?** `hideX` / `disableX` / `allowedX` / `deniedX`. The admin checkbox renders `checked={!editingConfig[feature.configKey]}` — ticked means allowed — so a positively-named boolean renders backwards.
- **Position stable?** Declaration order is the wire order of `PermissionGroupConfig`, both zod schemas, and every config JSON crossing the API boundary; `fields.test.ts` pins it with a contract test that compares key order. If `git log -p` shows the key was ever *moved* rather than appended, that shipped as a dirty-check regression in the group editor.
- **Phrasing present and accurate?** An allowlist's `{ limited, empty }` and a denylist's string are read by `getActivePermissionGroupRestrictions` in `features.ts` and surface to users through the Copilot workspace VFS and the enterprise platform context. Check the `empty` string genuinely says "none allowed" and not "unrestricted".
- **Does the boolean's `hint` tell the truth?** This is the highest-value read in Step 1. A key with `enforcement: 'capability'` refuses at the API, so a hint saying it hides a tab, a panel, a module "from the sidebar", or a nav item is a **lie** an admin acts on — an admin ticking that box is revoking access, not hiding a link, and they believe they are tidying chrome while they are withholding a module. The same string is read a second time as the prose for an *active* restriction, where "hide" is simply false. It must name what a member can no longer do. Twelve keys carried that wording for a release after they started 403-ing; treat any surviving "Hide the …" hint on a `'capability'` key as a finding, not a nit. Check `label` and `category` the same way — a section headed "Sidebar" or "Settings Tabs" makes the same claim structurally.

## Step 2: Schemas, type, defaults, parser

These are derived by `collectFieldProperty` — `permissionGroupWriteShape` / `permissionGroupConfigSchema`, `permissionGroupReadShape`, `DEFAULT_PERMISSION_GROUP_CONFIG`, and the tolerant parser all read the same registry. **Do not hand-verify them one by one.** Verify instead that nothing has been introduced that bypasses the derivation:

```bash
grep -rn "<configKey>" apps/sim --include='*.ts' --include='*.tsx' | grep -v 'lib/permission-groups/'
```

Every hit outside `lib/permission-groups/` is either a rule's `deniedBy`, an enforcement site, a UI binding, or a test. Anything else — a route restating the key, a client re-deriving a default, a second coercion path — is a leak. In particular:

- A `z.array(...).catch(...)` anywhere on this key's path. `.catch()` is whole-value tolerant: one bad member discards every good one. On an **allowlist** that is fail-**open**, because the fallback is `null` and `null` means unrestricted — a partially corrupt allowlist would stop restricting anything. `tolerantArray` filters element-wise for exactly this reason. Rank a regression here with the enforcement findings; it is a security bug, not a coercion nit.
- A `?? []` applied to an allowlist. `null` allows everything and `[]` allows nothing; collapsing them inverts the unrestricted case.
- Any read of the config that does not come from `parsePermissionGroupConfig` or a `resolvePermissionGroupConfig` caller.

Two structural guards to confirm are still present:

- **`parsePermissionGroupConfig` still tests `Array.isArray(config)`** alongside its truthiness and `typeof … === 'object'` checks. `typeof [] === 'object'`, so without it an array reaches `z.object().parse([])`, which throws — and the column is `jsonb`, so a row genuinely can hold `[]`. The guard is what makes that path return the defaults instead of a 500. `tolerantArray` carries the mirror-image guard.
- **`CAPABILITY_RULES` still uses `satisfies`, not a type annotation.** An annotation widens every entry to `CapabilityRule`, and `StaticPermissionGroupCapability` — derived by filtering the object's entries for `kind: 'static'` — then resolves to `never`. No operation can declare any capability, the type system stops constraining capabilities entirely, and nothing at runtime looks wrong. `AssertsStaticCapabilityResolves` exists to catch it; report any weakening of it as a top-tier finding.

Confirm the type assertions at the bottom of `fields.ts` still name a field of this kind (`AssertsAllowlistStaysPrecise`, `AssertsDenylistStaysPrecise`, `AssertsRestrictionStaysPrecise`, `AssertsAuthTypesStayPrecise`, `AssertsParserReturnsTheConfig`). They exist because a zod generic degrading to `unknown` is invisible at runtime — the values stay right, no test fails, and every call site quietly loses its narrowing.

## Step 3: Admin UI

Open `apps/sim/ee/access-control/components/group-detail.tsx`.

- **Boolean:** it should appear automatically — `PLATFORM_FEATURES` in `features.ts` is derived by filtering `field.kind === 'boolean-restriction'`. Confirm its `category` is in `PLATFORM_CATEGORY_ORDER`; an unlisted category renders after every ordered section.
- **Allowlist or denylist:** it renders **nothing** unless something puts it there. Look for the key in the `featureExtras` map — which is keyed by the *feature id of the parent boolean*, not by the allowlist's own config key. A non-boolean key with no picker and no bespoke section is a key no admin can ever set. Report it.
- For a picker, check both behaviors: the setter refuses an empty selection (`if (values.length === 0) return`), and collapses a full selection back to `null` (`values.length === ALL.length ? null : values`). Storing the full set freezes the allowlist at today's members, so a member added next release is denied by a group that had chosen "all".
- Check the parent the picker nests under is the right one. `allowedKnowledgeConnectors` hangs off `hide-knowledge-base`, not `disable-knowledge-base-creation`, because a connector attaches to an existing knowledge base — nesting it under creation would dim the picker for exactly the cohort it was written for.

## Step 4: Capability rule

If `enforcement` is `'capability'`, the key must appear in some rule's `configKeys` in `CAPABILITY_RULES` — the audit asserts this (assertion D) and also asserts the converse (E): a key declared `'executor'` or `'ui-only'` that a rule reads is flagged, so a key cannot gain enforcement while staying documented as something weaker.

Then check the things the audit cannot:

- **`configKeys` lists every key `deniedBy` actually reads.** The audit parses `configKeys` textually; it does not read the closure. A key read by `deniedBy` but missing from `configKeys` is invisible to assertions D and E.
- **`kind` is right.** A rule whose decision needs a request value must be `'parameterized'`. A parameterized rule can never be declared on an operation — `defineWorkspaceOperation` throws at definition time — so if you find one named on an operation, that code does not run in production; something else is wrong.
- **A narrower capability subsumes the broader one it replaced.** An operation carries exactly one capability. If this capability was split off a more general one, its rule must also read the general key. The precedent is `knowledge.create` and `knowledge.upload`, which both read `hideKnowledgeBaseTab` alongside their own key — without that, a group withholding the entire Knowledge Base module could still create one through the API. Check `git log` for a re-pointed `capability:` field and verify the narrower rule grew the broader key in the same commit.
- **`detailCode` matches the remedy.** `FORBIDDEN_DETAIL_CODES` is closed over *remedies*, not causes. A distinct code is warranted only when a caller would act differently; otherwise `PERMISSION_GROUP_CAPABILITY_BLOCKED` is correct. Any code in use must have an entry in `FORBIDDEN_DETAIL_CODE_DESCRIPTIONS`, which is a compile-time gate and also publishes the OpenAPI 403 text.
- **`describe` reads correctly in the sentence.** Two functions build it and there is no third, both **defined in `capabilities.ts`**: `refuseCapability(capability)` throws `"<describe> is not available under your organization's permission group"` as a `PermissionGroupCapabilityError`, and `capabilityRefusal(capability)` returns the same string for a raw route rendering its own body (`capability-assertions.ts` re-exports it so an inline gate reaches both through one module). `describe` must be a singular noun or gerund phrase that agrees with "is". Any call site that writes the sentence out itself is a drift finding.

## Step 5: Prove the enforcement — do not assume it

This is the step the whole skill exists for. Find the **actual refusal**, name the file and line, and describe what a caller sees.

```bash
grep -rn "'<capability-id>'" apps/sim --include='*.ts' --include='*.tsx'
grep -rn "permission-group-enforced: <capability-id>" apps/sim
```

The second grep will miss a gate written through `capabilityDeniedBy` with the annotation in a TSDoc block above the enclosing statement, so read the surrounding function rather than the matched line alone.

Classify what you find into exactly one of:

1. **Declared on operations.** `capability: '<id>'` on one or more `defineWorkspaceOperation` calls. The funnel enforces in `requireCurrentHumanAccess` → `requireCapability`. Verify the set of operations is *complete*: enumerate every route and tool that reaches the same behavior and check each one's operation declares it. One route declaring `capability: 'none'` for the same behavior is the hole.
2. **Asserted at a call site**, with a `// permission-group-enforced: <id> — <reason>` annotation. Verify the assertion goes through `capability-assertions.ts` (`assertWorkspaceCapability`, `isWorkspaceCapabilityWithheld`, `isOrganizationCapabilityWithheld`, `capabilityDeniedBy`) or a direct `CAPABILITY_RULES['<id>'].deniedBy(...)` rather than spelling the config key out inline — a call site reading `config.disableX` directly stops denying anything the moment the key is renamed, and its wording drifts from the funnel's. Then check the second half, which is easy to miss because the decision looks right: does it *raise* through `refuseCapability` (or render `capabilityRefusal(cap)`), or does it build its own `ForbiddenOperationError` with a hand-written message? `validatePublicFileSharing` and `validateChatDeployAuth` in `ee/access-control/utils/permission-check.ts`, and `assertConnectorTypeAllowed` in `lib/knowledge/application/connectors.ts`, all read the rule and call `refuseCapability` — that is the pattern for a use case. A raw route that renders its own body pairs `isWorkspaceCapabilityWithheld` (or `capabilityDeniedBy`) with `capabilityRefusal`; `app/api/logs/export/route.ts` and the inbox and api-keys routes are the shape.
3. **Executor-gated.** Read by `assertPermissionsAllowed` in `ee/access-control/utils/permission-check.ts`, per block / tool / model. Verify the branch exists and throws a real error, and that the id it compares against is the same vocabulary the admin UI writes — `deniedTools` holds block `tools.access` ids verbatim, version suffix included.
4. **A field projection, not a gate.** `logs.trace_spans` and `logs.cost` withhold fields from a response rather than the response itself, so the logs routes correctly declare `capability: 'none'`. The single owner is `apps/sim/lib/logs/log-projection.ts` (`resolveLogFieldProjection`, `projectExecutionData`, `projectCostTotal`), which carries both `permission-group-enforced:` annotations. A **second** implementation of the same redaction anywhere else is the finding here — two copies is how one of them stops redacting.
5. **Nothing.** Report it as a defect, with the sentence "an organization that sets this believes it applied a restriction that does not exist".

Then make the refusal happen. Either write a failing case, or take the existing test and **remove the gate** — delete the `capability:` field, or the `deniedBy` body, or the assertion call — and confirm the test goes red. A test that still passes with the gate removed is proving nothing. Restore the code afterward.

For an allowlist, the three states have to be tested separately, because they are what the parser and the UI conspire to confuse: `null` permits every member, a populated list permits only the named ones, `[]` permits **none**. `capabilities.test.ts` pins all three for `knowledge.connectors`; anything less than that for another allowlist is a gap.

### Who the gate runs against

A capability belongs to a *person*, so half of auditing a gate is auditing whose id it reads.

- **`/api/v1`** authorizes in `apps/sim/app/api/v1/middleware.ts`, not through `authorizeWorkspaceOperation`. Every route threads a `V1RouteCapability` (`StaticPermissionGroupCapability | 'none'`, required and spelled out), and the subject must come from `capabilityGovernedUserId(rateLimit)`, which returns `null` for a workspace key. `rateLimit.userId` is populated for **both** key kinds and is the key's *creator* for a workspace key, so any gate keyed on the presence of a user id applies a bystander's group to every caller of a shared credential. Reading `rateLimit.userId` (or `auth.userId`) into a capability sink is the finding; `scripts/check-capability-subject.ts` exists because it has shipped twice.
- **Raw internal table routes** gate `tables.use` inside `checkAccess` in `apps/sim/app/api/table/utils.ts`, whose signature takes a `TableAccessPrincipal` discriminated union — `{ kind: 'user'; userId }` or `{ kind: 'workspace_api_key'; keyCreatorUserId }` — rather than a bare `userId`, so a caller cannot reach the gated behavior without naming a kind. A bare id passed here no longer type-checks; `tableAccessPrincipal(rateLimit)` in the v1 middleware is the one place v1 builds it.
- **The definition-time `undefined` guard.** `defineWorkspaceOperation` throws when `capability` is `undefined`, even though the field is required, because `apps/sim/tsconfig.json` excludes `*.test.ts` / `*.test.tsx` and the enforcement audit walks past test files — a fixture is the one construction site no static check reads. Without the guard, a capability-less operation defines cleanly and then throws `Cannot read properties of undefined` inside `capabilityDeniedBy` **only for tenants that actually have a permission group**, passing CI and every personal workspace. If you find a proposal to drop the guard as redundant, that is a finding.

## Step 6: Tests

- **`apps/sim/lib/permission-groups/fields.test.ts`** (formerly `types.test.ts`) — the key must appear in both the `input` and `expected` halves of the `'a fully populated config'` fixture. The corpus is pinned deliberately: a row that changes in a later diff has to be defended as a semantic decision rather than slipping through as a regression. The rest of that file (wire order, idempotence, read-schema acceptance, the seeded 2000-iteration fuzz, the write/default/read key-set agreement, boolean-to-`PLATFORM_FEATURES` coverage) derives from `DEFAULT_PERMISSION_GROUP_CONFIG` and needs no per-key edit.
- **`capabilities.test.ts`** — a case for any rule with logic beyond reading one key: subsumption, allowlist three-state, auth-mode membership.
- **`features.test.ts`** — derived from `PLATFORM_FEATURES`; a boolean key needs no edit. A non-boolean key contributing user-facing prose should have its `limited` / `empty` strings pinned there.
- **`config-scope.server.test.ts`** — covers the per-request memo. A new gate that resolves the config outside `resolvePermissionGroupConfig` bypasses it and is a finding in Step 2, not here.

## Step 7: Run the checks

```bash
bun run check:permission-group-enforcement
bun run check:application-graph
bun run check:capability-subject
cd apps/sim && bun run type-check
cd apps/sim && bunx vitest run lib/permission-groups
```

All three audits are inside `check:audits`, which derives its list from the `check:*` scripts in `package.json` — a new audit is opted *out* deliberately rather than opted in. Read their output, not just their exit codes.

**`check:permission-group-enforcement`** is all-or-nothing — one success line or findings; there is no count-down or migration mode that exits 0 with work outstanding, so do not go looking for a `pending enforcement:` list. What it can still do is pass without proving what you want:

- **Vacuous parse.** It reads source text with regexes. It refuses to report success when `CAPABILITY_IDS`, `CAPABILITY_RULES`, or `PERMISSION_GROUP_FIELDS` parse to nothing, cross-checks that the rule count equals the capability count, reports per-call any `defineWorkspaceOperation` whose `id` it cannot read, and — the newest guard — **fails a file that calls `defineWorkspaceOperation` but parses to ZERO declarations**, which is what a non-literal `id:` or an arrow-const factory looks like. If any of those fire, the audit is broken, not the code — fix the parsers rather than leaving it passing.
- **A capability declared on an operation nothing routes to.** Assertion C is satisfied by the declaration alone. An operation that no route, tool, or use case actually invokes still counts as reaching the capability.

**`check:application-graph`** asserts the authorization funnel and `with-route-handler.ts` reach no heavy module tree at runtime, across five guarded roots: `lib/core/application/index.ts`, `capabilities.ts`, `capability-assertions.ts` and `config-scope.server.ts` may not reach `providers/`, `blocks/`, `tools/`, `executor/`, `lib/uploads/` or `lib/workflows/`; `with-route-handler.ts` additionally may not reach `lib/billing/`, `lib/permission-groups/resolve.server`, `lib/auth`, `lib/copilot/` or `lib/knowledge/`. Only runtime edges count — `import type` is erased and deliberately allowed. A gate you are auditing that imports a resolver into one of those roots is a finding even if the gate itself is correct. The failure mode never announces itself: past regressions surfaced as unrelated knowledge tests failing on a partial mock and an OTP-route test failing on its own `zod` mock.

**`check:capability-subject`** asserts every v1 capability sink takes its subject from `capabilityGovernedUserId`, that no v1 file outside the middleware imports the permission-group modules directly, and that at least one governed sink was found at all (so a refactor into an unparseable form cannot look like a clean tree).

Reference success lines:

```
✓ permission-group enforcement: 287 operations declare a capability, 35 capabilities all enforced
✅ Application graph clean: 5 roots reach none of 11 forbidden module trees
check:capability-subject — 32 v1 files, 5 capability subjects resolved through capabilityGovernedUserId.
```

The audits prove *reachability*, not correctness: that a capability is named somewhere, that a key is read by some rule, that a subject came from the right helper. They cannot tell whether the rule's logic is right, whether every relevant operation declares it, or whether an annotated call site actually calls anything. Step 5 is what covers that, and no amount of green CI substitutes for it.

## Known gaps — recognize these, do not re-report them

These are understood, deliberate, and documented in the code. Note them if they are material to what you were asked about; do not file them as new findings.

- **A workspace API key resolves no permission group.** It authorizes as the workspace, so there is no user and `operation.capability` does not apply — the `workspace_api_key` branch of `authorizeWorkspaceOperation` returns before any capability check, and the same reasoning shapes `TableAccessPrincipal`, `capabilityGovernedUserId` and the log projection. Substituting the key's creator would apply a bystander's group to every caller of a shared key and break the key outright when that person left the organization. The escape is closed at the door instead: minting a workspace key is itself capability-gated.
- **An executor delegation carries role but not capabilities.** A delegated `executor` principal *with* a `sim_user` subject goes through `requireCurrentHumanRole` only. A run carries the role of whoever triggered it, but a capability names what a *person* may reach in the product, while a run reaches those resources because a block in the graph does — applying capabilities would turn "hide Tables" into a runtime kill-switch that breaks every workflow with a Table block for that cohort.
- **An actorless deployment run passes through.** A delegated `executor` principal in `mode: 'deployment'` with no resolvable subject is authorized without a capability check, because a deployed workflow acts with the workspace's authority rather than its author's permission group. Denying there would 403 every scheduled run, webhook, and public-API call in the organization the moment a group withheld anything. What such a run *does* is still governed, by `assertPermissionsAllowed` in the executor — which is precisely why the four run-scoped keys carry `enforcement: 'executor'` rather than `'capability'`.
- **Copilot is deliberately NOT exempt.** A delegated principal with a `sim_user` subject whose `serviceId` is anything other than `executor` takes the full `requireCurrentHumanAccess` path, capability check included. Copilot acts as the person, so it must not reach what the person may not. A proposal to exempt it is a finding, not a simplification.
- **Capability is checked after the role check.** `requireCurrentHumanAccess` runs `requirePermission` first. `NoWorkspaceAccessError` is concealed as a 404 by the v2 surface so a non-member cannot learn the resource exists; refusing on capability first would hand a complete outsider an oracle for which capabilities the organization withholds. It is also the cheaper check and names the remedy the caller can act on. The v1 middleware states the same ordering rule in its own TSDoc. Do not report the ordering as a bug.
- **`allowedEgressHosts` does not exist.** There is no network-egress allowlist in `PERMISSION_GROUP_FIELDS`. Requests for one are a feature, not a missing wiring of an existing key.
- **Nothing currently ships as `ui-only`.** The `enforcement` union has the member and no user. An absent `ui-only` key is not a gap.

## Report Format

For each item audited, state:

1. **Kind and enforcement** — as declared, and whether the declaration is true.
2. **The refusal** — file, line, the error thrown, and what a caller sees (status, `detailCode`, message). Or: *it is a projection, and here is its single owner*. Or: *nothing refuses*.
3. **The subject** — whose user id the gate reads, and that a workspace key reaches it ungated rather than as its creator.
4. **Proof** — the test that fails when the gate is removed, or the statement that no such test exists.
5. **Coverage gaps** — routes, tools, or surfaces reaching the same behavior without the gate.
6. **Findings**, ordered: unenforced key > key-creator substituted for the acting principal > fail-open coercion (`.catch()` on an array, a dropped `Array.isArray` guard, `CAPABILITY_RULES` annotated instead of `satisfies`) > incomplete operation coverage > allowlist three-state confusion > **admin copy that misstates the enforcement** > duplicated projection logic > missing admin UI > missing test > cosmetic.

A hint that says "hide" for a key that 403s is not cosmetic. It is the one defect an admin acts on directly: they tick it believing they hid a link, and members lose the module. Rank it with the enforcement findings, not the polish.
