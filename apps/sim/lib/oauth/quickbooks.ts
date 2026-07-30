import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { normalizeQuickBooksAccessToken } from '@/lib/oauth/quickbooks-token'

const logger = createLogger('QuickBooksOAuth')

const QUICKBOOKS_USER_INFO_URLS = {
  production: 'https://accounts.platform.intuit.com/v1/openid_connect/userinfo',
  sandbox: 'https://sandbox-accounts.platform.intuit.com/v1/openid_connect/userinfo',
} as const

const MAX_USER_INFO_RESPONSE_BYTES = 1024 * 1024

export interface QuickBooksUserInfo {
  sub?: string
  given_name?: string
  givenName?: string
  family_name?: string
  familyName?: string
  email?: string
  email_verified?: boolean
  emailVerified?: boolean
}

export function getQuickBooksUserInfoEndpoints(preferSandbox: boolean): string[] {
  return preferSandbox
    ? [QUICKBOOKS_USER_INFO_URLS.sandbox, QUICKBOOKS_USER_INFO_URLS.production]
    : [QUICKBOOKS_USER_INFO_URLS.production, QUICKBOOKS_USER_INFO_URLS.sandbox]
}

export async function fetchQuickBooksUserInfo(
  accessToken: string | undefined,
  preferSandbox: boolean
): Promise<QuickBooksUserInfo> {
  if (!accessToken) {
    throw new Error('QuickBooks OAuth token response did not include an access token')
  }
  const normalizedAccessToken = normalizeQuickBooksAccessToken(accessToken)

  const failures: string[] = []

  for (const endpoint of getQuickBooksUserInfoEndpoints(preferSandbox)) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${normalizedAccessToken}`,
        },
      })

      if (!response.ok) {
        await readResponseTextWithLimit(response, {
          maxBytes: MAX_USER_INFO_RESPONSE_BYTES,
          label: 'QuickBooks user info error response',
        }).catch(() => {})
        failures.push(`${new URL(endpoint).hostname}: HTTP ${response.status}`)
        logger.warn('QuickBooks user info endpoint rejected the access token', {
          endpointHost: new URL(endpoint).hostname,
          status: response.status,
        })
        continue
      }

      const profile = await readResponseJsonWithLimit<QuickBooksUserInfo>(response, {
        maxBytes: MAX_USER_INFO_RESPONSE_BYTES,
        label: 'QuickBooks user info response',
      })

      if (!profile.sub) {
        failures.push(`${new URL(endpoint).hostname}: missing sub claim`)
        logger.warn('QuickBooks user info response did not include a subject', {
          endpointHost: new URL(endpoint).hostname,
        })
        continue
      }

      return profile
    } catch (error) {
      failures.push(`${new URL(endpoint).hostname}: ${getErrorMessage(error)}`)
      logger.warn('QuickBooks user info request failed', {
        endpointHost: new URL(endpoint).hostname,
        error: getErrorMessage(error),
      })
    }
  }

  throw new Error(`QuickBooks user info request failed (${failures.join('; ')})`)
}

export function mapQuickBooksUserInfo(profile: QuickBooksUserInfo) {
  if (!profile.sub) {
    throw new Error('QuickBooks user info response did not include a subject')
  }

  const givenName = profile.given_name ?? profile.givenName ?? ''
  const familyName = profile.family_name ?? profile.familyName ?? ''
  const name = `${givenName} ${familyName}`.trim() || profile.email || 'QuickBooks User'

  return {
    id: profile.sub,
    name,
    email: profile.email || `${profile.sub}@quickbooks.user`,
    emailVerified: profile.email_verified ?? profile.emailVerified ?? Boolean(profile.email),
    image: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}
