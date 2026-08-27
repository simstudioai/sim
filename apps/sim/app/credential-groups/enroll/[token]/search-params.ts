import { parseAsString } from 'nuqs/server'

/** One-shot OAuth result signals are nullable because absence means no toast. */
export const credentialGroupEnrollmentStatusParsers = {
  connected: parseAsString,
  oauth: parseAsString,
  submitted: parseAsString,
} as const

export const credentialGroupEnrollmentStatusUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
