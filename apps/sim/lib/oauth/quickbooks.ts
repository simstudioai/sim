import {
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import {
  deriveQuickBooksWebhookAppKey,
  normalizeQuickBooksOAuthClientConfig,
  QUICKBOOKS_WEBHOOK_APP_KEY_PATTERN,
  type QuickBooksOAuthClientConfig,
} from '@/lib/oauth/quickbooks-client-config'
import { QUICKBOOKS_TOKEN_URL } from '@/lib/oauth/quickbooks-constants'
import {
  buildQuickBooksHeaders,
  fetchValidatedQuickBooksCompanyInfo,
  getQuickBooksUserInfoUrl,
  normalizeQuickBooksRealmId as normalizeRealmId,
  QUICKBOOKS_MAX_USER_INFO_BYTES,
  QUICKBOOKS_OAUTH_REQUEST_TIMEOUT_MS,
  type QuickBooksEnvironment,
} from '@/tools/quickbooks/client'

const QUICKBOOKS_ACCOUNT_PREFIX = 'quickbooks:v2:'
const QUICKBOOKS_REVOCATION_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'
const QUICKBOOKS_MAX_REVOCATION_ERROR_BYTES = 64 * 1024
const QUICKBOOKS_MAX_TOKEN_RESPONSE_BYTES = 1024 * 1024

export class QuickBooksTokenRevocationError extends Error {
  readonly retryable: boolean

  constructor(
    readonly status: number,
    readonly code?: string
  ) {
    super(`QuickBooks token revocation failed with HTTP ${status}`)
    this.name = 'QuickBooksTokenRevocationError'
    this.retryable = status === 429 || status >= 500
  }
}

function parseQuickBooksRevocationErrorCode(responseBody: string): string | undefined {
  if (!responseBody) return undefined
  try {
    const value = JSON.parse(responseBody) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const error = (value as Record<string, unknown>).error
    const code =
      typeof error === 'string'
        ? error
        : error && typeof error === 'object' && !Array.isArray(error)
          ? (error as Record<string, unknown>).code
          : undefined
    if (typeof code !== 'string') return undefined
    const normalized = code.trim().toLowerCase()
    return /^[a-z0-9_.-]{1,100}$/.test(normalized) ? normalized : undefined
  } catch {
    return undefined
  }
}

export interface QuickBooksAccountIdentity {
  appKey: string
  realmId: string
  subject: string
  environment: QuickBooksEnvironment
}

export interface QuickBooksConnectionProfile extends QuickBooksAccountIdentity {
  accountId: string
  name: string
  email: string
  emailVerified: boolean
}

export function normalizeQuickBooksRealmId(realmId: string): string {
  return normalizeRealmId(realmId)
}

function normalizeSubject(subject: string): string {
  const normalized = subject.trim()
  if (!normalized) {
    throw new Error('QuickBooks user identity is invalid. Reconnect the QuickBooks credential.')
  }
  return normalized
}

export function createQuickBooksAccountId(
  realmId: string,
  subject: string,
  clientConfig: Pick<QuickBooksOAuthClientConfig, 'clientId' | 'environment'>
): string {
  const encodedSubject = Buffer.from(normalizeSubject(subject), 'utf8').toString('base64url')
  const appKey = deriveQuickBooksWebhookAppKey(clientConfig)
  return `${QUICKBOOKS_ACCOUNT_PREFIX}${appKey}:${clientConfig.environment}:${normalizeQuickBooksRealmId(realmId)}:${encodedSubject}`
}

export function parseQuickBooksAccountId(accountId: string): QuickBooksAccountIdentity {
  if (!accountId.startsWith(QUICKBOOKS_ACCOUNT_PREFIX)) {
    throw new Error('QuickBooks company identity is missing. Reconnect the QuickBooks credential.')
  }

  const value = accountId.slice(QUICKBOOKS_ACCOUNT_PREFIX.length)
  const firstSeparatorIndex = value.indexOf(':')
  const secondSeparatorIndex = value.indexOf(':', firstSeparatorIndex + 1)
  const thirdSeparatorIndex = value.indexOf(':', secondSeparatorIndex + 1)
  if (
    firstSeparatorIndex <= 0 ||
    secondSeparatorIndex <= firstSeparatorIndex + 1 ||
    thirdSeparatorIndex <= secondSeparatorIndex + 1
  ) {
    throw new Error('QuickBooks company identity is invalid. Reconnect the QuickBooks credential.')
  }
  const appKey = value.slice(0, firstSeparatorIndex)
  if (!QUICKBOOKS_WEBHOOK_APP_KEY_PATTERN.test(appKey)) {
    throw new Error('QuickBooks app identity is invalid. Reconnect the QuickBooks credential.')
  }
  const environment = value.slice(firstSeparatorIndex + 1, secondSeparatorIndex)
  if (environment !== 'sandbox' && environment !== 'production') {
    throw new Error('QuickBooks environment is invalid. Reconnect the QuickBooks credential.')
  }
  const realmId = normalizeQuickBooksRealmId(
    value.slice(secondSeparatorIndex + 1, thirdSeparatorIndex)
  )
  const encodedSubject = value.slice(thirdSeparatorIndex + 1)
  if (!encodedSubject) {
    throw new Error('QuickBooks company identity is invalid. Reconnect the QuickBooks credential.')
  }

  let subject: string
  try {
    subject = normalizeSubject(Buffer.from(encodedSubject, 'base64url').toString('utf8'))
    if (Buffer.from(subject, 'utf8').toString('base64url') !== encodedSubject) {
      throw new Error('Non-canonical QuickBooks user identity')
    }
  } catch {
    throw new Error('QuickBooks user identity is invalid. Reconnect the QuickBooks credential.')
  }
  return { appKey, realmId, subject, environment }
}

export async function revokeQuickBooksToken(
  token: string,
  clientConfig: QuickBooksOAuthClientConfig,
  signal?: AbortSignal
): Promise<void> {
  const normalizedToken = token.trim()
  if (!normalizedToken) {
    throw new Error('QuickBooks token revocation requires a token')
  }
  const normalizedClientConfig = normalizeQuickBooksOAuthClientConfig(clientConfig)

  let response: Response
  try {
    response = await fetch(QUICKBOOKS_REVOCATION_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${normalizedClientConfig.clientId}:${normalizedClientConfig.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: normalizedToken }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(QUICKBOOKS_OAUTH_REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(QUICKBOOKS_OAUTH_REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new Error('QuickBooks token revocation request failed')
  }

  if (!response.ok) {
    const responseBody = await readResponseTextWithLimit(response, {
      maxBytes: QUICKBOOKS_MAX_REVOCATION_ERROR_BYTES,
      label: 'QuickBooks token revocation error response',
    }).catch(() => '')
    const errorCode = parseQuickBooksRevocationErrorCode(responseBody)
    if (errorCode === 'invalid_token') return
    throw new QuickBooksTokenRevocationError(response.status, errorCode)
  }
}

export async function fetchQuickBooksConnectionProfile(
  accessToken: string,
  callbackRealmId: string,
  clientConfig: Pick<QuickBooksOAuthClientConfig, 'clientId' | 'environment'>
): Promise<QuickBooksConnectionProfile> {
  const realmId = normalizeQuickBooksRealmId(callbackRealmId)
  const response = await fetch(getQuickBooksUserInfoUrl(clientConfig.environment), {
    headers: buildQuickBooksHeaders(accessToken),
    signal: AbortSignal.timeout(QUICKBOOKS_OAUTH_REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    await readResponseTextWithLimit(response, {
      maxBytes: QUICKBOOKS_MAX_USER_INFO_BYTES,
      label: 'QuickBooks UserInfo error response',
    }).catch(() => {})
    throw new Error(`QuickBooks UserInfo request failed with HTTP ${response.status}`)
  }

  const profile = await readResponseJsonWithLimit<{
    sub?: string
    name?: string
    givenName?: string
    familyName?: string
    given_name?: string
    family_name?: string
    email?: string
    emailVerified?: unknown
    email_verified?: unknown
  }>(response, {
    maxBytes: QUICKBOOKS_MAX_USER_INFO_BYTES,
    label: 'QuickBooks UserInfo response',
  })

  const subject = profile.sub?.trim()
  const email = profile.email?.trim()
  const givenName = (profile.givenName ?? profile.given_name)?.trim()
  const familyName = (profile.familyName ?? profile.family_name)?.trim()
  const name = profile.name?.trim() || [givenName, familyName].filter(Boolean).join(' ')
  const emailVerified = (profile.emailVerified ?? profile.email_verified) === true

  if (!subject || !email || !name) {
    throw new Error('QuickBooks UserInfo did not return the required user identity')
  }
  if (!emailVerified) {
    throw new Error('QuickBooks UserInfo did not return a verified email address')
  }

  await fetchValidatedQuickBooksCompanyInfo(accessToken, realmId, clientConfig.environment)

  return {
    accountId: createQuickBooksAccountId(realmId, subject, clientConfig),
    appKey: deriveQuickBooksWebhookAppKey(clientConfig),
    realmId,
    subject: normalizeSubject(subject),
    environment: clientConfig.environment,
    name,
    email,
    emailVerified,
  }
}

export interface QuickBooksTokenExchangeResult {
  accessToken: string
  refreshToken: string
  accessTokenExpiresIn: number
  refreshTokenExpiresIn: number
  scope: string
  idToken?: string
}

export async function exchangeQuickBooksAuthorizationCode(params: {
  code: string
  redirectUri: string
  clientConfig: QuickBooksOAuthClientConfig
  signal?: AbortSignal
}): Promise<QuickBooksTokenExchangeResult> {
  const clientConfig = normalizeQuickBooksOAuthClientConfig(params.clientConfig)
  const response = await fetch(QUICKBOOKS_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${clientConfig.clientId}:${clientConfig.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
    }).toString(),
    redirect: 'error',
    signal: params.signal
      ? AbortSignal.any([params.signal, AbortSignal.timeout(QUICKBOOKS_OAUTH_REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(QUICKBOOKS_OAUTH_REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    await readResponseTextWithLimit(response, {
      maxBytes: QUICKBOOKS_MAX_TOKEN_RESPONSE_BYTES,
      label: 'QuickBooks OAuth token error response',
    }).catch(() => {})
    throw new Error(`QuickBooks token exchange failed with HTTP ${response.status}`)
  }

  const data = await readResponseJsonWithLimit<Record<string, unknown>>(response, {
    maxBytes: QUICKBOOKS_MAX_TOKEN_RESPONSE_BYTES,
    label: 'QuickBooks OAuth token response',
  })
  const accessToken = typeof data.access_token === 'string' ? data.access_token.trim() : ''
  const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token.trim() : ''
  const accessTokenExpiresIn = data.expires_in
  const refreshTokenExpiresIn = data.x_refresh_token_expires_in
  const scope = typeof data.scope === 'string' ? data.scope.trim() : ''
  const idToken = typeof data.id_token === 'string' ? data.id_token.trim() : ''
  if (
    !accessToken ||
    !refreshToken ||
    typeof accessTokenExpiresIn !== 'number' ||
    !Number.isSafeInteger(accessTokenExpiresIn) ||
    accessTokenExpiresIn <= 0 ||
    typeof refreshTokenExpiresIn !== 'number' ||
    !Number.isSafeInteger(refreshTokenExpiresIn) ||
    refreshTokenExpiresIn <= 0
  ) {
    throw new Error('QuickBooks token exchange returned an invalid token response')
  }
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresIn,
    refreshTokenExpiresIn,
    scope,
    ...(idToken ? { idToken } : {}),
  }
}
