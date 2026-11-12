import type { ToolConfig } from '@/tools/types'

/**
 * SendGrid's v3 API hosts: global users and subusers call api.sendgrid.com, and regional subusers
 * in the EU call api.eu.sendgrid.com. Marketing Campaigns features are not available to EU
 * subusers. See https://www.twilio.com/docs/sendgrid/api-reference/mail-send and
 * https://www.twilio.com/docs/sendgrid/data-residency/faq
 */
const SENDGRID_REGION_ORIGINS = {
  global: 'https://api.sendgrid.com',
  eu: 'https://api.eu.sendgrid.com',
} as const

type SendGridRegion = keyof typeof SENDGRID_REGION_ORIGINS

export const SENDGRID_REGIONS: ReadonlySet<string> = new Set(Object.keys(SENDGRID_REGION_ORIGINS))

/** The region every SendGrid credential and tool used before EU subusers could be chosen. */
export const DEFAULT_SENDGRID_REGION: SendGridRegion = 'global'

export const SENDGRID_REGION_OPTIONS = [
  { value: 'global', label: 'Global (api.sendgrid.com)' },
  { value: 'eu', label: 'EU subuser (api.eu.sendgrid.com)' },
] as const satisfies ReadonlyArray<{ value: SendGridRegion; label: string }>

/**
 * The v3 API base of a SendGrid region. Absent means global, so tools run without a saved
 * credential keep their host; an unknown region is refused rather than guessed.
 */
export function sendGridApiBase(region?: string): string {
  const key = region ?? DEFAULT_SENDGRID_REGION
  if (!SENDGRID_REGIONS.has(key)) throw new Error(`Unknown SendGrid region: ${key}`)
  return `${SENDGRID_REGION_ORIGINS[key as SendGridRegion]}/v3`
}

/** The region a saved SendGrid key was verified in; only the credential fills it. */
export const SENDGRID_REGION_PARAM = {
  type: 'string',
  required: false,
  visibility: 'hidden',
  description: 'SendGrid region of the selected credential: global or eu',
} as const satisfies ToolConfig['params'][string]
