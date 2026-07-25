export const BREX_API_BASE = 'https://api.brex.com'

/**
 * Builds the standard headers for Brex API requests.
 */
export function buildBrexHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

/**
 * Parses a Brex API response body, throwing a descriptive error for non-2xx responses.
 */
export async function parseBrexJson(response: Response) {
  if (!response.ok) {
    const text = await response.text()
    let message = text
    try {
      const parsed = JSON.parse(text)
      message = parsed.message ?? text
    } catch {
      message = text
    }
    throw new Error(`Brex API error (${response.status}): ${message}`)
  }
  return response.json()
}

/**
 * Appends a comma-separated value as repeated query parameters (Brex array syntax).
 */
export function appendBrexArrayParam(query: URLSearchParams, key: string, value?: string): void {
  if (!value) return
  for (const item of value.split(',')) {
    const trimmed = item.trim()
    if (trimmed) query.append(key, trimmed)
  }
}

/**
 * Appends standard cursor/limit pagination parameters to a query.
 */
export function appendBrexPagination(
  query: URLSearchParams,
  params: { cursor?: string; limit?: string }
): void {
  if (params.cursor) query.append('cursor', params.cursor)
  if (params.limit) query.append('limit', params.limit)
}

/**
 * Splits a comma-separated string of IDs into a trimmed, non-empty array for
 * use in a JSON request body (as opposed to repeated query parameters).
 */
export function splitBrexIdList(value?: string): string[] | undefined {
  if (!value) return undefined
  const ids = value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  return ids.length > 0 ? ids : undefined
}

/**
 * Converts a timestamp to the timezone-less date-time form the Brex Transactions
 * API requires (e.g., 2026-01-01T00:00:00). Brex rejects timezone-suffixed
 * timestamps on these endpoints, so offsets are converted to UTC and stripped.
 */
export function toBrexDateTime(value: string): string {
  const trimmed = value.trim()
  if (!/(?:z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) return trimmed
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return trimmed
  return parsed.toISOString().slice(0, 19)
}
