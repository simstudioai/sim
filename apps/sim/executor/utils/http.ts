import { generateInternalToken } from '@/lib/auth/internal'
import type { InternalRoute } from '@/lib/core/utils/internal-route'
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
 * Resolves a declared internal route against the internal base URL.
 *
 * Callers pair this with {@link buildAuthHeaders}, so the request carries an internal token — which
 * is why the route must be an {@link InternalRoute} rather than a string. The brand can only come
 * from an `internalRoute` template, whose literal segments are fixed at author time and whose
 * interpolated ids are percent-encoded, so an id can never widen the path into a different route.
 */
export function buildInternalApiUrl(route: InternalRoute): URL {
  return new URL(route.path, getInternalApiBaseUrl())
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
