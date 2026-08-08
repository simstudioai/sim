import { generateInternalToken } from '@/lib/auth/internal'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { HTTP } from '@/executor/constants'

export async function buildAuthHeaders(userId?: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': HTTP.CONTENT_TYPE.JSON,
  }

  if (typeof window === 'undefined') {
    const token = await generateInternalToken(userId)
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

/**
 * Builds a URL for one of Sim's own API routes, as a tagged template:
 *
 * ```ts
 * const url = internalApiUrl`/api/workflows/${workflowId}/deployed`
 * ```
 *
 * Callers pair this with {@link buildAuthHeaders}, so the request carries an internal token for
 * the executing user — which makes it critical that the *route* comes from this module's source
 * and only resource ids come from data. The template's literal segments provide that: they are
 * fixed at author time, and every interpolated value is percent-encoded, so an id can never widen
 * the path into a different route.
 *
 * @throws when the resolved path is not a relative `/api/` path, which would otherwise send an
 * internally-signed request somewhere the caller did not intend.
 */
export function internalApiUrl(segments: TemplateStringsArray, ...values: unknown[]): URL {
  let path = segments[0]
  for (const [index, value] of values.entries()) {
    path += encodeURIComponent(String(value)) + segments[index + 1]
  }

  if (!path.startsWith('/api/')) {
    throw new Error(`Internal API path must start with /api/: ${path}`)
  }

  return new URL(path, getInternalApiBaseUrl())
}

export async function extractAPIErrorMessage(response: Response): Promise<string> {
  const defaultMessage = `API request failed with status ${response.status}`

  try {
    const errorData = await response.json()
    return errorData.error || defaultMessage
  } catch {
    return defaultMessage
  }
}
