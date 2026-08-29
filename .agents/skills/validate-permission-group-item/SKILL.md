---
name: validate-permission-group-item
description: Audit an existing enterprise permission-group item end-to-end — registry entry, schemas, type, defaults, tolerant parser, admin UI, capability rule, enforcement site, and tests — proving the gate actually refuses rather than assuming it. Use when checking a key in `PERMISSION_GROUP_FIELDS` or a capability in `CAPABILITY_RULES`.
argument-hint: <config-key-or-capability-id>
---

# Validate Permission Group Item Skill

You are auditing one governed item in Sim's enterprise permission-group system. The question you are answering is not "does this key exist in the right places" — the registry makes most of that compiler-enforced. The question is:

> **If an organization admin sets this, what refuses, and can I make that refusal happen?**

Twelve keys once shipped with an admin checkbox, a hint describing what they restrict, and no server check at all. Every one of them would have passed a structural audit. Assume nothing enforces until you have found the throw.

## Read the system first

- `apps/sim/lib/permission-groups/fields.ts` — the registry every config surface derives from
- `apps/sim/lib/permission-groups/capabilities.ts` — `CAPABILITY_IDS`, `CAPABILITY_RULES`
- `apps/sim/lib/permission-groups/capability-assertions.ts` — the canonical assertion API
- `apps/sim/lib/core/application/workspace-authorization.ts` — the funnel, and who bypasses it
- `scripts/check-permission-group-enforcement.ts` — what the audit does and does not prove

## Step 1: Registry entry

Find the key in `PERMISSION_GROUP_FIELDS`. Record its builder (`booleanRestriction` / `allowlist` / `denylist`), its `enforcement`, and its position.

- **Default is permissive?** Boolean `false`, allowlist `null`, denylist `[]`. The builders hardcode these, so the real risk is a key whose *name* inverts the meaning — an `allowX` boolean whose permissive value would be `true`. Every stored config predates the key, so a restrictive default silently applies retroactively to every existing group.
- **Named as a restriction?** `hideX` / `disableX` / `allowedX` / `deniedX`. The admin checkbox renders `checked={!editingConfig[feature.configKey]}` — ticked means allowed — so a positively-named boolean renders backwards.
- **Position stable?** Declaration order is the wire order of `PermissionGroupConfig`, both zod schemas, and every config JSON crossing the API boundary. If `git log -p` shows the key was ever *moved* rather than appended, that shipped as a dirty-check regression in the group editor.
- **Phrasing present and accurate?** An allowlist's `{ limited, empty }` and a denylist's string are read by `getActivePermissionGroupRestrictions` in `features.ts` and surface to users through the Copilot context and the group roster. Check the `empty` string genuinely says "none allowed" and not "unrestricted".

## Step 2: Schemas, type, defaults, parser

These are derived by `collectFieldProperty` — `permissionGroupWriteShape`, `permissionGroupReadShape`, `DEFAULT_PERMISSION_GROUP_CONFIG`, and the tolerant parser all read the same registry. **Do not hand-verify them one by one.** Verify instead that nothing has been introduced that bypasses the derivation:

```bash
grep -rn "<configKey>" apps/sim --include='*.ts' --include='*.tsx' | grep -v 'lib/permission-groups/'
```

Every hit outside `lib/permission-groups/` is either a rule's `deniedBy`, an enforcement site, a UI binding, or a test. Anything else — a route restating the key, a client re-deriving a default, a second coercion path — is a leak. In particular:

- A `z.array(...).catch(...)` anywhere on this key's path. `.catch()` is whole-value tolerant: one bad member discards every good one. On an **allowlist** that is fail-**open**, because the fallback is `null` and `null` means unrestricted — a partially corrupt allowlist would stop restricting anything. `tolerantArray` filters element-wise for exactly this reason.
- A `?? []` applied to an allowlist. `null` allows everything and `[]` allows nothing; collapsing them inverts the unrestricted case.
- Any read of the config that does not come from `parsePermissionGroupConfig` or a `resolvePermissionGroupConfig` caller.

Confirm the type assertions at the bottom of `fields.ts` still name a field of this kind (`AssertsAllowlistStaysPrecise`, `AssertsDenylistStaysPrecise`, `AssertsRestrictionStaysPrecise`, `AssertsAuthTypesStayPrecise`). They exist because a zod generic degrading to `unknown` is invisible at runtime — the values stay right, no test fails, and every call site quietly loses its narrowing.

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
- **`describe` reads correctly in the sentence.** `capabilityRefusalMessage` produces `"<describe> is not available under your organization's permission group"`.

## Step 5: Prove the enforcement — do not assume it

This is the step the whole skill exists for. Find the **actual refusal**, name the file and line, and describe what a caller sees.

```bash
grep -rn "'<capability-id>'" apps/sim --include='*.ts' --include='*.tsx'
grep -rn "permission-group-enforced: <capability-id>" apps/sim
```

Classify what you find into exactly one of:

1. **Declared on operations.** `capability: '<id>'` on one or more `defineWorkspaceOperation` calls. The funnel enforces in `requireCurrentHumanAccess` → `requireCapability`. Verify the set of operations is *complete*: enumerate every route and tool that reaches the same behavior and check each one's operation declares it. One route declaring `capability: 'none'` for the same behavior is the hole.
2. **Asserted at a call site**, with a `// permission-group-enforced: <id> — <reason>` annotation. Verify the assertion goes through `capability-assertions.ts` or a `CAPABILITY_RULES` entry rather than spelling the config key out inline — a call site reading `config.disableX` directly stops denying anything the moment the key is renamed, and its wording drifts from the funnel's. Some older helpers in `apps/sim/ee/access-control/utils/permission-check.ts` (`validatePublicFileSharing`, `validateChatDeployAuth`) still read config keys directly; note that as a finding rather than a blocker, and cite `assertConnectorTypeAllowed` in `apps/sim/lib/knowledge/application/connectors.ts` as the pattern they should converge on.
3. **Executor-gated.** Read by `assertPermissionsAllowed` in `permission-check.ts`, per block / tool / model. Verify the branch exists and throws a real error, and that the id it compares against is the same vocabulary the admin UI writes — `deniedTools` holds block `tools.access` ids verbatim, version suffix included.
4. **Nothing.** Report it as a defect, with the sentence "an organization that sets this believes it applied a restriction that does not exist".

Then make the refusal happen. Either write a failing case, or take the existing test and **remove the gate** — delete the `capability:` field, or the `deniedBy` body, or the assertion call — and confirm the test goes red. A test that still passes with the gate removed is proving nothing. Restore the code afterward.

For an allowlist, the three states have to be tested separately, because they are what the parser and the UI conspire to confuse: `null` permits every member, a populated list permits only the named ones, `[]` permits **none**. `capabilities.test.ts` pins all three for `knowledge.connectors`; anything less than that for another allowlist is a gap.

## Step 6: Tests

- **`apps/sim/lib/permission-groups/types.test.ts`** — the key must appear in both the `input` and `expected` halves of the `'a fully populated config'` fixture. The corpus is pinned deliberately: a row that changes in a later diff has to be defended as a semantic decision rather than slipping through as a regression. The rest of that file (wire order, idempotence, read-schema acceptance, the seeded 2000-iteration fuzz, boolean-to-`PLATFORM_FEATURES` coverage) derives from `DEFAULT_PERMISSION_GROUP_CONFIG` and needs no per-key edit.
- **`capabilities.test.ts`** — a case for any rule with logic beyond reading one key: subsumption, allowlist three-state, auth-mode membership.
- **`features.test.ts`** — derived from `PLATFORM_FEATURES`; a boolean key needs no edit. A non-boolean key contributing user-facing prose should have its `limited` / `empty` strings pinned there.

## Step 7: Run the checks

```bash
bun run check:permission-group-enforcement
cd apps/sim && bun run type-check
cd apps/sim && bunx vitest run lib/permission-groups
```

Read the audit's output, not just its exit code. Two ways it can pass without proving what you want:

- **Count-down mode.** While any operation is still unannotated it prints `(N to go)` and exits 0 — and in that mode it *suppresses* the "capability declared but nothing enforces it" finding entirely. Check the `pending enforcement:` line for your capability by name. A capability listed there is unenforced and the build is green anyway.
- **Vacuous parse.** The audit reads source text with regexes. It has a self-check that refuses to report success when `CAPABILITY_IDS`, `CAPABILITY_RULES`, or `PERMISSION_GROUP_FIELDS` parse to nothing, and it cross-checks that the rule count equals the capability count. If either of those errors fires, the audit is broken, not the code — fix the parsers rather than leaving it passing.

The audit proves *reachability*, not correctness: it proves a capability is named somewhere and a key is read by some rule. It cannot tell whether the rule's logic is right, whether every relevant operation declares it, or whether an annotated call site actually calls anything. Step 5 is what covers that, and no amount of green CI substitutes for it.

## Known gaps — recognize these, do not re-report them

These are understood, deliberate, and documented in the code. Note them if they are material to what you were asked about; do not file them as new findings.

- **A workspace API key resolves no permission group.** It authorizes as the workspace, so there is no user and `operation.capability` does not apply — the `workspace_api_key` branch of `authorizeWorkspaceOperation` returns before any capability check. Substituting the key's creator would apply a bystander's group to every caller of a shared key and break the key outright when that person left the organization. The escape is closed at the door instead: minting a workspace key is itself capability-gated.
- **An actorless deployment run passes through.** A delegated `executor` principal in `mode: 'deployment'` with no resolvable subject is authorized without a capability check, because a deployed workflow acts with the workspace's authority rather than its author's permission group. Denying there would 403 every scheduled run, webhook, and public-API call in the organization the moment a group withheld anything. What such a run *does* is still governed, by `assertPermissionsAllowed` in the executor — which is precisely why the four run-scoped keys carry `enforcement: 'executor'` rather than `'capability'`.
- **Capability is checked after the role check.** `requireCurrentHumanAccess` runs `requirePermission` first. `NoWorkspaceAccessError` is concealed as a 404 by the v2 surface so a non-member cannot learn the resource exists; refusing on capability first would leak which capabilities the organization withholds to a complete outsider. It is also the cheaper check and names the remedy the caller can act on. Do not report the ordering as a bug.
- **`allowedEgressHosts` does not exist.** There is no network-egress allowlist in `PERMISSION_GROUP_FIELDS`. Requests for one are a feature, not a missing wiring of an existing key.

## Report Format

For each item audited, state:

1. **Kind and enforcement** — as declared, and whether the declaration is true.
2. **The refusal** — file, line, the error thrown, and what a caller sees (status, `detailCode`, message). Or: *nothing refuses*.
3. **Proof** — the test that fails when the gate is removed, or the statement that no such test exists.
4. **Coverage gaps** — routes, tools, or surfaces reaching the same behavior without the gate.
5. **Findings**, ordered: unenforced key > incomplete operation coverage > fail-open coercion > allowlist three-state confusion > missing admin UI > missing test > cosmetic.
