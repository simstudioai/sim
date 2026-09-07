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
 * Rewrites the boolean-valued attributes of an inbound body in place of their
 * string forms, before schema validation sees them.
 *
 * Applied to the whole body rather than to individual fields because the same
 * job sends `active` at the top level, `primary` inside every multi-valued
 * attribute, and both again nested in PATCH operation values.
 */
export function normalizeScimBooleansDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeScimBooleansDeep)
  if (!isRecord(value)) return value
  const next: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    next[key] = BOOLEAN_ATTRIBUTES.has(key.toLowerCase())
      ? normalizeScimBoolean(unwrapSingleElement(nested))
      : normalizeScimBooleansDeep(nested)
  }
  return next
}

/** Attribute names whose value is a boolean everywhere they appear. */
const BOOLEAN_ATTRIBUTES = new Set(['active', 'primary'])

/**
 * Strips a schema URN prefix from an attribute path and lower-cases the
 * attribute name.
 *
 * RFC 7643 makes attribute names case-insensitive, and providers disagree:
 * Okta sends `userName`, Entra sometimes sends `username` and sometimes the
 * fully qualified `urn:...:User:userName`.
 */
export function normalizeAttributePath(path: string): string {
  let value = path.trim()
  if (value.startsWith('/')) value = value.slice(1)
  try {
    value = decodeURIComponent(value)
  } catch {
    // A path that is not valid percent-encoding is used as written; the caller's
    // closed path table rejects it with `invalidPath` either way.
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
  return value
}

/**
 * Microsoft's classic Group schema marker, sent on `POST /Groups` by older
 * provisioning jobs alongside the core Group URN. It carries no attributes and
 * is never stored or returned.
 */
export const ENTRA_LEGACY_GROUP_SCHEMA =
  'http://schemas.microsoft.com/2006/11/ResourceManagement/ADSCIM/2.0/Group'

/** Drops schema URNs that are provider markers rather than real extensions. */
export function stripProviderSchemaMarkers(schemas: readonly string[]): string[] {
  return schemas.filter((schema) => schema !== ENTRA_LEGACY_GROUP_SCHEMA)
}
