import type { ZohoDeskBaseParams } from '@/tools/zoho_desk/types'

/** Default Zoho Desk REST host when no data-center-specific base was persisted. */
const DEFAULT_ZOHO_DESK_BASE = 'https://desk.zoho.com'

/**
 * Resolve the Zoho Desk REST API base (`{deskBase}/api/v1`). `apiDomain` is the
 * data-center-scoped Desk base persisted from the OAuth token response, so calls
 * always reach the correct data center instead of assuming `desk.zoho.com`.
 */
export function getZohoDeskApiBase(params: Pick<ZohoDeskBaseParams, 'apiDomain'>): string {
  const base = (params.apiDomain || DEFAULT_ZOHO_DESK_BASE).replace(/\/+$/, '')
  return `${base}/api/v1`
}

/** Build the auth + org headers required on every Zoho Desk API call. */
export function buildZohoDeskHeaders(
  params: Pick<ZohoDeskBaseParams, 'accessToken' | 'orgId'>
): Record<string, string> {
  if (!params.accessToken) throw new Error('Zoho Desk access token is required')
  if (!params.orgId) throw new Error('Zoho Desk organization ID is required')
  return {
    Authorization: `Zoho-oauthtoken ${params.accessToken}`,
    orgId: String(params.orgId),
    'Content-Type': 'application/json',
  }
}

/** Extract a human-readable error message from a Zoho Desk error response body. */
export function getZohoDeskErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    if (typeof record.message === 'string' && record.message.trim()) return record.message
    if (typeof record.errorCode === 'string' && record.errorCode.trim()) return record.errorCode
  }
  return fallback
}
