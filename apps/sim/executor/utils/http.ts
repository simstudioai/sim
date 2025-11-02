import { generateInternalToken } from '@/lib/auth/internal'
import { getBaseUrl } from '@/lib/urls/utils'
import { HTTP } from '@/executor/consts'

export async function buildAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': HTTP.CONTENT_TYPE.JSON,
  }

  if (typeof window === 'undefined') {
    const token = await generateInternalToken()
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

export function buildAPIUrl(path: string, params?: Record<string, string>): URL {
  const url = new URL(path, getBaseUrl())

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
