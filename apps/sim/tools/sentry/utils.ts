import type { ToolConfig } from '@/tools/types'

/**
 * Sentry's SaaS API hosts per data storage location: sentry.io for organizations whose data is
 * stored in the US, and de.sentry.io for the EU, which keeps API requests inside the selected
 * location. See https://docs.sentry.io/api/ and
 * https://docs.sentry.io/organization/data-storage-location/
 */
const SENTRY_REGION_ORIGINS = {
  us: 'https://sentry.io',
  de: 'https://de.sentry.io',
} as const

type SentryRegion = keyof typeof SENTRY_REGION_ORIGINS

export const SENTRY_REGIONS: ReadonlySet<string> = new Set(Object.keys(SENTRY_REGION_ORIGINS))

/** The region every Sentry credential and tool used before the EU could be chosen. */
export const DEFAULT_SENTRY_REGION: SentryRegion = 'us'

export const SENTRY_REGION_OPTIONS = [
  { value: 'us', label: 'US (sentry.io)' },
  { value: 'de', label: 'EU (de.sentry.io)' },
] as const satisfies ReadonlyArray<{ value: SentryRegion; label: string }>

/**
 * The `/api/0` base of a Sentry region. Absent means the US host, so tools run without a saved
 * credential keep their host; an unknown region is refused rather than guessed.
 */
export function sentryApiBase(region?: string): string {
  const key = region ?? DEFAULT_SENTRY_REGION
  if (!SENTRY_REGIONS.has(key)) throw new Error(`Unknown Sentry region: ${key}`)
  return `${SENTRY_REGION_ORIGINS[key as SentryRegion]}/api/0`
}

/** The region a saved Sentry token was verified in; only the credential fills it. */
export const SENTRY_REGION_PARAM = {
  type: 'string',
  required: false,
  visibility: 'hidden',
  description: 'Sentry data storage region of the selected credential: us or de',
} as const satisfies ToolConfig['params'][string]
