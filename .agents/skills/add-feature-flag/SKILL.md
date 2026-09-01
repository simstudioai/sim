---
name: add-feature-flag
description: Add a runtime feature flag (AppConfig-backed on prod, secret fallback off-prod), global by default or optionally gated by workspace id, org id, user id, or platform admin
argument-hint: <flag-name>
---

# Add Feature Flag Skill

You add a **runtime feature flag** to Sim that can change on prod with no redeploy (AWS AppConfig). Prefer a global on/off flag unless the rollout actually needs per-workspace, per-organization, per-user, or platform-admin targeting. When AppConfig isn't the source of truth, the flag falls back to a single **secret** (on/off only).

## When to use this vs `env-flags.ts`

- **Feature flag** (`@/lib/core/config/feature-flags.ts`): runtime global on/off by default, optionally scoped by `workspaceId`/`userId`/`orgId`/admin. This skill.
- **Env flag** (`@/lib/core/config/env-flags.ts`): deploy-time capability/environment detection (`isProd`, `isHosted`, `isBillingEnabled`). A module-load boolean. **Do not add gated flags here.**

If the user wants a fixed per-deployment toggle, send them to `env-flags.ts` instead.

## The flag model

A flag's **gating rule lives only in the hosted AppConfig document**. It is ON for a context when any configured clause matches:

```ts
interface FeatureFlagRule {
  enabled?: boolean       // global default for everyone
  workspaceIds?: string[] // allowlisted workspace ids
  orgIds?: string[]       // allowlisted organization ids
  userIds?: string[]      // allowlisted user ids
  adminEnabled?: boolean  // platform admins (user.role === 'admin')
}
```

Critically, **none of this is expressible in code** — gating (especially `adminEnabled`) can only be set through AppConfig, so no environment can grant access from a code literal. Off-AppConfig (self-hosted/OSS/local), a flag is simply on or off, derived from its fallback secret.

## Steps

1. **Confirm the granularity before editing code.** If the user has not already specified it, stop and ask:

   > Should `<flag-name>` be a global on/off flag (recommended), or does it need rollout targeting by workspace, organization, user, and/or platform admin?

   - Recommend **global**. Do not infer scoped gating merely because the call site already has a workspace, user, or organization id.
   - If the user chooses scoped gating but does not name the dimensions, ask which of workspace, organization, user, and platform admin it needs. Wire only the selected dimensions.
   - If the user wants a fixed per-deployment toggle rather than a runtime AppConfig flag, use `env-flags.ts` instead.

2. **Define the flag.** Add one entry to the `FEATURE_FLAGS` registry in `apps/sim/lib/core/config/feature-flags.ts`. Each entry is the flag's whole definition — name (kebab-case key), `description`, and the `fallback` secret consulted when AppConfig isn't the source of truth (truthy ⇒ on globally):

   ```ts
   const FEATURE_FLAGS = {
     '<flag-name>': {
       description: '<what this gates>',
       fallback: '<FLAG_SECRET>',
     },
   }
   ```

   `fallback` is the env/secret key (typed as `keyof typeof env`), so add `<FLAG_SECRET>` to `apps/sim/lib/core/config/env.ts` first (and the deployment's secret store) — it won't typecheck otherwise. Do **not** add workspace/org/user/admin defaults here — that gating exists only in AppConfig. Adding the entry makes `<flag-name>` a valid `FeatureFlagName`.

3. **Gate the call site at the chosen granularity.** For the recommended global mode, pass no context:

   ```ts
   import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

   if (await isFeatureEnabled('<flag-name>')) {
     // gated behavior
   }
   ```

   Do not fetch, resolve, or thread through user or organization context solely for a global flag.

   For scoped rollout, pass only the dimensions the user selected. Admin status is resolved internally, so ordinary callers pass `userId`, not a role:

   ```ts
   import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

   if (await isFeatureEnabled('<flag-name>', { workspaceId, userId, orgId })) {
     // gated behavior
   }
   ```

   - Workspace targeting uses `workspaceId`; organization targeting uses `orgId`; user and platform-admin targeting require `userId`.
   - Missing ids are fine — a clause with no matching id is skipped; with no `userId`, the admin clause resolves to `false` without a DB read.
   - Admin routes that already know the caller is an admin may pass `{ userId, isAdmin: true }` to skip the role lookup.
   - **Client/UI flags:** resolve server-side (in a server component, route, or loader) and pass the boolean down as a prop. There is no client AppConfig.

4. **(Prod) configure in AppConfig.** The infra `feature-flags` profile schema is permissive, so a new flag needs **no infra change**. Operators add the flag to the hosted `feature-flags` document using `enabled` for global rollout or only the selected `workspaceIds`/`orgIds`/`userIds`/`adminEnabled` clauses for scoped rollout, then start a `sim-<env>-fast` deployment (see the AppConfig runbook in the infra README — same flow as `access-control`). The fallback secret only applies when AppConfig is disabled.

5. **Test.** Add a case to `apps/sim/lib/core/config/feature-flags.test.ts` that matches the chosen granularity. For a global flag, exercise `isFeatureEnabled('<flag-name>')` with an AppConfig `enabled` rule and toggle the fallback secret for the off-AppConfig path. For scoped rollout, cover only the selected clauses and mock `isPlatformAdmin` when testing `adminEnabled`.

6. **Clean up after rollout.** When the feature ships to everyone, delete the flag's entry from `FEATURE_FLAGS`, the `<FLAG_SECRET>` env entry, the AppConfig document, the call sites, and the test. Leaving dead flags around is the main failure mode of flag systems.

## Notes

- Flag keys are `kebab-case`.
- Never read flags via raw `fetch` or a new AppConfig client — always go through `isFeatureEnabled` / `getFeatureFlags`.
- Never bake gating into code. The fallback is a single boolean secret; workspace/org/user/admin scoping is AppConfig-only.
- Never add or propagate request context unless the user chose scoped rollout.
- The admin check reads the DB **replica** (`dbReplica`) and is resolved lazily, so an admin-gated flag adds at most one cheap replica read, and only when `adminEnabled` is the deciding clause.
