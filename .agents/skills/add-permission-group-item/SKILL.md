---
name: add-permission-group-item
description: Add a new governed item to Sim's enterprise permission groups — a boolean restriction, an allowlist, or a denylist — wired end-to-end from the field registry through the capability rule to the server gate that actually refuses. Use when adding a key to `PERMISSION_GROUP_FIELDS` or a capability to `CAPABILITY_RULES`.
argument-hint: <what-to-restrict>
---

# Add Permission Group Item Skill

You are adding one governed item an organization admin can withhold from a cohort of members. One entry in `apps/sim/lib/permission-groups/fields.ts` produces the write schema, the read schema, the `PermissionGroupConfig` type, the defaults, the tolerant parser, and (for a boolean) the admin editor row.

**The registry does not produce enforcement.** Twelve keys once shipped with a checkbox, a hint, and no server check — an organization that ticked `hideCopilot` believed it had withheld a capability while every route still answered. Hence the `enforcement` field, the required `capability` field on every operation, and `scripts/check-permission-group-enforcement.ts`. You are done when something *refuses*, not when the key parses.

## Read the system first

- `lib/permission-groups/fields.ts` — registry, three field builders, `permissionGroupConfigSchema`, `tolerantArray`, `parsePermissionGroupConfig`. There is **no `types.ts`** (folded in here); the DB constraint maps live in `constraints.ts`
- `lib/permission-groups/capabilities.ts` — `CAPABILITY_IDS`, `CAPABILITY_RULES`, `capabilityRefusal`, `refuseCapability`, the static/parameterized split
- `lib/permission-groups/capability-assertions.ts` — the sanctioned assertion API; re-exports `capabilityRefusal`. `capability-error.ts` holds the thrown error, `capability-response.ts` the raw-route 403
- `lib/permission-groups/integration-allowlist.ts` — the canonicalizing allowlist algebra, over the generated `block-successors.generated.ts`
- `lib/permission-groups/resolve.server.ts` — `resolveWorkspaceGroup`, `resolveVerifiedUserAccessControlContext`, `getUserPermissionConfig`, `getUserPermissionConfigForOrganization`, `mergeEnvAllowlist`. `ee/access-control/utils/permission-check.ts` re-exports it and keeps the executor gates
- `lib/permission-groups/config-scope.server.ts` (`resolvePermissionGroupConfig`, the per-request memo every assertion resolves through) and `request-scope.server.ts` (`withPermissionGroupScope`, deliberately import-free because `withRouteHandler` imports it)
- `lib/core/application/workspace-operation.ts` and `workspace-authorization.ts` — the required `capability` field, and the funnel
- `scripts/check-permission-group-enforcement.ts`, `check-application-graph.ts`, `check-capability-subject.ts`

(Paths are under `apps/sim/` unless noted.)

## Step 0: Decide what kind of thing it is

| Kind | Builder | Default | Semantics |
|---|---|---|---|
| Boolean restriction | `booleanRestriction(enforcement, feature)` | `false` | `true` withholds. Name it `hideX` / `disableX`, never `allowX` |
| Allowlist | `allowlist(item, enforcement, { limited, empty })` | `null` | `null` allows everything; a list names the only permitted members; `[]` permits **none** |
| Denylist | `denylist(item, enforcement, phrasing)` | `[]` | Empty permits everything; members are refused |

Allowlist when the safe posture is "only what the admin named" and the member set is enumerable (auth modes, connectors, model providers). Denylist when it is "everything except" and the set is open-ended (tool ids, models — an allowlist over a thousand tools grows a hole every time a tool ships).

**Which mechanism refuses?** The `enforcement` value is a claim the audit checks.

| Value | Meaning |
|---|---|
| `'capability'` | An operation declares a capability whose rule reads the key; the funnel refuses before the use case runs. Default answer for anything reachable through an application operation |
| `'executor'` | Read per block/tool/model at run time by `assertPermissionsAllowed` in `ee/access-control/utils/permission-check.ts`. Governs what a *run* may do, which no operation gate can express (one API call executes fifty blocks). Only `allowedIntegrations`, `allowedModelProviders`, `deniedModels`, `deniedTools` live here. The matching primitives these four keys are compared with live in `lib/permission-groups/` — `block-access.ts` (exemptions, superseded-version resolution), `operation-access.ts` (`createToolAccessGate`), `model-access.ts` (`createModelAccessGate`), `integration-allowlist.ts` — shared so the run-time gate and the editor/Copilot projections cannot drift. `allowedIntegrations` alone is also asserted outside a run, by `assertSelectorIntegrationAllowed` (`lib/selectors/server/integration-access.ts`) ahead of the provider call in `selectors.execute`, against the selector's own `resourceServiceId` / `integrationBlockTypes` rather than the credentials it accepts — reaching a provider API is a use of the integration, so a key here can still need a non-run enforcement site |
| `'ui-only'` | Hides a surface without withholding it. **Almost never right** — nothing ships as `ui-only`. Justify in the `enforcement` comment why a determined caller reaching the data is acceptable, and expect review to question it |

**Is it per-operation at all?** `personal_api_key.use` is the one capability that is not: it withholds a *principal kind* across every operation, checked in the funnel's `personal_api_key` branch (`workspace-authorization.ts`) and again in `app/api/v1/middleware.ts`, so no operation declares it and its absence from every `capability:` field is correct rather than a hole.

**Is the decision knowable from the config alone?** A rule needing a request value (an auth mode, a connector id) is *parameterized* and cannot be declared on an operation — see Step 3.

**Is it a gate or a projection?** A key that withholds *fields from a response* rather than the response is a projection. `hideTraceSpans` and `hideCostInfo` work this way: the logs routes declare `capability: 'none'` and strip fields, because refusing the read would withhold the status and error message too. Projections have one owner — `lib/logs/log-projection.ts` (`resolveLogFieldProjection`, `projectExecutionData`, `projectCostTotal`), carrying the `permission-group-enforced:` annotations. Add yours there; two copies of a redaction rule is how one of them stops redacting. Corollary: refuse the query that *selects on* a withheld field — otherwise the projection is a filter oracle; `logQuerySelectsCost` / `assertLogCostQueryAllowed` in that same module are the shape.

## Step 1: Append the field entry — never insert

```ts
  disableWidgetSharing: booleanRestriction('capability', {
    id: 'disable-widget-sharing',
    label: 'Widget Sharing',
    category: 'Collaboration',
    hint: 'Prevent sharing a widget outside the workspace.',
  }),
```

The second argument is the field's `feature` (`PlatformFeatureMeta`); `PLATFORM_FEATURES` spreads it and appends `configKey`, so those four values are what the editor renders. `PLATFORM_FEATURES` is *derived* from the registry in `features.ts`, so a boolean key cannot reach the config without reaching the editor.

- **Declaration order is the wire order** of `PermissionGroupConfig`, both zod schemas, and every config JSON crossing the API. `fields.test.ts` pins it with a key-order contract test, and `ee/access-control/components/group-detail.tsx` dirty-checks by comparing stringified configs — a moved key fails the suite *and* makes every open editor read as unsaved. Extend the tail; do not tidy the middle.
- **The default must be the permissive value.** Every stored `permission_group.config` row predates your key; `parsePermissionGroupConfig` fills the gap from the default and the update route merges a partial write over the stored config, so a restrictive default silently applies a new restriction to every existing group in every enterprise org. The builders hardcode `false` / `null` / `[]`, so a new key must be *phrased* so the permissive value is falsy: a `requireWidgetApproval` whose safe default is `true` must be inverted before it can use `booleanRestriction`.
- **The checkbox is inverted.** `group-detail.tsx` renders `checked={!editingConfig[feature.configKey]}` — ticked means *allowed*, so an `allowX` name renders backwards.
- **The hint must describe access withheld, never a surface hidden.** A `'capability'` key refuses at the API; "Hide the Tables module from the sidebar" tells an admin they are tidying a nav bar while they revoke a module. The same string is read again by `getActivePermissionGroupRestrictions` in `features.ts` as the prose for an *active* restriction — reaching users through the Copilot workspace VFS and the enterprise platform context — where "hide" is simply false. Write "Revoke the Tables module. Members cannot read or write any table." `PlatformFeatureMeta.hint` carries the rule in its TSDoc.
- **The category must be in `PLATFORM_CATEGORY_ORDER`** (`features.ts`): `Modules`, `Knowledge Base`, `Tables`, `Files`, `Deployment`, `Tools`, `Logs`, `Collaboration`, `Credentials & Access`. An unlisted category renders last. Categories name what is withheld — no surface-shaped section like "Sidebar".

## Step 2: Only booleans get an admin UI for free

`PLATFORM_FEATURES` filters on `field.kind === 'boolean-restriction'`. An allowlist or denylist renders **nothing** — the key exists, the API accepts it, no admin can set it.

Nested pickers hang off the `featureExtras` map in `group-detail.tsx`, keyed by the **feature id of the boolean it nests under**, not the allowlist's own config key:

```ts
  const featureExtras: Partial<Record<string, ReactNode>> = {
    'hide-knowledge-base': <AllowlistField label='…' value={knowledgeConnectorValue}
      onChange={setKnowledgeConnectors} options={KNOWLEDGE_CONNECTOR_OPTIONS}
      disabled={editingConfig.hideKnowledgeBaseTab} />,
  }
```

Copy `setKnowledgeConnectors`. Two load-bearing behaviors:

- **Refuse an empty selection** (`if (values.length === 0) return`) — an emptied allowlist denies everyone while the parent checkbox still reads as allowed. Withholding the whole thing is what the parent is for.
- **Collapse "all selected" back to `null`** (`values.length === ALL.length ? null : values`) — storing the full set freezes the allowlist at today's members.

Choose the parent deliberately: `allowedKnowledgeConnectors` nests under `hide-knowledge-base`, not `disable-knowledge-base-creation`, because a connector attaches to an *existing* KB — nesting under creation would dim the picker for exactly the cohort it serves.

## Step 3: Add the capability id and rule

Skip only for `'executor'` / `'ui-only'`. Add the id to `CAPABILITY_IDS` and the rule to `CAPABILITY_RULES` in `capabilities.ts`, which uses `satisfies { readonly [K in PermissionGroupCapability]: CapabilityRule }` so a new id fails to compile until its rule exists.

**Never replace that `satisfies` with a type annotation.** Annotating widens every entry to `CapabilityRule`, at which point `StaticPermissionGroupCapability` — derived by filtering the object's own entries for `kind: 'static'` — resolves to **`never`**: no operation can declare any capability, the type system goes quiet about capabilities entirely, and nothing at runtime looks wrong. `AssertsStaticCapabilityResolves` at the bottom of the file exists to catch it. Same reasoning for any of these registries.

Capability ids are **domain-shaped** (`tables.create`); config keys are **surface-shaped** (`disableTableCreation`). `CAPABILITY_RULES` is the only place the two vocabularies meet.

```ts
  'widgets.share': {
    kind: 'static',
    configKeys: ['disableWidgetSharing'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Sharing widgets',
    deniedBy: (config) => config.disableWidgetSharing,
  },
```

`configKeys` is what the audit reads to prove your key is enforced — it must list every key `deniedBy` reads. `describe` is the subject of one shared sentence, `"<describe> is not available under your organization's permission group"`, so make it a singular noun or gerund that agrees with "is". Exactly two functions build it, both defined in `capabilities.ts`: `refuseCapability(cap)` throws it as a `PermissionGroupCapabilityError`; `capabilityRefusal(cap)` returns it as a string for a raw route rendering its own body (`capability-assertions.ts` re-exports it so an inline gate reaches both through one module). Never write the sentence at a call site.

Use `'PERMISSION_GROUP_CAPABILITY_BLOCKED'` for `detailCode`. Four rules carry a more specific one — `deploy.chat.auth_mode` (`CHAT_AUTH_MODE_NOT_PERMITTED`), `file_share.publish` / `file_share.auth_mode` (`PUBLIC_SHARING_NOT_ALLOWED`), `personal_api_key.use` (`PERSONAL_API_KEYS_DISABLED`) — which is why a call site reads the code off the rule and never spells one out. The set in `lib/core/application/forbidden.ts` is closed **over remedies, not causes** — a new code is warranted only when the remedy differs from "ask an organization admin", and requires an entry in `FORBIDDEN_DETAIL_CODE_DESCRIPTIONS` (a compile-time gate) plus a new value in the generated OpenAPI 403 description.

A **parameterized** rule is the same shape with `kind: 'parameterized'` and a `deniedBy` taking the request value second — `'knowledge.connectors'` is `(config, connectorType) => allowlistDenies(config.allowedKnowledgeConnectors, connectorType)`. It **cannot be declared on an operation**: the funnel decides from principal, workspace and operation, never request input, and widening it would touch every one of the hundreds of operations for the sake of two keys. `defineWorkspaceOperation` throws at definition time (`Operation <id> declares parameterized capability <cap>; assert it from the use case instead`) rather than letting the operation read as gated while the gate never fires.

## Step 4: Declare it on the operations it governs, or assert it at the call site

`capability` is **required on the `ApplicationOperation` base type** (the `capability` field in `lib/core/application/operation.ts`), typed `StaticPermissionGroupCapability | 'none'` — required there, not only on `defineWorkspaceOperation`, so a bare object literal minted by a domain factory does not compile without it — *and* guarded at definition time (`Operation <id> declares no capability; name one, or 'none' with a reason`). The guard is not redundant: **`apps/sim/tsconfig.json` excludes `*.test.ts` / `*.test.tsx` from type-checking** and the enforcement audit walks past test files, so a fixture is the one construction site no static check reads. An absent capability does not deny — it throws `Cannot read properties of undefined` inside `capabilityDeniedBy`, and **only for a caller whose organization actually has a permission group**. It passes CI and every personal workspace, then fails in the tenants that bought the feature.

**Static, and the operation is the whole decision** — set `capability` and write no gate code:

```ts
export const shareWidget = defineWorkspaceOperation({
  id: 'widgets.share',
  minimumRole: 'write',
  workspaceApiKey: 'allow',
  capability: 'widgets.share',
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key'],
})
```

**The factory trap.** An operation minted by a factory that does not call `defineWorkspaceOperation` — a hand-frozen object — bypasses the required type *and*, once bypassed, the audit. The audit therefore matches the whole `define<Domain>Operation` family, resolves a same-file `function` factory (capability fixed in the body or taken as a positional second argument — `lib/table/application/operations.ts` shows both, with **no default** on the positional form so nothing inherits `tables.use` unreviewed), and cross-checks the members of every exported `*Operations` registry against what it parsed, so a registry member it read no operation from is a finding rather than a tick. Keep new operations inside an exported `*Operations` registry, mint them through a `define*Operation` builder taking an object literal with a string `id`, and use a `function` factory rather than an arrow const.

**Static, but no operation to hang it on** — a raw route or an organization-level action.

| Helper | Use when |
|---|---|
| `assertWorkspaceCapability(userId, workspaceId, cap, organizationId?)` | inside a use case — the thrown `PermissionGroupCapabilityError` is projected to a 403 for you |
| `isWorkspaceCapabilityWithheld(userId, workspaceId, cap, organizationId?)` | a raw handler rendering its own body — pair with `capabilityRefusal(cap)` |
| `isOrganizationCapabilityWithheld(organizationId, cap)` | an action naming an organization rather than a workspace |
| `isCapabilityWithheldForUser(userId, cap, workspaceId?)` (`lib/permission-groups/user-scope.server.ts`) | a user-level act that *may or may not* name a workspace — a personal API key, a CLI device-auth handoff. Resolves the workspace's group when given one, else falls back to the organization's default group rather than going ungoverned. Deliberately outside `capability-assertions.ts`: it reads org membership through the billing graph, and that module is a guarded root of `check:application-graph` |
| `capabilityDeniedBy(cap, config)` | you already hold a resolved config |

Annotate the call site either way:

```ts
    // permission-group-enforced: logs.export — raw streaming route, no workspace operation to declare it on
    if (capabilityDeniedBy('logs.export', permissionConfig)) {
      return capabilityRefusalResponse('logs.export')
    }
```

`capabilityRefusalResponse` (`lib/permission-groups/capability-response.ts`) is the one builder for that 403 — it renders `capabilityRefusal(cap)` *and* reads `details.code` off the rule, so a hand-rolled `NextResponse.json({ error: … }, { status: 403 })` reports the four specifically-coded capabilities as the generic block. v1 is deliberately not converged on it (`resolveCapabilityRefusal` in `app/api/v1/middleware.ts` renders v1's own `{ error: { code, message } }` envelope).

`isOrganizationCapabilityWithheld` resolves through `getUserPermissionConfigForOrganization`, reading the organization's **default** group — a non-default group targets specific workspaces. It sits outside the per-request memo because that memo is keyed by user and workspace, and this decision is keyed by organization alone.

**Parameterized** — the helpers above are all typed `StaticPermissionGroupCapability`, so write a module-local wrapper that reads the rule and raises through `refuseCapability`, and annotate the call site. `assertConnectorTypeAllowed` in `lib/knowledge/application/connectors.ts` is the shape:

```ts
const RULE = CAPABILITY_RULES['knowledge.connectors']
if (!userId) return
const config = await resolvePermissionGroupConfig(userId, workspaceId, undefined)
if (config && RULE.deniedBy(config, connectorType)) refuseCapability('knowledge.connectors')
```

Always route through `CAPABILITY_RULES` and raise with `refuseCapability` — a config key spelled out inline silently stops denying when renamed, and a hand-written message drifts from the funnel's. `validatePublicFileSharing` and `validateChatDeployAuth` in `ee/access-control/utils/permission-check.ts` are the other two examples. Return early on a missing `userId`: a permission group is a membership of users, so an actorless caller resolves none, and throwing there turns a scheduled sync into a 500 instead of a refusal anyone can act on.

**Genuinely ungoverned** — write `capability: 'none'` with a `// permission-group-exempt: <reason>` comment directly above it (`'none'` is spelled out because an absent field cannot be told apart from an unreviewed one). A good reason names why no key applies *and* why a gate would be wrong: *"the executor's own per-run store; no group key names it, and refusing would fail runs the group allows"*.

### Surfaces that do not go through the funnel

**Whose group applies — never `userId` off whatever identity is nearest.** Each helper below returns `null` for a caller no group governs (workspace key, internal JWT, executor delegation), and `null` is a *pass*, not a denial.

| You hold | Helper |
|---|---|
| `Principal` | `capabilityGovernedPrincipalUserId` (`lib/core/application`) — mirrors the funnel exactly, executor exemption included |
| v1 `RateLimitResult` | `capabilityGovernedUserId(rateLimit)` (`app/api/v1/middleware.ts`) — branches on `keyType`, never on the presence of `userId` |
| `TableAccessPrincipal` | `capabilityGovernedUserId(principal)` (`app/api/table/utils.ts`) |
| `AuthResult` from `checkSessionOrInternalAuth` | `capabilityGovernedAuthUserId` (same file) — an internal JWT's `userId` is the run's actor, a bystander |

When the subject is **persisted and read back later** — the table dispatch pipeline stamps it on `table_run_dispatches` / `table_row_executions` so auto-fired cells run under the person the write was gated for — declare it `capabilityGovernedUserId: string | null`, required with an explicit `null` and never optional. An optional field with a fallback is how every producer that had not been taught the distinction silently inherited `triggeredByUserId`, an *attribution* naming the billed account; making omission a compile error is the whole enforcement. A persisted subject also has a lifecycle: `lib/users/account-deletion.ts` cancels the dispatches stamped with a deleted user.

- **`/api/v1`** authorizes in `app/api/v1/middleware.ts`. Every route threads a `V1RouteCapability` (`StaticPermissionGroupCapability | 'none'`, required and spelled out) whose value must match what its v2 or internal counterpart declares — v1 gets no mapping of its own. `check-capability-subject.ts` audits v1's subjects only, because the bug has shipped and been fixed twice there.
- **Raw internal table routes** (`/api/table/**`) share one gate in `checkAccess` (`app/api/table/utils.ts`), whose signature takes a `TableAccessPrincipal` union — `{ kind: 'user'; userId }` or `{ kind: 'workspace_api_key'; keyCreatorUserId }` — so a bare id does not type-check and only the kind that says so skips the gate. `tableAccessPrincipal(rateLimit)` builds it for v1.
- **The route-wrapper graph.** `withRouteHandler` imports `request-scope.server.ts` and nothing heavier. Import a resolver at the *call site*, never from the wrapper or `lib/core/application` — see Step 6.

## Step 5: Add it to the golden corpus

Add the key to **both** the `input` and `expected` objects of the `'a fully populated config'` fixture in `lib/permission-groups/fields.test.ts`, set to a non-default value. That fixture is the pinned coercion corpus: a row that changes in a later diff is a semantic decision someone defends rather than a silent regression. The file's other assertions derive from `DEFAULT_PERMISSION_GROUP_CONFIG` (wire order, idempotence, read-schema acceptance, the 2000-iteration seeded fuzz, write/default/read key-set agreement, boolean-to-`PLATFORM_FEATURES` coverage) and pick your key up for free, as does `features.test.ts`.

**Give the funnel test a real `workspaceOrganizationId`.** `requireCapability` short-circuits on `context.workspaceOrganizationId === null` (`lib/core/application/workspace-authorization.ts:204`), so a fixture whose workspace context leaves it null passes with the gate present *and* with it removed — a vacuous test that reads as load-bearing.

Add a case to `capabilities.test.ts` for any rule with logic beyond reading one key. For an allowlist assert all three states — `null` permits every member, a populated list only the named ones, `[]` permits **none** — as `capabilities.test.ts` already does for `knowledge.connectors`.

## Step 6: Keep the graph light

`scripts/check-application-graph.ts` walks **runtime** `import` / `export … from` edges (`import type` is erased and allowed) out of five guarded roots:

| Guarded root | Forbidden |
|---|---|
| `lib/core/application/index.ts`, and `lib/permission-groups/` `capabilities.ts` / `capability-assertions.ts` / `config-scope.server.ts` | `providers/`, `blocks/`, `tools/`, `executor/`, `lib/uploads/`, `lib/workflows/` |
| `lib/core/utils/with-route-handler.ts` | those six **plus** `lib/billing/`, `lib/permission-groups/resolve.server`, `lib/auth`, `lib/copilot/`, `lib/knowledge/` |

`lib/billing/` stays allowed for the funnel roots because `resolve.server.ts` legitimately reads the subscription to decide whether an organization is on an enterprise plan; the wrapper is a lifecycle shim that opens the memo scope and nothing more. That split is why the scope is two files.

Breaking this never announces itself — past regressions surfaced only as unrelated tests failing on partial mocks of modules they never meant to load. After adding an import, run this audit first.

## Step 7: Verify

```bash
bun run check:permission-group-enforcement
bun run check:application-graph
bun run check:capability-subject
cd apps/sim && bun run type-check
cd apps/sim && bunx vitest run lib/permission-groups
```

Also `bun run check:api-validation` if you touched a contract or the group routes. `bun run check:audits` runs all of these; it derives its list from the `check:*` scripts in `package.json`, so a new audit is opted *out* deliberately rather than opted in.

Read the success lines, not the exit codes — the operation and capability counts should each have grown by one:

```
✓ permission-group enforcement: <N> operations declare a capability, <M> capabilities all enforced
✅ Application graph clean: <N> roots reach none of <M> forbidden module trees
check:capability-subject — <N> v1 files, <M> capability subjects resolved through capabilityGovernedUserId.
```

The enforcement audit is all-or-nothing — one success line or findings, no migration mode that exits 0 with work outstanding. Because it reads source text it also refuses success when its own parsers come up empty or disagree with each other; if a self-check fires, teach the parsers the new form rather than working around it.

The audits prove *reachability*: your capability is named somewhere, your key is read by some rule. They cannot tell whether the rule's logic is right or whether every operation reaching the behavior declares it. Green is not proof the gate fires.

## Traps

**An operation carries exactly ONE capability, and a narrower capability must subsume the broader one it replaced.** `knowledge.create` and `knowledge.upload` list `configKeys: ['disableKnowledgeBaseCreation', 'hideKnowledgeBaseTab']` and OR both in `deniedBy`, because moving KB creation off `knowledge.use` would otherwise let a group that withheld the whole module still create one through the API. Any time you re-point an operation to a more specific capability, the specific rule must read both keys.

**`.catch()` on an array field is a fail-open security bug.** `z.array(item).catch(fallback)` is whole-value tolerant: one bad member discards every good one. On an allowlist the fallback is `null`, and `null` means **unrestricted** — a partly corrupt allowlist stops restricting anything. `tolerantArray` in `fields.ts` filters element by element, keeping what parses and failing closed. Never swap it for `.catch()`, never hand-roll a parallel coercion path.

**`parsePermissionGroupConfig` must keep its `Array.isArray` guard.** `typeof [] === 'object'`, so a truthy-object check alone lets an array through and `z.object().parse([])` throws — reachable, because the column is `jsonb` and a row can genuinely hold `[]`. The guard returns the defaults there instead of taking down the request. `tolerantArray` carries the mirror-image guard.

**An empty allowlist denies everything; `null` allows everything.** They must never collapse — not in the parser, the UI setter, or a `deniedBy`. `allowlistDenies` encodes it as `allowed !== null && !allowed.includes(member)`; a `?? []` anywhere on this path inverts the unrestricted case.

**Canonicalize both halves of an integration allowlist *before* intersecting, never after.** `allowedIntegrations` and the deployment's `ALLOWED_INTEGRATIONS` are written independently, so one can name `slack` and the other `slack_v2`; fold only case and they intersect to nothing, hiding an integration both policies allow. Compose `intersectAccessControlAllowlists` / `toAccessControlAllowlist` / `resolveAccessControlBlockType` from `integration-allowlist.ts` — never a hand-rolled `Set` intersection — and successor-resolve the type you test against the result the same way. They resolve through `block-successors.generated.ts`, a projection of the block registry because `check:application-graph` forbids the funnel from importing `blocks/`; `check:block-successors` fails the build when it drifts. Read that map only through `Object.hasOwn`: the ids arriving are admin-supplied jsonb, and a group naming `constructor` otherwise gets back an inherited function and 500s every enforcement path that reads it.

**Not everyone goes through the funnel.**

| Principal | Rule |
|---|---|
| **Workspace API key** | Authorizes as the workspace — no user, so no group resolves and `operation.capability` does not apply. **Never substitute the key's creator** (not in the funnel, `checkAccess`, v1, or the log projection): it applies a bystander's group to every caller of a shared key and breaks the key when that person leaves. The escape is closed at the door — minting a workspace key is itself capability-gated |
| **Delegated `executor` with a `sim_user` subject** | **Role only** (`requireCurrentHumanRole`). A run carries the trigger-er's role but not their capabilities: a capability names what a *person* may reach, while a run reaches resources because a block does. Applying capabilities would make "hide Tables" a kill-switch breaking every workflow with a Table block |
| **Actorless deployment run** (delegated executor, `mode: 'deployment'`, no subject) | Passes through — a deployed workflow acts with the workspace's authority, not its author's group. Denying would 403 every scheduled run, webhook and public-API call the moment a group withheld anything |
| **Copilot** | **NOT exempt.** A delegated principal with a `sim_user` subject whose `serviceId` is anything other than `executor` takes the full `requireCurrentHumanAccess`, capability check included. Copilot acts *as the person* |

What a run *does* is still governed by `assertPermissionsAllowed`. An item that must bind a deployed run belongs at `enforcement: 'executor'`.

**Capability is checked after the role check, on purpose.** `requireCurrentHumanAccess` runs `requirePermission` first. `NoWorkspaceAccessError` is concealed as a 404 by the v2 surface so a non-member cannot learn the resource exists; refusing on capability first hands an outsider an oracle for which capabilities the organization withholds. Do not reorder, and do not add a capability check upstream of the role check in a raw route — the v1 middleware states the same rule in its TSDoc.

## Checklist Before Finishing

- [ ] Kind and `enforcement` chosen deliberately; `ui-only` justified in writing if used
- [ ] It is a gate, not a projection — a projection belongs in `lib/logs/log-projection.ts` with `capability: 'none'` on the routes, and still refuses queries that select on the withheld field
- [ ] Entry **appended** to `PERMISSION_GROUP_FIELDS`, permissive default, restriction-phrased name
- [ ] Category present in `PLATFORM_CATEGORY_ORDER`, named after what is withheld
- [ ] `hint` says what access is revoked, never "hide" — it is also the active-restriction prose
- [ ] Non-boolean key has a `featureExtras` picker that refuses empty and collapses "all" to `null`
- [ ] Capability id in `CAPABILITY_IDS`, rule in `CAPABILITY_RULES` under `satisfies`, `configKeys` lists every key `deniedBy` reads
- [ ] A narrower capability replacing a broader one also reads the broader key
- [ ] Declared on every operation it governs, or asserted from the use case with a `// permission-group-enforced:` annotation raising through `refuseCapability` / `capabilityRefusal`
- [ ] New operations minted through a `define*Operation` builder and exported from an `*Operations` registry
- [ ] Any `capability: 'none'` carries a `// permission-group-exempt:` reason
- [ ] Every gate's subject comes from the `capabilityGoverned*` helper for the identity it holds, and a persisted subject is a required `string | null`
- [ ] v1 routes thread the capability through `middleware.ts`; table routes pass a `TableAccessPrincipal`
- [ ] An integration-shaped allowlist canonicalizes through `integration-allowlist.ts` on both sides of every comparison
- [ ] Added to the `'a fully populated config'` fixture in `fields.test.ts`, input and expected
- [ ] Allowlist three-state (`null` / populated / `[]`) covered in `capabilities.test.ts`
- [ ] No new runtime import from a guarded root into a forbidden tree
- [ ] All three audits pass and name your capability; `type-check` clean, `lib/permission-groups` suite green
