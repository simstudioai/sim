import { validateMondayNumericId } from '@/lib/core/security/input-validation'

export const MONDAY_API_URL = 'https://api.monday.com/v2'

/**
 * monday.com API version pinned via the `API-Version` header. Single source of
 * truth for every monday surface (tools, selector routes, webhook subscription
 * management, and the knowledge base connector) — they must not diverge,
 * because monday resolves a deprecated version to the Maintenance version and
 * an unrecognized one to Current, so a stale pin silently changes the schema
 * served without any error.
 *
 * Lifecycle: `2026-04` became Current on 2026-04-01 and entered Maintenance on
 * 2026-07-01. Its deprecation date is still TBA and monday announces
 * deprecations at least six months in advance, so it is served as declared. It
 * is deliberately held rather than bumped to `2026-07` (Current), which carries
 * breaking changes that would need separate verification: the `User` /
 * `Query.users` overhaul and `Board.columns` losing its `capabilities` default.
 *
 * `2026-04` also satisfies the 2025-01 minimum required by the `display_value`
 * field the connector selects on mirror, formula, connect-board, and dependency
 * column values.
 *
 * @see https://developer.monday.com/api-reference/docs/api-versioning
 */
export const MONDAY_API_VERSION = '2026-04'

export function mondayHeaders(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: accessToken,
    'API-Version': MONDAY_API_VERSION,
  }
}

/**
 * Validates a Monday.com numeric ID and returns the sanitized string.
 * Delegates to validateMondayNumericId; throws on invalid input.
 */
export function sanitizeNumericId(value: string | number, paramName: string): string {
  const result = validateMondayNumericId(value, paramName)
  if (!result.isValid) {
    throw new Error(result.error!)
  }
  return result.sanitized!
}

/**
 * Coerces a limit/page param to a safe integer within bounds.
 */
export function sanitizeLimit(value: number | undefined, defaultVal: number, max: number): number {
  const n = Number(value ?? defaultVal)
  if (!Number.isFinite(n) || n < 1) return defaultVal
  return Math.min(n, max)
}

/**
 * Validates a GraphQL enum literal (e.g., board_kind, column_type) against an
 * allowlist and returns the bare, unquoted value for safe inlining. GraphQL
 * enums must NOT be JSON-stringified; this guards against query injection by
 * rejecting anything outside the provided set.
 */
export function sanitizeEnum(
  value: string | undefined,
  paramName: string,
  allowed: readonly string[]
): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!allowed.includes(normalized)) {
    throw new Error(`Invalid ${paramName}: "${value}". Expected one of: ${allowed.join(', ')}`)
  }
  return normalized
}

export function extractMondayError(data: Record<string, unknown>): string | null {
  if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) {
    const messages = (data.errors as Array<Record<string, unknown>>)
      .map((e) => e.message as string)
      .filter(Boolean)
    return messages.length > 0 ? messages.join('; ') : 'Unknown Monday.com API error'
  }
  if (data.error_message) {
    return data.error_message as string
  }
  return null
}
