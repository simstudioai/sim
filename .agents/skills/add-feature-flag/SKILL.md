---
name: add-feature-flag
description: Add a runtime gated feature flag (AppConfig-backed on prod, secret fallback off-prod), gated by org id, user id, or admin
argument-hint: <flag-name>
---

# Add Feature Flag Skill

You add a **runtime, gated feature flag** to Sim — one that can be turned on for specific orgs, users, or admins and changed on prod with no redeploy (AWS AppConfig). When AppConfig isn't the source of truth, the flag falls back to a single **secret** (on/off only).

## When to use this vs `env-flags.ts`

- **Feature flag** (`@/lib/core/config/feature-flags.ts`): per-request, gated by `userId`/`orgId`/admin, changeable at runtime. This skill.
- **Env flag** (`@/lib/core/config/env-flags.ts`): deploy-time capability/environment detection (`isProd`, `isHosted`, `isBillingEnabled`). A module-load boolean. **Do not add gated flags here.**

If the user wants a fixed per-deployment toggle, send them to `env-flags.ts` instead.

## The flag model

A flag's **gating rule lives only in the hosted AppConfig document**. It is ON for a context when any clause matches:

```ts
interface FeatureFlagRule {
  enabled?: boolean   // global default for everyone
  orgIds?: string[]   // allowlisted organization ids
  userIds?: string[]  // allowlisted user ids
  admins?: boolean    // platform admins (user.role === 'admin')
}
```

Critically, **none of this is expressible in code** — gating (especially `admins`) can only be set through AppConfig, so no environment can grant access from a code literal. Off-AppConfig (self-hosted/OSS/local), a flag is simply on or off, derived from its fallback secret.

## Steps

1. **Define the flag.** Add one entry to the `FEATURE_FLAGS` registry in `apps/sim/lib/core/config/feature-flags.ts`. Each entry is the flag's whole definition — name (kebab-case key), `description`, and the `fallback` secret consulted when AppConfig isn't the source of truth (truthy ⇒ on globally):

   ```ts
   const FEATURE_FLAGS = {
     '<flag-name>': {
       description: '<what this gates>',
       fallback: '<FLAG_SECRET>',
     },
   }
   ```

   `fallback` is the env/secret key (typed as `keyof typeof env`), so add `<FLAG_SECRET>` to `apps/sim/lib/core/config/env.ts` first (and the deployment's secret store) — it won't typecheck otherwise. Do **not** add org/user/admin defaults here — that gating exists only in AppConfig. Adding the entry makes `<flag-name>` a valid `FeatureFlagName`.

2. **Gate the call site.** Call `isFeatureEnabled` with whatever ids you have — admin status is resolved internally, so callers never pass it:

   ```ts
   import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

   if (await isFeatureEnabled('<flag-name>', { userId, orgId })) {
     // gated behavior
   }
   ```

   - Missing ids are fine — a clause with no matching id is skipped; with no `userId`, the admin clause resolves to `false` without a DB read.
   - Admin routes that already know the caller is an admin may pass `{ userId, isAdmin: true }` to skip the role lookup.
   - **Client/UI flags:** resolve server-side (in a server component, route, or loader) and pass the boolean down as a prop. There is no client AppConfig.

3. **(Prod) configure in AppConfig.** The infra `feature-flags` profile schema is permissive, so a new flag needs **no infra change**. Operators add the flag under `flags` in the hosted `feature-flags` document — including any `orgIds`/`userIds`/`admins` gating — and start a `sim-<env>-fast` deployment (see the AppConfig runbook in the infra README — same flow as `access-control`). The fallback secret only applies when AppConfig is disabled.

4. **Test.** Add a case to `apps/sim/lib/core/config/feature-flags.test.ts`: use `withAppConfig({ flags: { ... } })` to cover the gating rule (mock `isPlatformAdmin` for the `admins` clause), and toggle the fallback secret to cover the off-AppConfig path.

5. **Clean up after rollout.** When the feature ships to everyone, delete the flag's entry from `FEATURE_FLAGS`, the `<FLAG_SECRET>` env entry, the AppConfig document, the call sites, and the test. Leaving dead flags around is the main failure mode of flag systems.

## Notes

- Flag keys are `kebab-case`.
- Never read flags via raw `fetch` or a new AppConfig client — always go through `isFeatureEnabled` / `getFeatureFlags`.
- Never bake gating into code. The fallback is a single boolean secret; org/user/admin scoping is AppConfig-only.
- The admin check reads the DB **replica** (`dbReplica`) and is resolved lazily, so an admin-gated flag adds at most one cheap replica read, and only when `admins` is the deciding clause.
