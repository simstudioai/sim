import { AsyncLocalStorage } from 'node:async_hooks'
import { generateId } from '@sim/utils/id'
import { env } from '@/lib/core/config/env'
import {
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import {
  fetchValidatedQuickBooksCompanyInfo,
  getQuickBooksUserInfoUrl,
  normalizeQuickBooksRealmId as normalizeRealmId,
  QUICKBOOKS_MAX_USER_INFO_BYTES,
  QUICKBOOKS_OAUTH_REQUEST_TIMEOUT_MS,
} from '@/tools/quickbooks/client'

const QUICKBOOKS_ACCOUNT_PREFIX = 'quickbooks:'
const QUICKBOOKS_REVOCATION_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'
const QUICKBOOKS_MAX_REVOCATION_ERROR_BYTES = 64 * 1024
const UUID_SUFFIX_PATTERN =
  /-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
const quickBooksCallbackRealmStorage = new AsyncLocalStorage<string>()

export const QUICKBOOKS_AUTHORIZATION_URL = 'https://appcenter.intuit.com/connect/oauth2'
export const QUICKBOOKS_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
export const QUICKBOOKS_OIDC_CLAIMS = {
  id_token: { realmId: null },
  userinfo: { realmId: null },
} as const

export interface QuickBooksAccountIdentity {
  realmId: string
  subject: string
}

export interface QuickBooksConnectionProfile extends QuickBooksAccountIdentity {
  accountId: string
  name: string
  email: string
  emailVerified: boolean
}

export const normalizeQuickBooksRealmId = normalizeRealmId

export function withQuickBooksCallbackRealm<T>(realmId: string, callback: () => T): T {
  return quickBooksCallbackRealmStorage.run(normalizeQuickBooksRealmId(realmId), callback)
}

export function getQuickBooksCallbackRealm(): string {
  const realmId = quickBooksCallbackRealmStorage.getStore()
  if (!realmId) {
    throw new Error(
      'QuickBooks callback did not include a company identity. Reconnect the QuickBooks credential.'
    )
  }
  return realmId
}

function normalizeSubject(subject: string): string {
  const normalized = subject.trim()
  if (!normalized || normalized.includes(':')) {
    throw new Error('QuickBooks user identity is invalid. Reconnect the QuickBooks credential.')
  }
  return normalized
}

export function createQuickBooksAccountId(
  realmId: string,
  subject: string,
  uniqueId = generateId()
): string {
  return `${QUICKBOOKS_ACCOUNT_PREFIX}${normalizeQuickBooksRealmId(realmId)}:${normalizeSubject(subject)}-${uniqueId}`
}

export function parseQuickBooksAccountId(accountId: string): QuickBooksAccountIdentity {
  if (!accountId.startsWith(QUICKBOOKS_ACCOUNT_PREFIX)) {
    throw new Error('QuickBooks company identity is missing. Reconnect the QuickBooks credential.')
  }

  const value = accountId.slice(QUICKBOOKS_ACCOUNT_PREFIX.length)
  const separatorIndex = value.indexOf(':')
  if (separatorIndex <= 0) {
    throw new Error('QuickBooks company identity is invalid. Reconnect the QuickBooks credential.')
  }

  const realmId = normalizeQuickBooksRealmId(value.slice(0, separatorIndex))
  const subjectWithUuid = value.slice(separatorIndex + 1)
  const uuidMatch = subjectWithUuid.match(UUID_SUFFIX_PATTERN)
  if (!uuidMatch) {
    throw new Error('QuickBooks company identity is invalid. Reconnect the QuickBooks credential.')
  }

  const subject = normalizeSubject(subjectWithUuid.slice(0, -uuidMatch[0].length))
  return { realmId, subject }
}

/** Revokes an Intuit OAuth grant using the latest available refresh or access token. */
export async function revokeQuickBooksToken(token: string): Promise<void> {
  const normalizedToken = token.trim()
  if (!normalizedToken) {
    throw new Error('QuickBooks token revocation requires a token')
  }

  const clientId = env.QUICKBOOKS_CLIENT_ID?.trim()
  const clientSecret = env.QUICKBOOKS_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    throw new Error('QuickBooks OAuth client credentials are not configured')
  }

  let response: Response
  try {
    response = await fetch(QUICKBOOKS_REVOCATION_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: normalizedToken }),
      signal: AbortSignal.timeout(QUICKBOOKS_OAUTH_REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new Error('QuickBooks token revocation request failed')
  }

  if (!response.ok) {
    await readResponseTextWithLimit(response, {
      maxBytes: QUICKBOOKS_MAX_REVOCATION_ERROR_BYTES,
      label: 'QuickBooks token revocation error response',
    }).catch(() => {})
    throw new Error(`QuickBooks token revocation failed with HTTP ${response.status}`)
  }
}

export async function fetchQuickBooksConnectionProfile(
  accessToken: string,
  callbackRealmId: string
): Promise<QuickBooksConnectionProfile> {
  const realmId = normalizeQuickBooksRealmId(callbackRealmId)
  const response = await fetch(getQuickBooksUserInfoUrl(), {
    headers: { Authorization: `Bearer ${accessToken}` },
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
    realmId?: string
    realmid?: string
    name?: string
    givenName?: string
    familyName?: string
    given_name?: string
    family_name?: string
    email?: string
    emailVerified?: boolean
    email_verified?: boolean
  }>(response, {
    maxBytes: QUICKBOOKS_MAX_USER_INFO_BYTES,
    label: 'QuickBooks UserInfo response',
  })

  const subject = profile.sub?.trim()
  const claimedRealmId = (profile.realmId ?? profile.realmid)?.trim()
  const email = profile.email?.trim()
  const givenName = (profile.givenName ?? profile.given_name)?.trim()
  const familyName = (profile.familyName ?? profile.family_name)?.trim()
  const name = profile.name?.trim() || [givenName, familyName].filter(Boolean).join(' ')
  const emailVerified = profile.emailVerified ?? profile.email_verified ?? false

  if (!subject || !email || !name) {
    throw new Error('QuickBooks UserInfo did not return the required user identity')
  }
  if (claimedRealmId && normalizeQuickBooksRealmId(claimedRealmId) !== realmId) {
    throw new Error('QuickBooks callback and UserInfo returned different company identities')
  }

  await fetchValidatedQuickBooksCompanyInfo(accessToken, realmId)

  return {
    accountId: createQuickBooksAccountId(realmId, subject),
    realmId,
    subject: normalizeSubject(subject),
    name,
    email,
    emailVerified,
  }
}
