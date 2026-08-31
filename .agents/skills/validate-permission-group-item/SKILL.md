---
name: validate-permission-group-item
description: Audit an existing enterprise permission-group item end-to-end — registry entry, schemas, type, defaults, tolerant parser, admin UI, capability rule, enforcement site, and tests — proving the gate actually refuses rather than assuming it. Use when checking a key in `PERMISSION_GROUP_FIELDS` or a capability in `CAPABILITY_RULES`.
argument-hint: <config-key-or-capability-id>
---

# Validate Permission Group Item Skill

The question is not "does this key exist in the right places" — the registry makes most of that compiler-enforced. It is:

> **If an organization admin sets this, what refuses, and can I make that refusal happen?**

Twelve keys once shipped with a checkbox, a hint, and no server check. Every one would have passed a structural audit. Assume nothing enforces until you have found the throw.

**`add-permission-group-item` owns the procedure and the rationale for every invariant named below.** Read it for *why*; this skill is the checklist. Its "Read the system first" list is the same one — start there.

## Step 1: Registry entry (`lib/permission-groups/fields.ts`)

Record the builder, the `enforcement`, and the position.

- **Default permissive?** The builders hardcode `false` / `null` / `[]`, so the risk is a *name* that inverts the meaning — an `allowX` boolean. The checkbox renders `checked={!editingConfig[feature.configKey]}` (ticked = allowed), so a positively-named boolean renders backwards.
- **Position stable?** Declaration order is the wire order and `fields.test.ts` pins it with a key-order contract test. If `git log -p` shows the key was ever *moved* rather than appended, that shipped as an editor dirty-check regression.
- **Phrasing accurate?** An allowlist's `{ limited, empty }` and a denylist's string are read by `getActivePermissionGroupRestrictions` in `features.ts` and surface to users through the Copilot workspace VFS and the enterprise platform context. Confirm `empty` says "none allowed", not "unrestricted".
- **Does the `hint` tell the truth?** Highest-value read in this step. A `'capability'` key refuses at the API, so a hint saying it hides a tab, module, or nav item "from the sidebar" is a **lie an admin acts on** — they believe they are tidying chrome while withholding a module. The same string is reused as the prose for an *active* restriction, where "hide" is simply false. Any surviving "Hide the …" hint on a `'capability'` key is a finding, not a nit; check `label` and `category` the same way (a "Sidebar" or "Settings Tabs" section makes the claim structurally).

## Step 2: Schemas, type, defaults, parser

All derived by `collectFieldProperty` from the same registry. **Do not hand-verify them.** Verify nothing bypasses the derivation:

```bash
grep -rn "<configKey>" apps/sim --include='*.ts' --include='*.tsx' | grep -v 'lib/permission-groups/'
```

Every hit should be a rule's `deniedBy`, an enforcement site, a UI binding, or a test. A route restating the key, a client re-deriving a default, or a second coercion path is a leak. Specifically:

- **`z.array(...).catch(...)` anywhere on this key's path** — whole-value tolerant, so one bad member discards every good one, and on an allowlist the `null` fallback means unrestricted. That is fail-**open**. `tolerantArray` filters element-wise. Rank a regression here with the enforcement findings.
- **`?? []` applied to an allowlist** — collapses "allows everything" into "allows nothing".
- **Any config read not from `parsePermissionGroupConfig` or a `resolvePermissionGroupConfig` caller.**

Two structural guards must still be present:

- **`parsePermissionGroupConfig` still tests `Array.isArray(config)`.** `typeof [] === 'object'`, the column is `jsonb` so a row genuinely can hold `[]`, and `z.object().parse([])` throws — the guard is what returns defaults instead of a 500. `tolerantArray` carries the mirror image.
- **`CAPABILITY_RULES` still uses `satisfies`, not an annotation.** An annotation collapses `StaticPermissionGroupCapability` to `never`, silently disabling the type system around capabilities with nothing wrong at runtime. `AssertsStaticCapabilityResolves` catches it; any weakening is a top-tier finding.

Confirm the assertions at the bottom of `fields.ts` still name a field of this kind (`AssertsAllowlistStaysPrecise`, `AssertsDenylistStaysPrecise`, `AssertsRestrictionStaysPrecise`, `AssertsAuthTypesStayPrecise`, `AssertsParserReturnsTheConfig`) — a zod generic degrading to `unknown` is invisible at runtime and quietly loses every call site's narrowing.

## Step 3: Admin UI (`ee/access-control/components/group-detail.tsx`)

- **Boolean:** appears automatically via `PLATFORM_FEATURES`. Confirm its `category` is in `PLATFORM_CATEGORY_ORDER`; an unlisted one renders after every ordered section.
- **Allowlist / denylist:** renders **nothing** unless it is in the `featureExtras` map — keyed by the *parent boolean's feature id*, not the config key. No picker and no bespoke section means no admin can ever set it. Report it.
- For a picker, check both behaviors: refuses an empty selection (`if (values.length === 0) return`) and collapses a full one back to `null` (otherwise the allowlist freezes at today's members).
- Check the parent is the right one (`allowedKnowledgeConnectors` under `hide-knowledge-base`, not `disable-knowledge-base-creation`).

## Step 4: Capability rule

A `'capability'` key must appear in some rule's `configKeys` — the audit asserts this (D) and the converse (E): a key declared `'executor'` or `'ui-only'` that a rule reads is flagged, so a key cannot gain enforcement while staying documented as weaker. Then check what the audit cannot:

- **`configKeys` lists every key `deniedBy` reads.** The audit parses it textually and never reads the closure; a key read but unlisted is invisible to D and E.
- **`kind` is right.** A rule needing a request value must be `'parameterized'` — and a parameterized rule named on an operation cannot have run in production (`defineWorkspaceOperation` throws at definition time), so something else is wrong.
- **A narrower capability subsumes the broader one it replaced.** An operation carries exactly one capability. Precedent: `knowledge.create` / `knowledge.upload` both read `hideKnowledgeBaseTab`, without which a group withholding the whole module could still create a KB through the API. Check `git log` for a re-pointed `capability:` and verify the narrower rule grew the broader key in the same commit.
- **`detailCode` matches the remedy** — `FORBIDDEN_DETAIL_CODES` is closed over remedies, not causes; otherwise `PERMISSION_GROUP_CAPABILITY_BLOCKED`. Any code in use needs an entry in `FORBIDDEN_DETAIL_CODE_DESCRIPTIONS`, a compile-time gate that also publishes the OpenAPI 403 text.
- **`describe` reads correctly** as the subject of `"<describe> is not available under your organization's permission group"` — a singular noun or gerund agreeing with "is". Exactly two functions build that sentence, both defined in `capabilities.ts` (`refuseCapability` throws it, `capabilityRefusal` returns it); any call site writing it out is a drift finding.

## Step 5: Prove the enforcement — do not assume it

The step the skill exists for. Find the **actual refusal**, name file and line, and say what a caller sees.

```bash
grep -rn "'<capability-id>'" apps/sim --include='*.ts' --include='*.tsx'
grep -rn "permission-group-enforced: <capability-id>" apps/sim
```

The second grep misses a gate whose annotation sits in a TSDoc block above the enclosing statement — read the surrounding function.

Classify into exactly one of:

1. **Declared on operations.** The funnel enforces in `requireCurrentHumanAccess` → `requireCapability`. Verify the set is *complete*: enumerate every route and tool reaching the same behavior. One declaring `capability: 'none'` is the hole.
2. **Asserted at a call site** with a `// permission-group-enforced: <id> — <reason>` annotation. Verify it goes through `capability-assertions.ts` (`assertWorkspaceCapability`, `isWorkspaceCapabilityWithheld`, `isOrganizationCapabilityWithheld`, `capabilityDeniedBy`), through `isCapabilityWithheldForUser` (`lib/permission-groups/user-scope.server.ts` — workspace group first, else the organization's default, for a user-level act that may or may not name a workspace; outside `capability-assertions.ts` on purpose because it reads org membership through the billing graph, a guarded root of `check:application-graph`; `app/api/cli/auth/approve/route.ts` is the shape), or a direct `CAPABILITY_RULES['<id>'].deniedBy(...)` rather than reading `config.disableX` inline, **and** that it *raises* through `refuseCapability` / renders `capabilityRefusal(cap)` rather than building its own `ForbiddenOperationError` with a hand-written message — the easy half to miss, because the decision looks right. Use-case shape: `validatePublicFileSharing`, `validateChatDeployAuth` (`ee/access-control/utils/permission-check.ts`), `assertConnectorTypeAllowed` (`lib/knowledge/application/connectors.ts`). Raw-route shape: `app/api/logs/export/route.ts` and the inbox and api-keys routes; a raw route should render through `capabilityRefusalResponse` (`lib/permission-groups/capability-response.ts`), which reads `details.code` off the rule — a hand-rolled `NextResponse.json({ error: capabilityRefusal(cap) }, { status: 403 })` drops it, reporting the four specifically-coded capabilities (`deploy.chat.auth_mode`, `file_share.publish`, `file_share.auth_mode`, `personal_api_key.use`) as the generic block. v1 is deliberately not converged on it (`resolveCapabilityRefusal` in `app/api/v1/middleware.ts`).
3. **Executor-gated** by `assertPermissionsAllowed`, per block / tool / model, matching through the shared primitives in `lib/permission-groups/` — `block-access.ts`, `operation-access.ts`, `model-access.ts`, `integration-allowlist.ts` — which the editor and Copilot projections read too, so a second copy of a match rule is a finding. Verify the branch throws a real error and that the id it compares against is the vocabulary the admin UI writes — `deniedTools` holds block `tools.access` ids verbatim, version suffix included.
4. **A field projection, not a gate.** `logs.trace_spans` and `logs.cost` withhold fields, so the logs routes correctly declare `capability: 'none'`. Single owner: `lib/logs/log-projection.ts` (`resolveLogFieldProjection`, `projectExecutionData`, `projectCostTotal`), which carries both annotations. A **second** implementation of the same redaction is the finding — as is a query that lets a caller filter or sort on a withheld field, which turns the projection into an oracle.
Ahead of all five: `personal_api_key.use` fits none of them. It withholds a *principal kind* across every operation — the funnel's `personal_api_key` branch (`lib/core/application/workspace-authorization.ts`) and `app/api/v1/middleware.ts` — so no operation declares it and `disablePersonalApiKeys` being absent from every `capability:` field is correct, not a hole.

5. **Nothing.** Report as a defect: "an organization that sets this believes it applied a restriction that does not exist".

Then **make the refusal happen**: write a failing case, or remove the gate (the `capability:` field, the `deniedBy` body, the assertion call) and confirm an existing test goes red. A test that still passes with the gate removed proves nothing. Restore afterward. **Check the fixture's `workspaceOrganizationId` first**: `requireCapability` short-circuits when it is `null` (`lib/core/application/workspace-authorization.ts:171`), so a context that leaves it unset passes either way and the existing test proves nothing even before you touch it.

For an allowlist the three states must be tested separately — `null` permits every member, a populated list only the named ones, `[]` permits **none**. `capabilities.test.ts` pins all three for `knowledge.connectors`; less than that elsewhere is a gap.

### Who the gate runs against

- **`/api/v1`** authorizes in `app/api/v1/middleware.ts`, not through `authorizeWorkspaceOperation`. The subject must come from `capabilityGovernedUserId(rateLimit)`, which returns `null` for a workspace key; `rateLimit.userId` is populated for **both** key kinds and is the key's *creator* for a workspace key, so a gate keyed on the presence of a user id applies a bystander's group to every caller of a shared credential. Reading `rateLimit.userId` (or `auth.userId`) into a capability sink is the finding — `check-capability-subject.ts` exists because it has shipped twice. Each route also threads a required, spelled-out `V1RouteCapability`.
- **Raw internal table routes** gate `tables.use` in `checkAccess` (`app/api/table/utils.ts`) via a `TableAccessPrincipal` union — `{ kind: 'user'; userId }` or `{ kind: 'workspace_api_key'; keyCreatorUserId }` — so a bare id no longer type-checks. `tableAccessPrincipal(rateLimit)` is the one place v1 builds it.
- **The definition-time `undefined` guard** on `defineWorkspaceOperation` is not redundant even though `capability` is required on the `ApplicationOperation` **base type** (`lib/core/application/operation.ts:31`, not merely on the builder — which is what stops a bare-literal factory from compiling): `apps/sim/tsconfig.json` excludes `*.test.ts` / `*.test.tsx` and the enforcement audit walks past test files, so a fixture is the one construction site no static check reads. Without it a capability-less operation defines cleanly and then throws `Cannot read properties of undefined` inside `capabilityDeniedBy` **only for tenants that actually have a permission group**, passing CI and every personal workspace. A proposal to drop it is a finding.

## Step 6: Tests

- **`fields.test.ts`** — the key must be in both the `input` and `expected` halves of the `'a fully populated config'` fixture; that corpus is pinned so a changed row is defended rather than slipping through. The rest of the file derives from `DEFAULT_PERMISSION_GROUP_CONFIG` and needs no per-key edit.
- **`capabilities.test.ts`** — a case for any rule with logic beyond reading one key: subsumption, allowlist three-state, auth-mode membership.
- **`features.test.ts`** — no edit for a boolean; a non-boolean key's `limited` / `empty` prose should be pinned here.
- **`config-scope.server.test.ts`** — the per-request memo. A gate resolving the config outside `resolvePermissionGroupConfig` is a Step 2 finding, not one here.

## Step 7: Run the checks

```bash
bun run check:permission-group-enforcement
bun run check:application-graph
bun run check:capability-subject
cd apps/sim && bun run type-check
cd apps/sim && bunx vitest run lib/permission-groups
```

All three are inside `check:audits`, which derives its list from the `check:*` scripts in `package.json` — a new audit is opted *out* deliberately. Read the output, not the exit codes. Reference success lines (counts grow):

```
✓ permission-group enforcement: 315 operations declare a capability, 35 capabilities all enforced
✅ Application graph clean: 5 roots reach none of 11 forbidden module trees
check:capability-subject — 32 v1 files, 5 capability subjects resolved through capabilityGovernedUserId.
```

| Audit | What it catches |
|---|---|
| `check:permission-group-enforcement` | Every operation declares a capability and every capability is enforced. All-or-nothing — no migration mode exits 0 with work outstanding, so do not go looking for a `pending enforcement:` list |
| `check:application-graph` | The funnel roots (`lib/core/application/index.ts`, `capabilities.ts`, `capability-assertions.ts`, `config-scope.server.ts`) and `with-route-handler.ts` reach no heavy module tree at *runtime* (`import type` is erased and allowed). A gate that imports a resolver into a guarded root is a finding even if the gate is correct; past regressions surfaced only as unrelated tests failing on partial mocks |
| `check:capability-subject` | Every v1 capability sink takes its subject from `capabilityGovernedUserId`, no v1 file outside the middleware imports the permission-group modules, and at least one governed sink was found at all |

Two ways the enforcement audit passes without proving what you want:

- **Vacuous parse.** It reads source text with regexes, so it refuses success when the three registries parse to nothing, cross-checks rule count against capability count, reports per call any unreadable `id`, fails a file that mints an operation but parses to **zero** declarations, and flags any exported `*Operations` registry member it read no operation from. If one fires the audit is broken, not the code — fix the parsers rather than leaving it green. (That last guard exists because an operation minted by a factory that never calls the builder bypasses the required type *and* the audit; twenty-one operations across six domains were invisible that way while the file still printed a tick.)
- **A capability declared on an operation nothing routes to.** Assertion C is satisfied by the declaration alone.

The audits prove *reachability*, never correctness — that a capability is named, a key is read by some rule, a subject came from the right helper. Step 5 is what covers the rest.

## Known gaps — recognize these, do not re-report them

Each is deliberate and documented in the code; `add-permission-group-item` carries the full reasoning.

- **A workspace API key resolves no permission group** — it authorizes as the workspace, so there is no user and `operation.capability` does not apply; the same reasoning shapes `TableAccessPrincipal`, `capabilityGovernedUserId` and the log projection. Substituting the key's creator would apply a bystander's group to every caller of a shared key and break the key when that person left. Minting a workspace key is itself capability-gated.
- **An executor delegation carries role but not capabilities** — a delegated `executor` principal with a `sim_user` subject goes through `requireCurrentHumanRole` only. A capability names what a *person* may reach; applying it to a run makes "hide Tables" a kill-switch for every workflow with a Table block.
- **An actorless deployment run passes through** — a delegated executor principal in `mode: 'deployment'` with no resolvable subject acts with the workspace's authority; denying would 403 every scheduled run, webhook and public-API call. What such a run *does* is still governed by `assertPermissionsAllowed`, which is why the four run-scoped keys carry `enforcement: 'executor'`.
- **Copilot is NOT exempt** — a delegated principal with a `sim_user` subject whose `serviceId` is anything other than `executor` takes the full `requireCurrentHumanAccess`. Copilot acts as the person. A proposal to exempt it is a finding.
- **Capability is checked after the role check** — `NoWorkspaceAccessError` is concealed as a 404 by the v2 surface, so refusing on capability first would hand a non-member an oracle for what the organization withholds. The v1 middleware states the same ordering in its TSDoc. Not a bug.
- **`allowedEgressHosts` does not exist** — there is no network-egress allowlist. Requests for one are a feature, not missing wiring.
- **Nothing currently ships as `ui-only`** — the union member has no user; an absent `ui-only` key is not a gap.

## Report Format

1. **Kind and enforcement** — as declared, and whether the declaration is true.
2. **The refusal** — file, line, error thrown, what the caller sees (status, `detailCode`, message). Or: it is a projection, and here is its single owner. Or: nothing refuses.
3. **The subject** — whose user id the gate reads, and that a workspace key reaches it ungated rather than as its creator.
4. **Proof** — the test that fails when the gate is removed, or that no such test exists.
5. **Coverage gaps** — routes, tools, surfaces reaching the same behavior without the gate.
6. **Findings**, ordered: unenforced key > key-creator substituted for the acting principal > fail-open coercion (`.catch()` on an array, a dropped `Array.isArray` guard, `CAPABILITY_RULES` annotated instead of `satisfies`) > incomplete operation coverage > allowlist three-state confusion > **admin copy that misstates the enforcement** > duplicated projection logic > missing admin UI > missing test > cosmetic.

A hint saying "hide" for a key that 403s is not cosmetic — it is the one defect an admin acts on directly: they tick it believing they hid a link, and members lose the module. Rank it with the enforcement findings.
