# Add Feature Flag Skill

You add a **runtime, gated feature flag** to Sim — one that can be turned on for specific orgs, users, or admins and changed on prod with no redeploy (AWS AppConfig), falling back to an in-file default everywhere else.

## When to use this vs `env-flags.ts`

- **Feature flag** (`@/lib/core/config/feature-flags.ts`): per-request, gated by `userId`/`orgId`/admin, changeable at runtime. This skill.
- **Env flag** (`@/lib/core/config/env-flags.ts`): deploy-time capability/environment detection (`isProd`, `isHosted`, `isBillingEnabled`). A module-load boolean. **Do not add gated flags here.**

If the user wants a fixed per-deployment toggle, send them to `env-flags.ts` instead.

## The flag model

A flag is a named rule in `apps/sim/lib/core/config/feature-flags.ts`. It is ON for a context when **any** clause matches:

```ts
interface FeatureFlagRule {
  enabled?: boolean   // global default for everyone
  orgIds?: string[]   // allowlisted organization ids
  userIds?: string[]  // allowlisted user ids
  admins?: boolean    // platform admins (user.role === 'admin')
}
```

## Steps

1. **Define the default.** Add an entry to `DEFAULT_FEATURE_FLAGS` in `apps/sim/lib/core/config/feature-flags.ts`. This is the source of truth off-AppConfig (self-hosted/OSS, local dev) and documents the intended shape. Use a **kebab-case** key:

   ```ts
   const DEFAULT_FEATURE_FLAGS: FeatureFlagsConfig = {
     flags: {
       '<flag-name>': { admins: true },
     },
   }
   ```

   Default conservatively (usually `{ admins: true }` or empty `{}` so it's off for everyone until you roll out).

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

3. **(Prod) publish to AppConfig.** The infra `feature-flags` profile schema is permissive, so a new flag needs **no infra change**. Operators add the key under `flags` in the hosted `feature-flags` document and start a `sim-<env>-fast` deployment (see the AppConfig runbook in the infra README — same flow as `access-control`). Until then, prod uses whatever the document already contains; the in-file default applies only when AppConfig is disabled.

4. **Test.** Add a case to `apps/sim/lib/core/config/feature-flags.test.ts` covering the flag's gating (use the `withAppConfig({ flags: { ... } })` helper; mock `isPlatformAdmin` when the `admins` clause is involved).

5. **Clean up after rollout.** When the feature ships to everyone, delete the flag from `DEFAULT_FEATURE_FLAGS`, the AppConfig document, the call sites, and the test. Leaving dead flags around is the main failure mode of flag systems.

## Notes

- Tool IDs / flag keys are `kebab-case`.
- Never read flags via raw `fetch` or a new AppConfig client — always go through `isFeatureEnabled` / `getFeatureFlags`.
- The admin check reads the DB **replica** (`dbReplica`) and is resolved lazily, so an admin-gated flag adds at most one cheap replica read, and only when `admins` is the deciding clause.
