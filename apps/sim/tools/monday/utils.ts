import { validateMondayNumericId } from '@/lib/core/security/input-validation'

export const MONDAY_API_URL = 'https://api.monday.com/v2'

export function mondayHeaders(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: accessToken,
    'API-Version': '2026-04',
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
