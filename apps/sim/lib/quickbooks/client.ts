import { env } from '@/lib/core/config/env'
import {
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { formatQuickBooksFaultDetail, sanitizeQuickBooksFaultData } from '@/lib/quickbooks/fault'

export const QUICKBOOKS_MINOR_VERSION = '75'
export const QUICKBOOKS_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
export const QUICKBOOKS_MAX_USER_INFO_BYTES = 1024 * 1024

export type QuickBooksEnvironment = 'sandbox' | 'production'

export function getQuickBooksEnvironment(): QuickBooksEnvironment {
  const value = env.QUICKBOOKS_ENV ?? 'sandbox'
  if (value !== 'sandbox' && value !== 'production') {
    throw new Error('QUICKBOOKS_ENV must be either "sandbox" or "production"')
  }
  return value
}

export function getQuickBooksApiBaseUrl(): string {
  return getQuickBooksEnvironment() === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com'
}

export function getQuickBooksUserInfoUrl(): string {
  return getQuickBooksEnvironment() === 'sandbox'
    ? 'https://sandbox-accounts.platform.intuit.com/v1/openid_connect/userinfo'
    : 'https://accounts.platform.intuit.com/v1/openid_connect/userinfo'
}

export function normalizeQuickBooksRealmId(realmId: string): string {
  const normalized = realmId.trim()
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error('QuickBooks company identity is invalid. Reconnect the QuickBooks credential.')
  }
  return normalized
}

export function buildQuickBooksCompanyUrl(realmId: string, resource: string): URL {
  const normalizedRealmId = normalizeQuickBooksRealmId(realmId)
  const url = new URL(
    `/v3/company/${encodeURIComponent(normalizedRealmId)}/${resource}`,
    getQuickBooksApiBaseUrl()
  )
  url.searchParams.set('minorversion', QUICKBOOKS_MINOR_VERSION)
  return url
}

export function buildQuickBooksHeaders(accessToken: string): Record<string, string> {
  const normalizedToken = accessToken.trim()
  if (!normalizedToken) {
    throw new Error('QuickBooks access token is missing. Reconnect the QuickBooks credential.')
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${normalizedToken}`,
  }
}

export interface QuickBooksCompanyInfoEnvelope {
  CompanyInfo?: {
    Id?: string
    CompanyName?: string
    LegalName?: string
    [key: string]: unknown
  }
  time?: string
}

export async function fetchValidatedQuickBooksCompanyInfo(
  accessToken: string,
  realmId: string
): Promise<QuickBooksCompanyInfoEnvelope> {
  const normalizedRealmId = normalizeQuickBooksRealmId(realmId)
  const response = await fetch(
    buildQuickBooksCompanyUrl(
      normalizedRealmId,
      `companyinfo/${encodeURIComponent(normalizedRealmId)}`
    ),
    {
      method: 'GET',
      headers: buildQuickBooksHeaders(accessToken),
    }
  )

  if (!response.ok) {
    await readResponseTextWithLimit(response, {
      maxBytes: 64 * 1024,
      label: 'QuickBooks CompanyInfo error response',
    }).catch(() => {})
    throw new Error(`QuickBooks company validation failed with HTTP ${response.status}`)
  }

  const data = await readResponseJsonWithLimit<QuickBooksCompanyInfoEnvelope>(response, {
    maxBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
    label: 'QuickBooks CompanyInfo response',
  })

  const fault = sanitizeQuickBooksFaultData(data)
  if (fault) {
    const detail = formatQuickBooksFaultDetail(fault)
    throw new Error(
      ['QuickBooks company validation failed.', detail, 'Reconnect the QuickBooks credential.']
        .filter(Boolean)
        .join(' ')
    )
  }

  if (!data.CompanyInfo || String(data.CompanyInfo.Id ?? '').trim() !== normalizedRealmId) {
    throw new Error(
      'QuickBooks company validation returned a different company. Reconnect the QuickBooks credential.'
    )
  }

  return data
}
