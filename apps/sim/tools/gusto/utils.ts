export const GUSTO_API_BASE = 'https://api.gusto.com/v1'
export const GUSTO_API_VERSION = '2026-02-01'

export function gustoHeaders(accessToken: string | undefined): Record<string, string> {
  if (!accessToken) {
    throw new Error('Missing access token for Gusto API request')
  }
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Gusto-API-Version': GUSTO_API_VERSION,
    Authorization: `Bearer ${accessToken}`,
  }
}

export function gustoErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (typeof obj.error_description === 'string') return obj.error_description
    if (typeof obj.message === 'string') return obj.message
    if (Array.isArray(obj.errors) && obj.errors.length > 0) {
      const first = obj.errors[0] as Record<string, unknown>
      const msg = typeof first.message === 'string' ? first.message : undefined
      if (msg) return msg
    }
  }
  return fallback
}
