import { getErrorMessage } from '@sim/utils/errors'

/**
 * Calendly addresses every resource both by bare UUID and by canonical URI, and users
 * paste whichever one they have. Path segments need the UUID, query filters and request
 * bodies need the URI, so each builder normalizes its input to the form the API expects.
 */

const CALENDLY_API_BASE = 'https://api.calendly.com'

/** Extracts the trailing UUID from a Calendly URI, or returns an already-bare UUID unchanged. */
export function toUuid(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  return trimmed.includes('/') ? (trimmed.split('/').pop() as string) : trimmed
}

/** Expands a bare UUID into a canonical resource URI, or returns an already-full URI unchanged. */
export function toResourceUri(value: string, collection: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  return trimmed.startsWith('http') ? trimmed : `${CALENDLY_API_BASE}/${collection}/${trimmed}`
}

/**
 * `json` params reach a tool as a parsed array from the block, but as a raw JSON string when the
 * tool is called directly from the registry, so array bodies normalize both shapes before sending.
 */
export function toStringArray(value: string[] | string | undefined, field: string): string[] {
  if (value === undefined) return []
  if (Array.isArray(value)) return value

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new Error(`Invalid JSON input for ${field}: ${getErrorMessage(error)}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Expected ${field} to be an array of strings.`)
  }

  return parsed as string[]
}
