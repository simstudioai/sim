/**
 * Tolerances for what identity providers actually send, as distinct from what
 * RFC 7644 describes.
 *
 * Every rule here is a documented provider behavior, not a guess. Microsoft
 * Entra's classic provisioning job sends booleans as the strings `"True"` and
 * `"False"`, capitalizes PATCH operation names, and wraps a single-valued
 * attribute in a one-element array. Rejecting any of those is a failed sync the
 * administrator cannot fix from their side.
 */

/**
 * Reads a SCIM boolean, accepting the string forms Entra sends.
 *
 * Returns the input unchanged when it is neither, so the caller's schema
 * produces the error rather than this function silently coercing nonsense.
 */
export function normalizeScimBoolean(value: unknown): unknown {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return value
  const lowered = value.trim().toLowerCase()
  if (lowered === 'true') return true
  if (lowered === 'false') return false
  return value
}

/**
 * Unwraps `[x]` to `x`.
 *
 * Entra sends a one-element array where the schema declares a single value.
 * Only applied where a scalar is expected, so a genuinely multi-valued
 * attribute keeps its array.
 */
export function unwrapSingleElement(value: unknown): unknown {
  return Array.isArray(value) && value.length === 1 ? value[0] : value
}

/** True when the value is a plain object rather than an array or null. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Strips a schema URN prefix from an attribute path and decodes it.
 *
 * Case is left to the caller, which compares lower-cased: RFC 7643 makes
 * attribute names case-insensitive, and providers disagree — Okta sends
 * `userName`, Entra sometimes `username` and sometimes the fully qualified
 * `urn:...:User:userName`.
 */
export function normalizeAttributePath(path: string): string {
  let value = path.trim()
  if (value.startsWith('/')) value = value.slice(1)
  try {
    value = decodeURIComponent(value)
  } catch {
    /** Invalid percent-encoding is used as written; the closed path table rejects it as `invalidPath`. */
  }
  const lowered = value.toLowerCase()
  const coreUserPrefix = 'urn:ietf:params:scim:schemas:core:2.0:user:'
  const coreGroupPrefix = 'urn:ietf:params:scim:schemas:core:2.0:group:'
  const enterprisePrefix = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:user:'
  if (lowered.startsWith(coreUserPrefix)) return value.slice(coreUserPrefix.length)
  if (lowered.startsWith(coreGroupPrefix)) return value.slice(coreGroupPrefix.length)
  if (lowered.startsWith(enterprisePrefix)) {
    return `enterprise.${value.slice(enterprisePrefix.length)}`
  }
  if (lowered === enterprisePrefix.slice(0, -1)) return 'enterprise'
  return value
}

/** Passwords are write-only, including case variants and core-schema-qualified names. */
export function isScimPasswordAttribute(path: string): boolean {
  return normalizeAttributePath(path).toLowerCase() === 'password'
}

/**
 * Microsoft's classic schema markers, sent by older provisioning jobs alongside
 * the core URNs. They carry no attributes and are never stored or returned.
 */
export const ENTRA_LEGACY_GROUP_SCHEMA =
  'http://schemas.microsoft.com/2006/11/ResourceManagement/ADSCIM/2.0/Group'
const ENTRA_LEGACY_USER_SCHEMA =
  'http://schemas.microsoft.com/2006/11/ResourceManagement/ADSCIM/2.0/User'

/**
 * Restores canonical casing on top-level attribute names.
 *
 * RFC 7643 makes attribute names case-insensitive and Entra sends `username`
 * where the schema says `userName`. Only the names given are touched; anything
 * else passes through so unknown attributes still round-trip as sent.
 */
export function canonicalizeAttributeNames(
  body: unknown,
  canonicalNames: readonly string[]
): unknown {
  if (!isRecord(body)) return body
  const byLower = new Map(canonicalNames.map((name) => [name.toLowerCase(), name]))
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    const canonical = byLower.get(key.toLowerCase())
    if (canonical && !(canonical in body) && !(canonical in result)) result[canonical] = value
    else result[key] = value
  }
  return result
}

/** Drops schema URNs that are provider markers rather than real extensions. */
export function stripProviderSchemaMarkers(schemas: readonly string[]): string[] {
  return schemas.filter(
    (schema) => schema !== ENTRA_LEGACY_GROUP_SCHEMA && schema !== ENTRA_LEGACY_USER_SCHEMA
  )
}
