import {
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { formatQuickBooksFaultDetail, sanitizeQuickBooksFaultData } from '@/tools/quickbooks/fault'

export const QUICKBOOKS_MINOR_VERSION = '75'
export const QUICKBOOKS_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
export const QUICKBOOKS_MAX_USER_INFO_BYTES = 1024 * 1024
export const QUICKBOOKS_OAUTH_REQUEST_TIMEOUT_MS = 15_000
const QUICKBOOKS_MAX_VALIDATION_ERROR_BYTES = 64 * 1024

export type QuickBooksEnvironment = 'sandbox' | 'production'

export function getQuickBooksApiBaseUrl(environment: QuickBooksEnvironment): string {
  return environment === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com'
}

export function getQuickBooksUserInfoUrl(environment: QuickBooksEnvironment): string {
  return environment === 'sandbox'
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

export function buildQuickBooksCompanyUrl(
  realmId: string,
  resource: string,
  environment: QuickBooksEnvironment
): URL {
  const normalizedRealmId = normalizeQuickBooksRealmId(realmId)
  const url = new URL(
    `/v3/company/${encodeURIComponent(normalizedRealmId)}/${resource}`,
    getQuickBooksApiBaseUrl(environment)
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

export function assertQuickBooksCompanyInfo<T extends { Id?: unknown }>(candidate: unknown): T {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('QuickBooks CompanyInfo response is missing a valid CompanyInfo object')
  }
  const id = (candidate as { Id?: unknown }).Id
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('QuickBooks CompanyInfo response is missing a valid company Id')
  }
  return candidate as T
}

function getQuickBooksTrackingId(headers: Headers): string | null {
  return (
    headers.get('intuit_tid') ?? headers.get('intuit-tid') ?? headers.get('x-request-id') ?? null
  )
}

function getQuickBooksCompanyValidationGuidance(status: number): string | null {
  if (status === 401) return 'Reconnect the QuickBooks credential.'
  if (status === 403) {
    return 'Confirm the QuickBooks accounting scope and access to this company.'
  }
  if (status === 429) {
    return 'QuickBooks rate limit reached; retry after the indicated delay.'
  }
  return null
}

function createQuickBooksCompanyValidationError(response: Response, responseText: string): Error {
  let faultDetail = ''
  if (responseText) {
    try {
      const fault = sanitizeQuickBooksFaultData(JSON.parse(responseText))
      if (fault) faultDetail = formatQuickBooksFaultDetail(fault)
    } catch {}
  }

  const trackingId = getQuickBooksTrackingId(response.headers)
  const retryAfter = response.headers.get('retry-after')
  return new Error(
    [
      `QuickBooks company validation failed with HTTP ${response.status}.`,
      getQuickBooksCompanyValidationGuidance(response.status),
      faultDetail,
      trackingId ? `(Intuit tracking ID: ${trackingId})` : null,
      response.status === 429 && retryAfter ? `(Retry-After: ${retryAfter})` : null,
    ]
      .filter(Boolean)
      .join(' ')
  )
}

export async function fetchValidatedQuickBooksCompanyInfo(
  accessToken: string,
  realmId: string,
  environment: QuickBooksEnvironment
): Promise<QuickBooksCompanyInfoEnvelope> {
  const normalizedRealmId = normalizeQuickBooksRealmId(realmId)
  const response = await fetch(
    buildQuickBooksCompanyUrl(
      normalizedRealmId,
      `companyinfo/${encodeURIComponent(normalizedRealmId)}`,
      environment
    ),
    {
      method: 'GET',
      headers: buildQuickBooksHeaders(accessToken),
      signal: AbortSignal.timeout(QUICKBOOKS_OAUTH_REQUEST_TIMEOUT_MS),
    }
  )

  if (!response.ok) {
    let responseText = ''
    try {
      responseText = await readResponseTextWithLimit(response, {
        maxBytes: QUICKBOOKS_MAX_VALIDATION_ERROR_BYTES,
        label: 'QuickBooks CompanyInfo error response',
      })
    } catch {
      throw new Error(
        `QuickBooks company validation failed with HTTP ${response.status}. The error response exceeded the safe size limit.`
      )
    }
    throw createQuickBooksCompanyValidationError(response, responseText)
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

  assertQuickBooksCompanyInfo(data.CompanyInfo)

  return data
}
