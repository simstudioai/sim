import { env } from '@/lib/core/config/env'

/**
 * Build a QuickBooks Online API URL for a specific company (realmId).
 * realmId is captured from the OAuth callback query string at sign-in time
 * and surfaced to tools via the access-token route.
 */
export function getQuickBooksApiBaseUrl(): string {
  return env.QUICKBOOKS_ENV === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com'
}

export function buildCompanyUrl(realmId: string | undefined, path: string): string {
  if (!realmId) {
    throw new Error('QuickBooks realmId missing — reconnect the QuickBooks account')
  }
  const base = getQuickBooksApiBaseUrl()
  const trimmed = path.startsWith('/') ? path : `/${path}`
  return `${base}/v3/company/${realmId}${trimmed}`
}

export function quickbooksAuthHeaders(accessToken: string | undefined): Record<string, string> {
  if (!accessToken) {
    throw new Error('Missing QuickBooks access token')
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}
