---
name: add-permission-group-item
description: Add a new governed item to Sim's enterprise permission groups — a boolean restriction, an allowlist, or a denylist — wired end-to-end from the field registry through the capability rule to the server gate that actually refuses. Use when adding a key to `PERMISSION_GROUP_FIELDS` or a capability to `CAPABILITY_RULES`.
argument-hint: <what-to-restrict>
---

# Add Permission Group Item Skill

You are adding one governed item to the enterprise permission-group system: something an organization admin can withhold from a cohort of members. The system is registry-driven — one entry in `apps/sim/lib/permission-groups/fields.ts` produces the write schema, the read schema, the `PermissionGroupConfig` type, the defaults, the tolerant parser, and (for a boolean) the admin editor row.

**What the registry does not produce is enforcement.** Twelve keys once shipped with an admin checkbox, a hint describing what they restrict, and no server check at all — an organization that ticked `hideCopilot` believed it had withheld a capability while every API route still answered. That failure is the reason for the `enforcement` field, the `capability` field on every operation, and `scripts/check-permission-group-enforcement.ts`. Your job is not done when the key parses; it is done when something refuses.

## Read the system first

Read these completely before editing. Do not infer their shape from this document.

- `apps/sim/lib/permission-groups/fields.ts` — the registry, the three field builders, `permissionGroupConfigSchema`, the tolerant parser. There is **no `types.ts`**; it was folded into this file, and the two DB constraint maps live in `constraints.ts`
- `apps/sim/lib/permission-groups/capabilities.ts` — `CAPABILITY_IDS`, `CAPABILITY_RULES`, `capabilityRefusal`, `refuseCapability`, the static/parameterized split
- `apps/sim/lib/permission-groups/capability-assertions.ts` — the sanctioned way to ask whether a group withholds something (and it re-exports `capabilityRefusal`)
- `apps/sim/lib/permission-groups/resolve.server.ts` — group resolution: `resolveWorkspaceGroup`, `resolveVerifiedUserAccessControlContext`, `getUserPermissionConfig`, `getUserPermissionConfigForOrganization`, `mergeEnvAllowlist`. This moved out of `ee/`; `ee/access-control/utils/permission-check.ts` now only re-exports it and keeps the executor gates
- `apps/sim/lib/permission-groups/config-scope.server.ts` — `resolvePermissionGroupConfig`, the per-request memo every assertion resolves through
- `apps/sim/lib/permission-groups/request-scope.server.ts` — the light half of the scope: `withPermissionGroupScope` and the store, deliberately free of runtime imports because `withRouteHandler` imports it
- `apps/sim/lib/core/application/workspace-operation.ts` — `capability` is a **required** field on `defineWorkspaceOperation`, typed `StaticPermissionGroupCapability | 'none'`, with a definition-time guard
- `apps/sim/lib/core/application/workspace-authorization.ts` — where the funnel enforces, and who passes through
- `scripts/check-permission-group-enforcement.ts`, `scripts/check-application-graph.ts`, `scripts/check-capability-subject.ts` — the three audits you have to satisfy, all inside `check:audits`

## Step 0: Decide what kind of thing it is

Three questions, in order. Answer all three before writing any code.

**What shape is the value?**

| Kind | Builder | Default | Semantics |
|---|---|---|---|
| Boolean restriction | `booleanRestriction(enforcement, feature)` | `false` | `true` withholds. Named `hideX` / `disableX`, never `allowX` |
| Allowlist | `allowlist(item, enforcement, { limited, empty })` | `null` | `null` allows everything; a set names the only permitted members; `[]` permits nothing |
| Denylist | `denylist(item, enforcement, phrasing)` | `[]` | Empty permits everything; members are refused |

Choose an allowlist when the safe posture is "only what the admin named" and the member set is enumerable and stable (auth modes, connectors, model providers). Choose a denylist when the safe posture is "everything except what the admin named" and the member set is open-ended (individual tool ids, individual models — an allowlist over a thousand tools is unmaintainable and grows a hole every time a tool ships).

**Which mechanism refuses?** This is the `enforcement` value and it is a claim the audit checks.

- `'capability'` — an operation declares a capability whose rule reads the key, so the authorization funnel refuses before the use case runs. This is the default answer for anything reachable through an application operation.
- `'executor'` — read per block, tool, or model at execution time by `assertPermissionsAllowed` in `apps/sim/ee/access-control/utils/permission-check.ts`. It governs what a *run* may do, which no operation-level gate can express: one API call can execute fifty blocks. `allowedIntegrations`, `allowedModelProviders`, `deniedModels`, and `deniedTools` are the four that live here.
- `'ui-only'` — the key hides a surface without withholding it, so a caller who skips the UI still reaches the API. **Almost never the right answer.** Choose it only when you can say, in the `enforcement` comment, why a determined caller reaching the data anyway is acceptable. Nothing currently ships as `ui-only` — the union member exists and has no user; if yours is the first, expect that to be questioned in review.

**Is the decision knowable from the config alone?** A rule that needs a value only the request carries — an auth mode, a connector id, a file id — is *parameterized*, and parameterized rules cannot be declared on an operation. See Step 3.

**Is it a gate at all, or a projection?** A key that withholds *fields from a response* rather than the response itself is a projection, not a gate. `hideTraceSpans` and `hideCostInfo` work this way: every logs route declares `capability: 'none'` and strips fields instead, because refusing the read would withhold the status and the error message too, which is not what an organization restricting execution detail or spend visibility asked for. The projections live in one place — `apps/sim/lib/logs/log-projection.ts`, which owns `resolveLogFieldProjection`, `projectExecutionData` and `projectCostTotal` and carries the `permission-group-enforced:` annotations for both capabilities. If your key is a projection, add it there rather than to an operation; two copies of a redaction rule is how one of them stops redacting.

## Step 1: Add the field entry — at the end

Append one entry to `PERMISSION_GROUP_FIELDS`. **Append, never insert.**

```ts
  disableWidgetSharing: booleanRestriction('capability', {
    id: 'disable-widget-sharing',
    label: 'Widget Sharing',
    category: 'Collaboration',
    hint: 'Prevent sharing a widget outside the workspace.',
  }),
```

The object in the second argument is the field's `feature` property, typed `PlatformFeatureMeta`. `PLATFORM_FEATURES` spreads it and appends `configKey`, so `id`, `label`, `category` and `hint` are exactly what the editor renders.

Declaration order here is the key order of `PermissionGroupConfig`, of both zod schemas, and of every config JSON that crosses the API boundary. `fields.test.ts` pins that order with a contract test comparing key order, so a moved key fails the suite. The group editor in `apps/sim/ee/access-control/components/group-detail.tsx` also runs its dirty check by comparing stringified configs, so moving an existing key makes every open editor read as having unsaved changes. The registry already carries a TSDoc note on `disablePersonalApiKeys` saying exactly this — extend the tail, do not tidy the middle.

Three things to get right in the entry itself:

**The default must be the permissive value.** Every config row already stored in the `permission_group.config` column predates your key. `parsePermissionGroupConfig` fills the gap from the field's default, and the create/update route merges a partial write over the stored config. If your default is the restrictive value, adding the key silently applies a new restriction to every existing group in every enterprise organization, with nothing in the admin UI having changed. This is why the boolean builder hardcodes `false`, the allowlist `null`, and the denylist `[]` — but it is also why a *new* key must be phrased so that the permissive value is falsy. `disableWidgetSharing: false` is correct; a hypothetical `requireWidgetApproval` whose safe default is `true` cannot use `booleanRestriction` and needs its meaning inverted before it can.

**The admin checkbox is inverted.** `group-detail.tsx` renders `checked={!editingConfig[feature.configKey]}` — ticked means *allowed*. A key named `allowX` would render backwards.

**The hint must describe revoked access, not a hidden surface.** Every `enforcement: 'capability'` key refuses at the API. A hint reading "Hide the Tables module from the sidebar" tells an admin they are tidying a nav bar when they are revoking a module — an admin ticking the box is revoking access, not hiding a link. The same string is read a second time by `getActivePermissionGroupRestrictions` in `features.ts` as the prose explaining an *active* restriction, where "hide" is simply false; that prose reaches users through the Copilot workspace VFS and the enterprise platform context. Write what the member can no longer do: "Revoke the Tables module. Members cannot read or write any table." That wording drift is not hypothetical — twelve keys carried "hide from the sidebar" hints for a release after they started returning 403. `PlatformFeatureMeta.hint` carries the rule in its own TSDoc; do not weaken it.

**The category must be in `PLATFORM_CATEGORY_ORDER`.** That constant lives in `apps/sim/lib/permission-groups/features.ts` and currently reads `Modules`, `Knowledge Base`, `Tables`, `Files`, `Deployment`, `Tools`, `Logs`, `Collaboration`, `Credentials & Access`. An unlisted category still renders, but at the end, after every ordered section. The names describe what a group withholds, not where a link used to be hidden — do not reintroduce a surface-shaped section like "Sidebar" or "Settings Tabs".

Note that `PLATFORM_FEATURES` — the array the editor renders — is *derived* from the registry in `features.ts`, not hand-listed. A boolean key cannot reach the config without reaching the editor, which is deliberate: an unrendered key is one an admin can neither set nor see.

## Step 2: Only booleans get an admin UI for free

`PLATFORM_FEATURES` filters on `field.kind === 'boolean-restriction'`. An allowlist or denylist you add renders **nothing** — the key exists, the API accepts it, and no admin can ever set it.

Nested pickers hang off the `featureExtras` map in `group-detail.tsx`, keyed by the **feature id of the boolean it nests under**, not by the allowlist's own config key:

```ts
  const featureExtras: Partial<Record<string, ReactNode>> = {
    'hide-knowledge-base': (
      <AllowlistField
        label='Connectors knowledge bases may sync from'
        value={knowledgeConnectorValue}
        onChange={setKnowledgeConnectors}
        options={KNOWLEDGE_CONNECTOR_OPTIONS}
        disabled={editingConfig.hideKnowledgeBaseTab}
      />
    ),
  }
```

Copy the shape of `setKnowledgeConnectors` for your setter. Two behaviors are load-bearing and easy to drop:

- **Refuse an empty selection** (`if (values.length === 0) return`). An emptied allowlist denies every member while the parent checkbox still reads as allowed, which is an admin footgun with no visible cause. Withholding the whole thing is what the parent checkbox is for.
- **Collapse "everything selected" back to `null`** (`values.length === ALL.length ? null : values`). Storing the full set works, but it freezes the allowlist at today's members — a connector added next release would be denied by a group that had selected "all".

Choose the parent deliberately. `allowedKnowledgeConnectors` nests under `hide-knowledge-base` rather than under `disable-knowledge-base-creation`, because a connector attaches to an *existing* knowledge base: hanging it off creation would dim the picker for exactly the cohort it was written for.

## Step 3: Add the capability id and rule

Skip this step only if `enforcement` is `'executor'` or `'ui-only'`. For `'capability'`, add the id to `CAPABILITY_IDS` and an entry to `CAPABILITY_RULES` in `apps/sim/lib/permission-groups/capabilities.ts`. `CAPABILITY_RULES` uses `satisfies { readonly [K in PermissionGroupCapability]: CapabilityRule }`, so adding an id fails to compile until the rule exists.

Capability ids are **domain-shaped** (`tables.create`), while config keys are **surface-shaped** (`disableTableCreation`). That is intentional: an operation names what it does, the config names what an admin sees, and `CAPABILITY_RULES` is the only place the two vocabularies meet.

A static rule:

```ts
  'widgets.share': {
    kind: 'static',
    configKeys: ['disableWidgetSharing'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Sharing widgets',
    deniedBy: (config) => config.disableWidgetSharing,
  },
```

`configKeys` is what the audit reads to prove your key is enforced — it must list every key `deniedBy` actually reads. `describe` is the subject of one shared sentence, `"<describe> is not available under your organization's permission group"`, so write it as a singular noun or gerund phrase that agrees with the verb. Two functions build that sentence and there is no third: `refuseCapability(capability)` throws it as a `PermissionGroupCapabilityError`, and `capabilityRefusal(capability)` returns it as a string for a raw route rendering its own response body. Both are **defined in `capabilities.ts`**; `capability-assertions.ts` re-exports `capabilityRefusal` so a call site that gates inline reaches the sentence and the assertions through one module. Never write the sentence out at a call site.

Use `'PERMISSION_GROUP_CAPABILITY_BLOCKED'` for `detailCode` unless a caller can act differently on this specific refusal. The set in `apps/sim/lib/core/application/forbidden.ts` is closed **over remedies, not over causes** — a new code is warranted only when the remedy differs from "ask an organization admin". Adding one also requires an entry in `FORBIDDEN_DETAIL_CODE_DESCRIPTIONS` (a compile-time gate) and publishes a new value in the generated OpenAPI 403 description.

### Static vs parameterized

If the decision needs a request value, the rule is `kind: 'parameterized'` and takes a second argument:

```ts
  'knowledge.connectors': {
    kind: 'parameterized',
    configKeys: ['allowedKnowledgeConnectors'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'This knowledge base connector',
    deniedBy: (config, connectorType) =>
      allowlistDenies(config.allowedKnowledgeConnectors, connectorType),
  },
```

A parameterized capability **cannot be declared on an operation**. The authorization funnel decides from the principal, the workspace, and the operation — it never sees request input, and widening the authorization context to carry it would reach every one of the ~287 operations for the sake of two keys. `defineWorkspaceOperation` throws at definition time if you try:

```
Operation <id> declares parameterized capability <cap>; assert it from the use case instead
```

That throw is deliberate. Left unchecked, the operation would read as gated and the gate would silently never fire.

### `satisfies`, never a type annotation

Do not annotate `CAPABILITY_RULES` with its type instead of using `satisfies`. Annotating widens every entry to `CapabilityRule`, at which point `StaticPermissionGroupCapability` — which is derived by filtering the object's own entries for `kind: 'static'` — resolves to **`never`**. No operation can then declare any capability, the type system stops saying anything about capabilities at all, and every gate goes quiet with nothing at runtime looking wrong. `AssertsStaticCapabilityResolves` at the bottom of the file exists to catch exactly that. The same reasoning applies anywhere else you are tempted to annotate one of these registries.

## Step 4: Declare it on the operations it governs, or assert it at the call site

`capability` is a **required** field, and `defineWorkspaceOperation` *additionally* throws at definition time when it is `undefined`:

```
Operation <id> declares no capability; name one, or 'none' with a reason
```

That guard looks unreachable given the field is required. It is not, and the reason is worth internalizing before you write a test fixture: **`apps/sim/tsconfig.json` excludes `*.test.ts` and `*.test.tsx` from type-checking**, and `check-permission-group-enforcement.ts` walks past test files too. A test fixture is therefore the one construction site no static check reads — and a fixture is exactly where an operation gets written from memory rather than from the surrounding domain. Left to reach authorization, an absent capability does not deny; it throws `Cannot read properties of undefined` from inside `capabilityDeniedBy`, and **only for a caller whose organization actually has a permission group**. It passes CI, it passes every personal workspace and every non-enterprise test, and it fails in the tenants that bought the feature. The guard names it at definition time instead.

**Static, and the operation is the whole decision** — set `capability` on the `defineWorkspaceOperation` call. The funnel does the rest; you write no gate code.

```ts
export const shareWidget = defineWorkspaceOperation({
  id: 'widgets.share',
  minimumRole: 'write',
  workspaceApiKey: 'allow',
  capability: 'widgets.share',
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key'],
})
```

If the domain wraps `defineWorkspaceOperation` in a same-file factory, the audit resolves the capability through it — either fixed in the factory body or taken as a positional second argument. `apps/sim/lib/table/application/operations.ts` shows both, and deliberately gives the positional form **no default**: a default would let a new operation inherit `tables.use` without anyone deciding it should, which is the unreviewed omission the whole gate exists to prevent.

**Static, but no operation to hang it on** — a raw route, or an organization-level action. There is no `assertOrganizationCapability`; it was deleted. Reach for whichever of these fits how the caller must respond:

| Helper | Use when |
|---|---|
| `assertWorkspaceCapability(userId, workspaceId, cap, organizationId?)` | inside a use case, where a thrown `PermissionGroupCapabilityError` is projected to a 403 for you |
| `isWorkspaceCapabilityWithheld(userId, workspaceId, cap, organizationId?)` | a raw handler rendering its own body — pair it with `capabilityRefusal(cap)` |
| `isOrganizationCapabilityWithheld(organizationId, cap)` | an action that names an organization rather than a workspace |
| `capabilityDeniedBy(cap, config)` | you already hold a resolved config and are asking several questions of it |

Annotate the call site either way:

```ts
    // permission-group-enforced: logs.export — raw streaming route, no workspace operation to declare it on
    if (capabilityDeniedBy('logs.export', permissionConfig)) {
      return NextResponse.json({ error: capabilityRefusal('logs.export') }, { status: 403 })
    }
```

`isOrganizationCapabilityWithheld` resolves through `getUserPermissionConfigForOrganization`, which reads the organization's **default** group — a non-default group targets specific workspaces and has nothing to say about an action no workspace scopes. It sits outside the per-request memo on purpose: that memo is keyed by user and workspace, and this decision is keyed by organization alone.

**Parameterized** — the rule needs a request value, so none of the helpers above fit (they are all typed `StaticPermissionGroupCapability`). Write a small module-local wrapper that reads the rule and refuses through `refuseCapability`, and annotate the call site. `assertConnectorTypeAllowed` in `apps/sim/lib/knowledge/application/connectors.ts` is the shape:

```ts
const CONNECTOR_ALLOWLIST_RULE = CAPABILITY_RULES['knowledge.connectors']

async function assertConnectorTypeAllowed(userId, workspaceId, connectorType) {
  if (!userId) return
  const config = await resolvePermissionGroupConfig(userId, workspaceId, undefined)
  if (!config || !CONNECTOR_ALLOWLIST_RULE.deniedBy(config, connectorType)) return
  refuseCapability('knowledge.connectors')
}
```

Always route the decision through `CAPABILITY_RULES` and raise it with `refuseCapability`. Never spell the config key out at the call site, and never write the refusal sentence out: a renamed key silently stops denying anything, and a hand-written message drifts from the funnel's for the same refusal. `validatePublicFileSharing` and `validateChatDeployAuth` in `ee/access-control/utils/permission-check.ts` are the other two examples of this shape.

Guard on the acting user being present. A permission group is a membership of users, so an actorless caller resolves no group; `assertConnectorTypeAllowed` returns early on a missing `userId` rather than throwing, which is what keeps a scheduled sync from becoming a 500 instead of a refusal anyone could act on.

**The operation is genuinely ungoverned** — write `capability: 'none'` with a `// permission-group-exempt: <reason>` comment directly above it. `'none'` is spelled out rather than omitted because an absent field cannot be told apart from an unreviewed one. Good exemption reasons name why no key applies *and* why a gate would be wrong:

```ts
  // permission-group-exempt: the executor's own per-run store; no group key names it, and refusing would fail runs the group allows
```

### Surfaces that do not go through the funnel

Three of them, and each has its own required shape.

**`/api/v1` routes** authorize in `apps/sim/app/api/v1/middleware.ts` rather than through `authorizeWorkspaceOperation`. Every route threads a `V1RouteCapability` (`StaticPermissionGroupCapability | 'none'`, required and spelled out, same reasoning as on the operation), and its value must be the one its v2 or internal counterpart already declares — v1 gets no mapping of its own. The subject **must** come from `capabilityGovernedUserId(rateLimit)`, which returns `null` for a workspace key: `rateLimit.userId` is populated for *both* key kinds, and for a workspace key it is the key's **creator**, a bystander. `scripts/check-capability-subject.ts` exists because that bug has shipped and been fixed twice.

**Raw internal table routes** under `/api/table/**` share one gate inside `checkAccess` in `apps/sim/app/api/table/utils.ts`. Its signature takes a `TableAccessPrincipal` discriminated union — `{ kind: 'user'; userId }` or `{ kind: 'workspace_api_key'; keyCreatorUserId }` — rather than a bare `userId`, for the same reason: a bare id no longer type-checks, so a caller cannot reach the gated behavior without naming a kind, and only the kind that says so skips the gate. `tableAccessPrincipal(rateLimit)` in the v1 middleware builds it for v1's table handlers.

**The route-wrapper graph.** `withRouteHandler` imports `request-scope.server.ts` and nothing heavier. If your gate needs a resolver, import it at the *call site*, not from anything the wrapper or `lib/core/application` reaches. See Step 6.

## Step 5: Add it to the golden corpus

Add your key to **both** the `input` and the `expected` object of the `'a fully populated config'` fixture in `apps/sim/lib/permission-groups/fields.test.ts` (renamed from `types.test.ts` when `types.ts` was folded into `fields.ts`), set to a non-default value.

That file is the pinned coercion corpus: every row states what a stored `jsonb` value coerces to, so a row that changes in a later diff is a deliberate semantic decision someone defends rather than a silent regression. Its other assertions are derived from `DEFAULT_PERMISSION_GROUP_CONFIG` — wire-order, idempotence, read-schema acceptance, the 2000-iteration seeded fuzz, the write/default/read key-set agreement and the boolean-key-to-`PLATFORM_FEATURES` coverage check — so they pick your key up for free. Likewise `features.test.ts` iterates `PLATFORM_FEATURES` and needs no edit for a boolean.

Add a targeted case to `capabilities.test.ts` for a rule with any logic beyond reading one key. For an allowlist, assert the three states explicitly, because they are what the parser and the UI conspire to confuse: `null` permits every member, a populated list permits only the named ones, and `[]` permits **none**. `capabilities.test.ts` already pins this for `knowledge.connectors`; copy it.

## Step 6: Keep the graph light

`scripts/check-application-graph.ts` (in `check:audits`) walks **runtime** `import` / `export … from` edges — `import type` is erased and deliberately allowed — out of five guarded roots and fails if any reaches a forbidden module tree. This is a real constraint on you: importing the wrong thing from a permission-group helper now fails CI.

| Guarded root | Forbidden |
|---|---|
| `lib/core/application/index.ts` | `providers/`, `blocks/`, `tools/`, `executor/`, `lib/uploads/`, `lib/workflows/` |
| `lib/permission-groups/capabilities.ts` | same six |
| `lib/permission-groups/capability-assertions.ts` | same six |
| `lib/permission-groups/config-scope.server.ts` | same six |
| `lib/core/utils/with-route-handler.ts` | those six **plus** `lib/billing/`, `lib/permission-groups/resolve.server`, `lib/auth`, `lib/copilot/`, `lib/knowledge/` |

The wider list on the route wrapper is not an app-wide ban — `resolve.server.ts` legitimately reads the subscription to decide whether an organization is on an enterprise plan, which is why `lib/billing/` stays allowed for the funnel roots. The wrapper is a request-lifecycle shim that opens the memo scope and nothing more, so it may not load any of it. That split is why the scope is two files: `request-scope.server.ts` holds `withPermissionGroupScope` and is import-free; `config-scope.server.ts` holds `resolvePermissionGroupConfig` and only the gate call sites import it.

The symptom of breaking this is never the message you expect. One import once widened the funnel graph as far as `lib/uploads/utils/file-utils.ts`, and the only sign was two unrelated knowledge tests failing on a partial mock of a module they never meant to load; later one import in the route wrapper pulled the whole billing graph into every route test, surfacing as an OTP-route test failing on its own partial `zod` mock. If you see a failure like that after adding an import, run this audit before anything else.

## Step 7: Verify

```bash
bun run check:permission-group-enforcement
bun run check:application-graph
bun run check:capability-subject
cd apps/sim && bun run type-check
cd apps/sim && bunx vitest run lib/permission-groups
```

If you touched a contract or the group routes, also `bun run check:api-validation`. `bun run check:audits` runs all three of the above and every other audit; it derives its list from the `check:*` scripts in `package.json`, so a new audit is opted *out* deliberately rather than opted in.

Read the success lines, not just the exit codes:

```
✓ permission-group enforcement: 287 operations declare a capability, 35 capabilities all enforced
✅ Application graph clean: 5 roots reach none of 11 forbidden module trees
check:capability-subject — 32 v1 files, 5 capability subjects resolved through capabilityGovernedUserId.
```

The counts should have grown by your operation and your capability. The enforcement audit is all-or-nothing — it either prints that line or fails with findings; there is no count-down or migration mode that exits 0 with work outstanding. It carries three self-checks, because it reads source text with regexes rather than the type system:

- It refuses to report success when `CAPABILITY_IDS`, `CAPABILITY_RULES` or `PERMISSION_GROUP_FIELDS` parse to nothing, and it fails when the rule count and the capability count disagree.
- A `defineWorkspaceOperation` call whose `id` it cannot read — a const-reference id, or a factory written as an arrow const rather than a `function` — is reported per call rather than silently skipped.
- **A file that calls `defineWorkspaceOperation` and parses to ZERO declarations is a finding**, not a pass. That catches the whole-file failure mode: a non-literal `id:` or an arrow-const factory that makes every operation in the file invisible at once. If it fires, teach the parsers the new form; do not work around it.

What the audit proves is *reachability*: your capability is named somewhere and your key is read by some rule. It cannot tell whether the rule's logic is right or whether every operation reaching the behavior declares it. Do not treat a green run as proof the gate fires.

## Traps

These are the ones that actually bite. Each has a reason; understand the reason and you will get the cases this list does not enumerate right too.

**The default must be permissive.** Every stored config predates your key, and the parser fills the gap from the default. A restrictive default applies a new restriction retroactively to every existing group, invisibly.

**Append, never insert.** Declaration order is the wire order, `fields.test.ts` compares key order, and the editor's dirty check compares stringified configs — a moved key fails a test and reads as an unsaved change in every open editor.

**`CAPABILITY_RULES` uses `satisfies`, never a type annotation.** Annotating collapses `StaticPermissionGroupCapability` to `never` and silently disables the type system around capabilities. See Step 3.

**`capability` is required *and* guarded at definition time.** The guard is not redundant: `apps/sim/tsconfig.json` excludes test files, so a fixture is the one construction site no static check reads. See Step 4.

**An operation carries exactly ONE capability.** Splitting a narrower capability off a broader one opens a hole unless the narrower rule *also* reads the broader key. This is real, not hypothetical: `knowledge.create` and `knowledge.upload` both list `hideKnowledgeBaseTab` alongside their own key —

```ts
    configKeys: ['disableKnowledgeBaseCreation', 'hideKnowledgeBaseTab'],
    deniedBy: (config) => config.disableKnowledgeBaseCreation || config.hideKnowledgeBaseTab,
```

— because moving knowledge-base creation off `knowledge.use` would otherwise let a group that withheld the entire module still create one through the API. **The narrower capability has to subsume the broader.** Any time you re-point an operation from a general capability to a specific one, the specific rule must read both keys.

**`.catch()` on an array field is a fail-open security bug.** `z.array(item).catch(fallback)` is whole-value tolerant: one bad member discards every good one. On an allowlist the fallback is `null`, and `null` means **unrestricted** — so a partly-corrupt allowlist would stop restricting anything at all. `tolerantArray` in `fields.ts` filters element by element instead, keeping the members that parse and failing closed. Never replace it with `.catch()` on an array field, and never hand-roll a parallel coercion path.

**`parsePermissionGroupConfig` must keep its `Array.isArray` guard.** `typeof [] === 'object'`, so a truthy-object check alone lets an array through, and `z.object().parse([])` throws — which is reachable, because the column is `jsonb` and a row can genuinely hold `[]`. The guard is what makes the parser return the defaults there instead of taking down the request. `tolerantArray` carries the mirror-image guard for the same reason.

**An empty allowlist denies everything; `null` allows everything.** These must never collapse into one another — not in the parser, not in the UI setter, not in a rule's `deniedBy`. `allowlistDenies` encodes it as `allowed !== null && !allowed.includes(member)`. A `?? []` anywhere on this path inverts the meaning of the unrestricted case.

**A parameterized capability declared on an operation is refused at definition time.** `defineWorkspaceOperation` throws rather than accepting it, because the funnel never sees request input and the gate would silently never fire.

**Non-boolean keys get no admin UI.** `PLATFORM_FEATURES` filters to booleans. An allowlist without a `featureExtras` picker is a key no admin can ever set.

**Not everyone goes through the funnel.** Four cases, and the differences between them matter:

- A **workspace API key** authorizes as the workspace — there is no user, so no permission group resolves and `operation.capability` does not apply. Substituting the key's creator would apply a bystander's group to every caller of a shared key, and break the key outright when that person left. The escape is closed at the door instead: minting a workspace key is itself capability-gated. Do not substitute the creator anywhere — not in the funnel, not in `checkAccess`, not in v1, not in the log projection.
- A **delegated `executor` principal that *does* carry a `sim_user` subject** is checked for **role only** (`requireCurrentHumanRole`), not capabilities. A workflow run carries the role of whoever triggered it but not their capabilities: a capability names what a *person* may reach in the product, while a run reaches those same resources because a block in the graph does. Applying capabilities here would turn "hide Tables" into a runtime kill-switch that breaks every workflow with a Table block for that cohort.
- An **actorless deployment run** — a delegated executor principal in `mode: 'deployment'` with no resolvable subject — also passes through, because a deployed workflow acts with the workspace's authority rather than its author's group; denying there would 403 every scheduled run, webhook, and public-API call in the organization the moment a group withheld anything.
- **Copilot is deliberately NOT exempt.** A delegated principal with a `sim_user` subject whose `serviceId` is anything other than `executor` goes through the full `requireCurrentHumanAccess`, capability check included. Copilot acts *as the person*, so it must not reach what the person may not.

What a run *does* is still governed, by `assertPermissionsAllowed` in the executor. If your item must bind a deployed run, it belongs at `enforcement: 'executor'`, not `'capability'`.

**Capability is checked after the role check, on purpose.** `requireCurrentHumanAccess` runs `requirePermission` first. `NoWorkspaceAccessError` is concealed as a 404 by the v2 surface so a non-member cannot learn the resource exists; refusing on capability first would hand a complete outsider an oracle for which capabilities the organization withholds. Do not reorder it, and do not add a capability check upstream of the role check in a raw route — the v1 middleware says so in its own TSDoc for the same reason.

## Checklist Before Finishing

- [ ] Kind and `enforcement` chosen deliberately; `ui-only` justified in writing if used
- [ ] It is a gate, not a field projection — a projection belongs in `lib/logs/log-projection.ts` with `capability: 'none'` on the routes
- [ ] Entry **appended** to `PERMISSION_GROUP_FIELDS`, permissive default, restriction-phrased name
- [ ] Category present in `PLATFORM_CATEGORY_ORDER`, named after what is withheld rather than a surface
- [ ] `hint` says what access is revoked, never "hide" — it is also the prose for an active restriction
- [ ] Non-boolean key has a `featureExtras` picker that refuses empty and collapses "all" to `null`
- [ ] Capability id in `CAPABILITY_IDS`, rule in `CAPABILITY_RULES` under `satisfies`, `configKeys` lists every key `deniedBy` reads
- [ ] A narrower capability replacing a broader one also reads the broader key
- [ ] Declared on every operation it governs, or asserted from the use case with a `// permission-group-enforced:` annotation, raising through `refuseCapability` / `capabilityRefusal`
- [ ] Any `capability: 'none'` you added carries a `// permission-group-exempt:` reason
- [ ] v1 routes thread the capability through `middleware.ts` and take their subject from `capabilityGovernedUserId`; table routes pass a `TableAccessPrincipal`
- [ ] Added to the `'a fully populated config'` fixture in `fields.test.ts`, input and expected
- [ ] Allowlist three-state (`null` / populated / `[]`) covered in `capabilities.test.ts`
- [ ] No new runtime import from a guarded root into a forbidden tree
- [ ] `check:permission-group-enforcement`, `check:application-graph` and `check:capability-subject` all pass and name your capability
- [ ] `type-check` clean, `lib/permission-groups` suite green
