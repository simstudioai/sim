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
 * Resolves a Sim-internal API path against the internal base URL. Callers pair this with
 * {@link buildAuthHeaders}, so the path must be a fixed internal route the caller chose — never a
 * caller- or model-supplied URL, and never a value interpolated into the path unencoded.
 *
 * @throws when `path` is not a relative `/api/` path, which would otherwise send an
 * internally-signed request somewhere the caller did not intend.
 */
export function buildInternalApiUrl(path: string, params?: Record<string, string>): URL {
  if (!path.startsWith('/api/')) {
    throw new Error(`Internal API path must start with /api/: ${path}`)
  }

  const url = new URL(path, getInternalApiBaseUrl())

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value)
      }
    }
  }

  return url
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
