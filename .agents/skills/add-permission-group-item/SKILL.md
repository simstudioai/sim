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

- `apps/sim/lib/permission-groups/fields.ts` — the registry, the three field builders, the tolerant parser
- `apps/sim/lib/permission-groups/capabilities.ts` — `CAPABILITY_IDS`, `CAPABILITY_RULES`, the static/parameterized split
- `apps/sim/lib/permission-groups/capability-assertions.ts` — the only sanctioned way to ask whether a group withholds something
- `apps/sim/lib/core/application/workspace-operation.ts` — the required `capability` field
- `apps/sim/lib/core/application/workspace-authorization.ts` — where the funnel enforces, and who passes through
- `scripts/check-permission-group-enforcement.ts` — the audit you have to satisfy

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
- `'ui-only'` — the key hides a surface without withholding it, so a caller who skips the UI still reaches the API. **Almost never the right answer.** Choose it only when you can say, in the `enforcement` comment, why a determined caller reaching the data anyway is acceptable. Nothing currently ships as `ui-only`; if yours is the first, expect that to be questioned in review.

**Is the decision knowable from the config alone?** A rule that needs a value only the request carries — an auth mode, a connector id, a file id — is *parameterized*, and parameterized rules cannot be declared on an operation. See Step 3.

## Step 1: Add the field entry — at the end

Append one entry to `PERMISSION_GROUP_FIELDS`. **Append, never insert.**

```ts
  disableWidgetSharing: booleanRestriction('capability', {
    id: 'disable-widget-sharing',
    label: 'Widget Sharing',
    category: 'Features',
    hint: 'Prevent sharing a widget outside the workspace.',
  }),
```

Declaration order here is the key order of `PermissionGroupConfig`, of both zod schemas, and of every config JSON that crosses the API boundary. The group editor in `apps/sim/ee/access-control/components/group-detail.tsx` runs its dirty check by comparing stringified configs, so moving an existing key makes every open editor read as having unsaved changes. The registry already carries a TSDoc note on `disablePersonalApiKeys` saying exactly this — extend the tail, do not tidy the middle.

Three things to get right in the entry itself:

**The default must be the permissive value.** Every config row already stored in the `permission_group.config` column predates your key. `parsePermissionGroupConfig` fills the gap from the field's default, and the create/update route merges a partial write over the stored config. If your default is the restrictive value, adding the key silently applies a new restriction to every existing group in every enterprise organization, with nothing in the admin UI having changed. This is why the boolean builder hardcodes `false`, the allowlist `null`, and the denylist `[]` — but it is also why a *new* key must be phrased so that the permissive value is falsy. `disableWidgetSharing: false` is correct; a hypothetical `requireWidgetApproval` whose safe default is `true` cannot use `booleanRestriction` and needs its meaning inverted before it can.

**The admin checkbox is inverted.** `group-detail.tsx` renders `checked={!editingConfig[feature.configKey]}` — ticked means *allowed*. A key named `allowX` would render backwards. Name it `hideX` or `disableX`.

**The category must be in `PLATFORM_CATEGORY_ORDER`.** That constant lives in `apps/sim/lib/permission-groups/features.ts`. An unlisted category still renders, but at the end, after every ordered section.

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

`configKeys` is what the audit reads to prove your key is enforced — it must list every key `deniedBy` actually reads. `describe` is substituted into `capabilityRefusalMessage`, which produces `"<describe> is not available under your organization's permission group"`, so write it as a noun phrase that fits.

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

Do not annotate `CAPABILITY_RULES` with its type instead of using `satisfies`. Annotating widens every entry to `CapabilityRule`, at which point `StaticPermissionGroupCapability` resolves to `never`, no operation can declare any capability, and every gate stops firing — with nothing at runtime looking wrong. `AssertsStaticCapabilityResolves` at the bottom of the file exists to catch exactly that.

## Step 4: Declare it on the operations it governs, or assert it at the call site

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

**Parameterized, or no operation to hang it on** — assert from inside the use case through `capability-assertions.ts`, and annotate the call site:

```ts
    // permission-group-enforced: knowledge.connectors — needs the request's connector id, which the funnel never sees
    await assertConnectorTypeAllowed(
      resolvePrincipalSubjectUserId(principal),
      workspaceId,
      input.connectorType
    )
```

Always route the decision through `CAPABILITY_RULES` (via `assertWorkspaceCapability`, `assertOrganizationCapability`, `capabilityDeniedBy`, or the `isWorkspaceCapabilityWithheld` / `isOrganizationCapabilityWithheld` non-throwing pair). Never spell the config key out at the call site: a renamed key would silently stop denying anything, and the refusal wording would drift from the funnel's.

Use `assertOrganizationCapability` for an action that names an organization rather than a workspace — creating a workspace, reading the member directory. It resolves the organization's *default* group, because a non-default group targets specific workspaces and has nothing to say about an action no workspace scopes.

Guard on the acting user being present. A permission group is a membership of users, so an actorless caller resolves no group; `assertConnectorTypeAllowed` returns early on a missing `userId` rather than throwing, which is what keeps a scheduled sync from becoming a 500 instead of a refusal anyone could act on.

**The operation is genuinely ungoverned** — write `capability: 'none'` with a `// permission-group-exempt: <reason>` comment directly above it. `'none'` is spelled out rather than omitted because an absent field cannot be told apart from an unreviewed one. Good exemption reasons name why no key applies *and* why a gate would be wrong:

```ts
  // permission-group-exempt: the executor's own per-run store; no group key names it, and refusing would fail runs the group allows
```

## Step 5: Add it to the golden corpus

Add your key to **both** the `input` and the `expected` object of the `'a fully populated config'` fixture in `apps/sim/lib/permission-groups/types.test.ts`, set to a non-default value.

That file is the pinned coercion corpus: every row states what a stored `jsonb` value coerces to, so a row that changes in a later diff is a deliberate semantic decision someone defends rather than a silent regression. Its other assertions are derived from `DEFAULT_PERMISSION_GROUP_CONFIG` — wire-order, idempotence, read-schema acceptance, the 2000-iteration seeded fuzz, and the boolean-key-to-`PLATFORM_FEATURES` coverage check — so they pick your key up for free. Likewise `features.test.ts` iterates `PLATFORM_FEATURES` and needs no edit for a boolean.

Add a targeted case to `capabilities.test.ts` for a rule with any logic beyond reading one key. For an allowlist, assert the three states explicitly, because they are what the parser and the UI conspire to confuse: `null` permits every member, a populated list permits only the named ones, and `[]` permits **none**. `capabilities.test.ts` already pins this for `knowledge.connectors`; copy it.

## Step 6: Verify

```bash
bun run check:permission-group-enforcement
cd apps/sim && bun run type-check
cd apps/sim && bunx vitest run lib/permission-groups
```

If you touched a contract or the group routes, also `bun run check:api-validation`. `bun run check:audits` runs the whole audit set including the enforcement check.

Read the audit's success line, not just its exit code:

```
✓ permission-group enforcement: 287 operations declare a capability, 35 capabilities all enforced
```

While any operation is still unannotated the audit runs in **count-down mode** and exits 0 with a `(N to go)` line — and in that mode it *suppresses* the "capability declared but nothing enforces it" finding. If your run prints a count-down, your new capability being unreachable will not fail the build. Check the `pending enforcement:` line for your capability id by name.

## Traps

These are the ones that actually bite. Each has a reason; understand the reason and you will get the cases this list does not enumerate right too.

**The default must be permissive.** Every stored config predates your key, and the parser fills the gap from the default. A restrictive default applies a new restriction retroactively to every existing group, invisibly.

**Append, never insert.** Declaration order is the wire order, and the editor's dirty check compares stringified configs — a moved key reads as an unsaved change in every open editor.

**An operation carries exactly ONE capability.** Splitting a narrower capability off a broader one opens a hole unless the narrower rule *also* reads the broader key. This is real, not hypothetical: `knowledge.create` and `knowledge.upload` both list `hideKnowledgeBaseTab` alongside their own key —

```ts
    configKeys: ['disableKnowledgeBaseCreation', 'hideKnowledgeBaseTab'],
    deniedBy: (config) => config.disableKnowledgeBaseCreation || config.hideKnowledgeBaseTab,
```

— because moving knowledge-base creation off `knowledge.use` would otherwise let a group that withheld the entire module still create one through the API. **The narrower capability has to subsume the broader.** Any time you re-point an operation from a general capability to a specific one, the specific rule must read both keys.

**`.catch()` is whole-value tolerant; array coercion must be element-wise.** `z.array(item).catch(fallback)` discards every good member because one was bad. On an allowlist the fallback is `null`, and `null` means unrestricted — so whole-value tolerance is **fail-open**: a partially corrupt allowlist would stop restricting anything at all. `tolerantArray` filters element by element instead, keeping the members that parse. Never replace it with `.catch()` on an array field, and never hand-roll a parallel coercion path.

**An empty allowlist denies everything; `null` allows everything.** These must never collapse into one another — not in the parser, not in the UI setter, not in a rule's `deniedBy`. `allowlistDenies` encodes it as `allowed !== null && !allowed.includes(member)`. A `?? []` anywhere on this path inverts the meaning of the unrestricted case.

**A parameterized capability declared on an operation is refused at definition time.** `defineWorkspaceOperation` throws rather than accepting it, because the funnel never sees request input and the gate would silently never fire.

**Non-boolean keys get no admin UI.** `PLATFORM_FEATURES` filters to booleans. An allowlist without a `featureExtras` picker is a key no admin can ever set.

**Not everyone goes through the funnel.** A **workspace API key** authorizes as the workspace — there is no user, so no permission group resolves and `operation.capability` does not apply. (Substituting the key's creator would apply a bystander's group to every caller of a shared key, and break the key outright when that person left. The escape is closed at the door instead: minting a workspace key is itself capability-gated.) An **actorless deployment run** — a delegated executor principal with no subject — also passes through, because a deployed workflow acts with the workspace's authority, not its author's group; denying there would 403 every scheduled run, webhook, and public-API call in the organization the moment a group withheld anything. What such a run *does* is still governed, by `assertPermissionsAllowed` in the executor. If your item must bind a deployed run, it belongs at `enforcement: 'executor'`, not `'capability'`.

**Capability is checked after the role check, on purpose.** `requireCurrentHumanAccess` runs `requirePermission` first. `NoWorkspaceAccessError` is concealed as a 404 by the v2 surface so a non-member cannot learn the resource exists; refusing on capability first would tell a complete outsider which capabilities the organization withholds. Do not reorder it, and do not add a capability check upstream of the role check in a raw route.

## Checklist Before Finishing

- [ ] Kind and `enforcement` chosen deliberately; `ui-only` justified in writing if used
- [ ] Entry **appended** to `PERMISSION_GROUP_FIELDS`, permissive default, restriction-phrased name
- [ ] Category present in `PLATFORM_CATEGORY_ORDER`
- [ ] Non-boolean key has a `featureExtras` picker that refuses empty and collapses "all" to `null`
- [ ] Capability id in `CAPABILITY_IDS`, rule in `CAPABILITY_RULES`, `configKeys` lists every key `deniedBy` reads
- [ ] A narrower capability replacing a broader one also reads the broader key
- [ ] Declared on every operation it governs, or asserted from the use case with a `// permission-group-enforced:` annotation
- [ ] Any `capability: 'none'` you added carries a `// permission-group-exempt:` reason
- [ ] Added to the `'a fully populated config'` fixture in `types.test.ts`, input and expected
- [ ] Allowlist three-state (`null` / populated / `[]`) covered in `capabilities.test.ts`
- [ ] `check:permission-group-enforcement` passes and names your capability as enforced, not pending
- [ ] `type-check` clean, `lib/permission-groups` suite green
