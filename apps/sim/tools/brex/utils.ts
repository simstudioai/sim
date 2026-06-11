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
