import {
  ENTERPRISE_FEATURE_KEYS,
  ENTERPRISE_FEATURES,
  ENTERPRISE_MASTER_ENV_VAR,
  type EnterpriseFeature,
} from '@sim/deployment-config/enterprise-features'
import { EMAIL_CAPABILITY, inspectCapability } from '@sim/deployment-config/env-capabilities'

/**
 * The features that had a `NEXT_PUBLIC_*` twin before the browser read the
 * projected deployment shape. Frozen history: a feature added since never had one.
 */
const FORMERLY_TWINNED_FEATURES: readonly EnterpriseFeature[] = [
  'sso',
  'scim',
  'accessControl',
  'auditLogs',
  'customBlocks',
  'usageMonitoring',
  'dataRetention',
  'dataDrains',
  'sessionPolicies',
  'forking',
  'organizations',
  'inbox',
]

/** Server switches whose `NEXT_PUBLIC_*` twin the browser no longer reads. Frozen history. */
const FORMERLY_TWINNED_SWITCHES = [
  'BILLING_ENABLED',
  'DISABLE_INVITATIONS',
  'DISABLE_PUBLIC_API',
  'E2B_ENABLED',
  'SLACK_EXTENDED_SCOPES',
] as const

/**
 * `NEXT_PUBLIC_*` variables the app no longer reads. `doctor` flags any still set
 * so an operator does not expect one to do anything; `server`, where present,
 * names the variable that now carries the setting.
 *
 * `NEXT_PUBLIC_SANDBOXES_ENABLED` was a setup-written readiness marker, not a
 * twin: the server verifies the sandbox provider itself, so it has no successor.
 */
export const INERT_BROWSER_FLAGS: ReadonlyArray<{ client: string; server?: string }> = [
  ...[
    ENTERPRISE_MASTER_ENV_VAR,
    ...FORMERLY_TWINNED_FEATURES.map((key) => ENTERPRISE_FEATURES[key].envVar),
    ...FORMERLY_TWINNED_SWITCHES,
  ].map((server) => ({ server, client: `NEXT_PUBLIC_${server}` })),
  { client: 'NEXT_PUBLIC_SANDBOXES_ENABLED' },
]

/** Self-host feature unlocks offered by the wizard's Custom flow. */
export const SELF_HOST_UNLOCKS: ReadonlyArray<{
  server: string
  label: string
  hint?: string
}> = [
  {
    server: ENTERPRISE_MASTER_ENV_VAR,
    label: 'All enterprise features',
    hint: 'enables everything below',
  },
  ...ENTERPRISE_FEATURE_KEYS.filter((key) => ENTERPRISE_FEATURES[key].setupUnlock).map((key) => {
    const feature = ENTERPRISE_FEATURES[key]
    return { server: feature.envVar, label: feature.label, hint: feature.hint }
  }),
]

export function getConfiguredMailProvider(vars: Map<string, string>): string {
  const inspection = inspectCapability(EMAIL_CAPABILITY, vars)
  return (
    inspection.providerIds[0] ??
    inspection.providers.find((provider) => provider.active)?.id ??
    'console'
  )
}

export const LOGIN_PROVIDERS = [
  { id: 'google', label: 'Google', idKey: 'GOOGLE_CLIENT_ID', secretKey: 'GOOGLE_CLIENT_SECRET' },
  { id: 'github', label: 'GitHub', idKey: 'GITHUB_CLIENT_ID', secretKey: 'GITHUB_CLIENT_SECRET' },
  {
    id: 'microsoft',
    label: 'Microsoft',
    idKey: 'MICROSOFT_CLIENT_ID',
    secretKey: 'MICROSOFT_CLIENT_SECRET',
  },
] as const
