/**
 * Base URL for the Ramp Developer API (v1).
 */
export const RAMP_API_BASE_URL = 'https://api.ramp.com/developer/v1'

/**
 * Builds the standard authorization headers for Ramp API requests.
 * Throws when the OAuth access token has not been resolved yet.
 */
export function buildRampHeaders(params: { accessToken?: string }): Record<string, string> {
  if (!params.accessToken) {
    throw new Error('Missing access token for Ramp API request')
  }
  return {
    Authorization: `Bearer ${params.accessToken}`,
    Accept: 'application/json',
  }
}

/**
 * Builds a Ramp API URL from a path and a map of query parameters,
 * omitting entries whose value is undefined, null, or an empty string.
 */
export function buildRampUrl(
  path: string,
  query: Record<string, string | number | undefined | null> = {}
): string {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    searchParams.set(key, String(value))
  }
  const queryString = searchParams.toString()
  return `${RAMP_API_BASE_URL}${path}${queryString ? `?${queryString}` : ''}`
}

/**
 * Extracts a human-readable error message from a Ramp API error body.
 * Ramp returns structured errors under `error_v2` with a legacy top-level
 * `message` fallback.
 */
export function extractRampError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const body = data as {
      error_v2?: { message?: string; error_code?: string }
      message?: string
      error?: string
    }
    return body.error_v2?.message || body.message || body.error || fallback
  }
  return fallback
}

/**
 * Extracts the `start` cursor from a Ramp paginated response's `page.next`
 * URL so it can be passed back as the `start` parameter of the next request.
 * Returns null when there is no next page.
 */
export function extractNextStart(next: string | null | undefined): string | null {
  if (!next) return null
  try {
    return new URL(next).searchParams.get('start')
  } catch {
    return null
  }
}
