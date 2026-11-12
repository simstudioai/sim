import type { ToolConfig } from '@/tools/types'

/**
 * LaunchDarkly instances and the base URI each one's REST API answers on. An access token is
 * created in, and only works on, one instance. Commercial is the default; EU and federal
 * accounts use their own hosts. See https://launchdarkly.com/docs/api
 */
const LAUNCHDARKLY_INSTANCE_ORIGINS = {
  us: 'https://app.launchdarkly.com',
  eu: 'https://app.eu.launchdarkly.com',
  federal: 'https://app.launchdarkly.us',
} as const

type LaunchDarklyInstance = keyof typeof LAUNCHDARKLY_INSTANCE_ORIGINS

export const LAUNCHDARKLY_INSTANCES: ReadonlySet<string> = new Set(
  Object.keys(LAUNCHDARKLY_INSTANCE_ORIGINS)
)

/** The instance every LaunchDarkly credential and tool used before instances could be chosen. */
export const DEFAULT_LAUNCHDARKLY_INSTANCE: LaunchDarklyInstance = 'us'

export const LAUNCHDARKLY_INSTANCE_OPTIONS = [
  { value: 'us', label: 'Commercial (app.launchdarkly.com)' },
  { value: 'eu', label: 'EU (app.eu.launchdarkly.com)' },
  { value: 'federal', label: 'Federal (app.launchdarkly.us)' },
] as const satisfies ReadonlyArray<{ value: LaunchDarklyInstance; label: string }>

/**
 * The REST API base of a LaunchDarkly instance. Absent means the commercial instance, so tools
 * run without a saved credential keep their host; an unknown instance is refused rather than
 * sent to a host its token was not issued for.
 */
export function launchDarklyApiBase(instance?: string): string {
  const key = instance ?? DEFAULT_LAUNCHDARKLY_INSTANCE
  if (!LAUNCHDARKLY_INSTANCES.has(key)) {
    throw new Error(`Unknown LaunchDarkly instance: ${key}`)
  }
  return `${LAUNCHDARKLY_INSTANCE_ORIGINS[key as LaunchDarklyInstance]}/api/v2`
}

/** The instance a saved LaunchDarkly credential was verified on; only the credential fills it. */
export const LAUNCHDARKLY_INSTANCE_PARAM = {
  type: 'string',
  required: false,
  visibility: 'hidden',
  description: 'LaunchDarkly instance of the selected credential: us, eu, or federal',
} as const satisfies ToolConfig['params'][string]
