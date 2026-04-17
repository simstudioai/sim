import { validateMondayNumericId } from '@/lib/core/security/input-validation'

export const MONDAY_API_URL = 'https://api.monday.com/v2'

export function mondayHeaders(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: accessToken,
    'API-Version': '2024-10',
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
