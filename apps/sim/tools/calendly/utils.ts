import { getErrorMessage } from '@sim/utils/errors'
import { safeUrlPathSegment } from '@/tools/url-path'

/**
 * Calendly addresses every resource both by bare UUID and by canonical URI, and users
 * paste whichever one they have. Path segments need the UUID, query filters and request
 * bodies need the URI, so each builder normalizes its input to the form the API expects.
 */

const CALENDLY_API_BASE = 'https://api.calendly.com'

/**
 * Extracts the trailing UUID from a Calendly URI, or takes an already-bare UUID, as an encoded
 * path segment, so a value like `abc?x=1` or `..` cannot change the request path or query.
 */
export function toUuid(value: string, paramName: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  const uuid = trimmed.includes('/') ? (trimmed.split('/').pop() ?? '') : trimmed
  return safeUrlPathSegment(uuid, paramName)
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

/**
 * Parses an optional `json` param that arrives as typed text from the block, or as an object or
 * array from an upstream reference or a model. A blank value is treated as not provided.
 */
export function toOptionalJson(value: unknown, field: string): unknown {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return value
  if (!value.trim()) return undefined

  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`Invalid JSON input for ${field}: ${getErrorMessage(error)}`)
  }
}
