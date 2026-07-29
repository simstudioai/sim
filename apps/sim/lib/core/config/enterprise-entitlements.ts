/**
 * Resolution rules for enterprise features on deployments that do not run
 * billing.
 *
 * On Sim Cloud, entitlement comes from the subscription plan. Self-hosted
 * deployments have no subscription, so entitlement comes from environment
 * configuration instead. Historically each feature invented its own rule: some
 * were closed until their flag was set, others were implicitly open whenever
 * billing was disabled, and three flags were never read at all. This module is
 * the single place those rules live so they cannot drift apart again.
 *
 * Precedence, highest first:
 *   1. The feature's own flag, when set to any recognized value. Setting it to
 *      `false` is meaningful — it turns one feature off inside an otherwise
 *      enabled suite.
 *   2. `ENTERPRISE_ENABLED`, the master switch that turns the suite on.
 *   3. The feature's legacy default, which reproduces the behavior the
 *      deployment had before the master switch existed.
 *
 * Step 3 is what makes upgrades safe: an operator who never sets
 * `ENTERPRISE_ENABLED` keeps exactly the features they had.
 *
 * Kept free of imports from `./env-flags` so that module can build its exported
 * flags on top of this one without a cycle.
 */

/** Enterprise features whose self-hosted availability is configuration-driven. */
export type EnterpriseFeature =
  | 'accessControl'
  | 'auditLogs'
  | 'dataDrains'
  | 'dataRetention'
  | 'forking'
  | 'inbox'
  | 'organizations'
  | 'sessionPolicies'
  | 'sso'
  | 'whitelabeling'

/**
 * What each feature resolved to before `ENTERPRISE_ENABLED` existed, for a
 * deployment with billing off and no per-feature flag set.
 *
 * `true` means the feature was already reachable, because its server gate only
 * asked whether billing was disabled — `isOrganizationOnEnterprisePlan` returns
 * true when billing is off. `false` means the gate was closed until the flag
 * was set.
 *
 * Two entries are deliberately `false` even though a case could be made for
 * `true`:
 *
 * - `auditLogs` was unreachable self-hosted at any flag setting, because the
 *   gate demanded a subscription row that never exists without billing. It is
 *   a new capability here, so it stays opt-in rather than appearing
 *   unannounced.
 * - `dataRetention` gates retention *deletion*, which destroys data. Config
 *   was always writable when billing was off and stays that way; only the
 *   delete pass is gated here. Defaulting it on would start expiring logs on
 *   upgrade against plan defaults the operator never chose.
 *
 * Do not "tidy" these to a uniform value. Each records observed prior behavior,
 * and changing one silently alters a live deployment on upgrade.
 */
export const ENTERPRISE_FEATURE_LEGACY_DEFAULTS: Readonly<Record<EnterpriseFeature, boolean>> = {
  accessControl: false,
  auditLogs: false,
  dataDrains: false,
  dataRetention: false,
  forking: false,
  inbox: true,
  organizations: false,
  sessionPolicies: true,
  sso: false,
  whitelabeling: true,
} as const

interface ResolveEnterpriseEntitlementParams {
  /** The feature's own flag: `undefined` when unset, otherwise the operator's choice. */
  explicit: boolean | undefined
  /** Whether `ENTERPRISE_ENABLED` (or its client twin) is set. */
  masterEnabled: boolean
  /** The feature's entry in {@link ENTERPRISE_FEATURE_LEGACY_DEFAULTS}. */
  legacyDefault: boolean
}

/**
 * Applies the precedence described above. Pure and synchronous so gates can
 * call it at module scope.
 */
export function resolveEnterpriseEntitlement({
  explicit,
  masterEnabled,
  legacyDefault,
}: ResolveEnterpriseEntitlementParams): boolean {
  return explicit ?? (masterEnabled || legacyDefault)
}
