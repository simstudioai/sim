import { createLogger } from '@sim/logger'

const logger = createLogger('SelectorHelpers')

interface FetchJsonOptions extends RequestInit {
  searchParams?: Record<string, string | number | undefined | null>
}

export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const { searchParams, headers, ...rest } = options
  let finalUrl = url
  if (searchParams) {
    const params = new URLSearchParams()
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return
      params.set(key, String(value))
    })
    const qs = params.toString()
    if (qs) {
      finalUrl = `${url}${url.includes('?') ? '&' : '?'}${qs}`
    }
  }

  const response = await fetch(finalUrl, {
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    ...rest,
  })

  if (!response.ok) {
    let message = `Failed request ${response.status}`
    try {
      const err = await response.json()
      message = err.error || err.message || message
    } catch (error) {
      logger.warn('Failed to parse error response', { error })
    }
    throw new Error(message)
  }

  return response.json()
}

interface TokenResponse {
  accessToken?: string
}

export async function fetchOAuthToken(
  credentialId: string,
  workflowId?: string
): Promise<string | null> {
  if (!credentialId) return null
  const body = JSON.stringify({ credentialId, workflowId })
  const token = await fetchJson<TokenResponse>('/api/auth/oauth/token', {
    method: 'POST',
    body,
  })
  return token.accessToken ?? null
}
