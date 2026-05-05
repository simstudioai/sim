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
  return `${base}/v3/company/${encodeURIComponent(realmId)}${trimmed}`
}

/**
 * Reject `where` clause values that contain QQL keywords other than predicates.
 * Prevents callers (or LLMs) from escaping the per-tool entity scope by
 * appending `MAXRESULTS`, `STARTPOSITION`, `ORDERBY`, additional `SELECT`
 * statements, etc.
 */
const FORBIDDEN_WHERE_KEYWORDS =
  /\b(MAXRESULTS|STARTPOSITION|ORDER\s*BY|SELECT|FROM|GROUP\s*BY|HAVING)\b/i

export function sanitizeWhereClause(where: string | undefined): string | undefined {
  if (!where) return undefined
  const trimmed = where.trim()
  if (!trimmed) return undefined
  if (FORBIDDEN_WHERE_KEYWORDS.test(trimmed)) {
    throw new Error(
      'where clause may only contain predicate expressions — keywords like MAXRESULTS, STARTPOSITION, ORDER BY, SELECT, and FROM are not allowed'
    )
  }
  return trimmed
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
