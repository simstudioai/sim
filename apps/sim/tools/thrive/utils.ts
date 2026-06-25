/**
 * Default Thrive API host (Production, all regions except MEA).
 * The Thrive REST API is reached at `https://{host}/rest/{version}`.
 */
export const THRIVE_DEFAULT_HOST = 'public.api.learn.link'

/**
 * Builds the base REST URL for a Thrive API request.
 *
 * @param host - The region-specific API host (e.g. `public.api.learn.link`).
 * @param version - The API version: `v1` for most resources, `v2` for user lifecycle.
 */
export function getThriveBaseUrl(host: string | undefined, version: 'v1' | 'v2'): string {
  const resolvedHost = host?.trim() || THRIVE_DEFAULT_HOST
  return `https://${resolvedHost}/rest/${version}`
}

/**
 * Builds the HTTP Basic authentication headers for a Thrive API request.
 * The Tenant ID is used as the username and the API key as the password.
 */
export function getThriveHeaders(tenantId: string, apiKey: string): Record<string, string> {
  return {
    Authorization: `Basic ${btoa(`${tenantId}:${apiKey}`)}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

/**
 * Appends a query parameter to a URL when the value is defined and non-empty.
 * Numbers are coerced to strings; empty strings and `undefined`/`null` are skipped.
 */
export function appendThriveQuery(
  url: URL,
  key: string,
  value: string | number | boolean | undefined | null
): void {
  if (value === undefined || value === null) return
  const stringValue = typeof value === 'string' ? value.trim() : String(value)
  if (stringValue === '') return
  url.searchParams.set(key, stringValue)
}

/**
 * Parses a value that may be a JSON array string (from LLM/user input) or an
 * already-parsed array into a typed array. Returns an empty array on failure.
 */
export function parseThriveArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return []
    try {
      const parsed = JSON.parse(trimmed)
      return Array.isArray(parsed) ? (parsed as T[]) : [parsed as T]
    } catch {
      return []
    }
  }
  return []
}

/**
 * Reads a Thrive API response, throwing a descriptive error on non-2xx status.
 * Tolerates empty bodies (returned by some delete endpoints) and non-JSON bodies.
 */
export async function parseThriveResponse<T = any>(
  response: Response,
  fallbackError: string
): Promise<T> {
  const text = await response.text()
  let data: any = {}
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
  }

  if (!response.ok) {
    const message =
      (data && typeof data.message === 'string' && data.message) ||
      (data && typeof data.error === 'string' && data.error) ||
      fallbackError
    throw new Error(message)
  }

  return data as T
}
