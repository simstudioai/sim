/**
 * The one declaration of Sim's enterprise features: which environment variable
 * turns each on, what it defaults to, and how it composes with billing, the
 * hosted platform, and the `ENTERPRISE_ENABLED` master switch.
 *
 * On Sim Cloud entitlement comes from the subscription plan, so these flags are
 * only explicit overrides there. Deployments without billing have no plan to
 * consult, so entitlement comes from configuration instead.
 *
 * Server code resolves the registry against its own environment
 * (`apps/sim/lib/core/config/env-flags.ts`); the browser never reads these
 * variables. It receives the server-resolved state through the deployment-shape
 * projection on the root layout, so a feature is one server variable with no
 * `NEXT_PUBLIC_*` twin to keep in sync.
 *
 * Precedence for one feature, highest first:
 *   1. On the hosted platform, a feature with a {@link EnterpriseFeatureDefinition.hostedDefault}
 *      reads its own flag, else that default. Billing and the master switch do not apply.
 *   2. With billing on, the feature's own flag, else off: an unset flag never
 *      widens access beyond the plan.
 *   3. With billing off, the feature's own flag (an explicit `false` turns one
 *      feature off inside an enabled suite), else `ENTERPRISE_ENABLED`, else the
 *      feature's {@link EnterpriseFeatureDefinition.selfHostedDefault}.
 *
 * After that, {@link EnterpriseFeatureDefinition.onWithBilling} and
 * {@link EnterpriseFeatureDefinition.implies} can only turn features on, and they
 * win over an explicit `false`.
 */

/** How one enterprise feature is configured and how it defaults. */
export interface EnterpriseFeatureDefinition<K extends string = string> {
  /** The server environment variable that sets this feature explicitly. */
  readonly envVar: string
  /**
   * The documented default for a deployment without billing whose own flag and
   * `ENTERPRISE_ENABLED` are both unset. Changing one silently alters a live
   * deployment on upgrade, so each value records a product decision.
   */
  readonly selfHostedDefault: boolean
  /** On the hosted platform, the value when the feature's own flag is unset. */
  readonly hostedDefault?: boolean
  /** On whenever billing runs, whatever the flag says. */
  readonly onWithBilling?: boolean
  /** Features this one requires; each is turned on whenever this one is. */
  readonly implies?: readonly K[]
  /** What the setup wizard calls this feature. */
  readonly label: string
  /** A short qualifier the setup wizard shows next to {@link label}. */
  readonly hint?: string
  /**
   * Whether `sim-setup` offers this feature as a one-click self-host unlock.
   * Off for features that need more than a flag to work (an identity provider,
   * a sandbox runtime).
   */
  readonly setupUnlock: boolean
}

/**
 * Builds the registry while typing every `implies` entry against the registry's
 * own keys, so a misspelt dependency is a type error rather than a silent no-op.
 * Keys stay literal; each entry is typed as the full definition, so readers can
 * reach optional fields without widening.
 */
function defineEnterpriseFeatures<
  const T extends Record<string, EnterpriseFeatureDefinition<Extract<keyof T, string>>>,
>(features: T): { readonly [P in keyof T]: EnterpriseFeatureDefinition<Extract<keyof T, string>> } {
  return features
}

/** Every enterprise feature, keyed by its name in the deployment shape. */
export const ENTERPRISE_FEATURES = defineEnterpriseFeatures({
  accessControl: {
    envVar: 'ACCESS_CONTROL_ENABLED',
    selfHostedDefault: false,
    implies: ['organizations'],
    label: 'Access control',
    hint: 'permission groups (implies organizations)',
    setupUnlock: true,
  },
  organizations: {
    envVar: 'ORGANIZATIONS_ENABLED',
    selfHostedDefault: false,
    onWithBilling: true,
    label: 'Organizations',
    hint: 'multi-workspace orgs',
    setupUnlock: true,
  },
  /**
   * Opt-in: audit logs could not be reached self-hosted at any flag setting
   * before this registry existed, so they do not appear unannounced on upgrade.
   */
  auditLogs: {
    envVar: 'AUDIT_LOGS_ENABLED',
    selfHostedDefault: false,
    label: 'Audit logs',
    setupUnlock: true,
  },
  customBlocks: {
    envVar: 'CUSTOM_BLOCKS_ENABLED',
    selfHostedDefault: false,
    label: 'Custom blocks',
    hint: 'reusable org-wide blocks',
    setupUnlock: true,
  },
  /**
   * Opt-in: this gates retention *deletion*. Configuring retention stays
   * possible with billing off; defaulting the delete pass on would start
   * expiring logs against plan defaults the operator never chose.
   */
  dataRetention: {
    envVar: 'DATA_RETENTION_ENABLED',
    selfHostedDefault: false,
    label: 'Data retention',
    hint: 'deletes expired data',
    setupUnlock: true,
  },
  /** On by default without billing: the gate was always open with billing off. */
  sessionPolicies: {
    envVar: 'SESSION_POLICIES_ENABLED',
    selfHostedDefault: true,
    label: 'Session policies',
    hint: 'session lifetime caps',
    setupUnlock: true,
  },
  dataDrains: {
    envVar: 'DATA_DRAINS_ENABLED',
    selfHostedDefault: false,
    label: 'Data drains',
    hint: 'export streams',
    setupUnlock: true,
  },
  forking: {
    envVar: 'FORKING_ENABLED',
    selfHostedDefault: false,
    label: 'Workflow forking',
    setupUnlock: true,
  },
  /**
   * On by default without billing: the gate was always open with billing off.
   * Inbox still needs `COPILOT_API_KEY` to do anything; that check lives at the
   * gate, not here.
   */
  inbox: {
    envVar: 'INBOX_ENABLED',
    selfHostedDefault: true,
    label: 'Inbox',
    setupUnlock: true,
  },
  /** Opt-in: it discloses every member's spend. */
  usageMonitoring: {
    envVar: 'USAGE_MONITORING_ENABLED',
    selfHostedDefault: false,
    label: 'Usage monitoring',
    hint: 'org-wide credit usage',
    setupUnlock: true,
  },
  sso: {
    envVar: 'SSO_ENABLED',
    selfHostedDefault: false,
    label: 'Single sign-on',
    hint: 'SAML and OIDC',
    setupUnlock: false,
  },
  /**
   * On by default on the hosted platform; an explicit `false` there defers
   * activation during a rolling deploy.
   */
  scim: {
    envVar: 'SCIM_ENABLED',
    selfHostedDefault: false,
    hostedDefault: true,
    label: 'Directory provisioning',
    hint: 'SCIM; needs single sign-on',
    setupUnlock: false,
  },
  /**
   * The deployment *entitlement* to custom Function sandboxes. A remote provider
   * and immutable Function base are separate operational prerequisites (see
   * `isSandboxesEnabled` in `apps/sim/lib/core/config/env-flags.ts`), so the
   * feature stays opt-in.
   */
  sandboxes: {
    envVar: 'SANDBOXES_ENABLED',
    selfHostedDefault: false,
    label: 'Custom sandboxes',
    hint: 'needs a remote sandbox provider',
    setupUnlock: false,
  },
  credentialGroups: {
    envVar: 'CREDENTIAL_GROUPS',
    selfHostedDefault: false,
    label: 'Credential groups',
    hint: 'managed connected accounts',
    setupUnlock: false,
  },
})

/** An enterprise feature's key, as it appears in the deployment shape. */
export type EnterpriseFeature = keyof typeof ENTERPRISE_FEATURES

/** Every enterprise feature resolved to on or off. */
export type EnterpriseFeatureState = Readonly<Record<EnterpriseFeature, boolean>>

/** The master switch that turns the whole suite on for a deployment without billing. */
export const ENTERPRISE_MASTER_ENV_VAR = 'ENTERPRISE_ENABLED'

/** Every feature key, in declaration order. */
export const ENTERPRISE_FEATURE_KEYS = Object.keys(ENTERPRISE_FEATURES) as EnterpriseFeature[]

interface ResolveEnterpriseFeaturesInput {
  /** A feature's own flag: `undefined` when unset, otherwise the operator's choice. */
  readFlag(envVar: string): boolean | undefined
  billingEnabled: boolean
  hosted: boolean
  /** Whether `ENTERPRISE_ENABLED` is set. */
  masterEnabled: boolean
}

/**
 * Resolves every enterprise feature for one deployment, applying the precedence
 * described at the top of this module. Pure and synchronous, so it can run at
 * module scope.
 */
export function resolveEnterpriseFeatures({
  readFlag,
  billingEnabled,
  hosted,
  masterEnabled,
}: ResolveEnterpriseFeaturesInput): EnterpriseFeatureState {
  const state = {} as Record<EnterpriseFeature, boolean>
  for (const key of ENTERPRISE_FEATURE_KEYS) {
    const feature = ENTERPRISE_FEATURES[key]
    const explicit = readFlag(feature.envVar)
    let enabled: boolean
    if (hosted && feature.hostedDefault !== undefined) {
      enabled = explicit ?? feature.hostedDefault
    } else if (billingEnabled) {
      enabled = explicit ?? false
    } else {
      enabled = explicit ?? (masterEnabled || feature.selfHostedDefault)
    }
    state[key] = enabled || (billingEnabled && feature.onWithBilling === true)
  }

  let changed = true
  while (changed) {
    changed = false
    for (const key of ENTERPRISE_FEATURE_KEYS) {
      if (!state[key]) continue
      for (const implied of ENTERPRISE_FEATURES[key].implies ?? []) {
        if (state[implied]) continue
        state[implied] = true
        changed = true
      }
    }
  }
  return state
}
