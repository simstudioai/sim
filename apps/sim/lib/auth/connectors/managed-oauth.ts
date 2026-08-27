import { createHash } from 'node:crypto'
import type { OAuth2Tokens } from '@better-auth/core/oauth2'
import type { GenericOAuthConfig } from 'better-auth/plugins'
import { OAuth2Client, type TokenPayload } from 'google-auth-library'
import { buildConnectorProviders } from '@/lib/auth/connectors/providers'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'

const GOOGLE_OPENID_SCOPE = 'openid'
const GOOGLE_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email'
const GOOGLE_PROFILE_SCOPE = 'https://www.googleapis.com/auth/userinfo.profile'
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
const GMAIL_LABELS_SCOPE = 'https://www.googleapis.com/auth/gmail.labels'
const ATLASSIAN_USER_INFO_URL = 'https://api.atlassian.com/me'
const ATLASSIAN_USER_INFO_MAX_BYTES = 256 * 1024
const ATLASSIAN_USER_INFO_TIMEOUT_MS = 10_000

type AtlassianManagedOAuthProviderId = 'confluence' | 'jira'

export interface ManagedOAuthConnectorIdentity {
  providerSubjectId: string
  providerTenantId: string | null
  email: string
  emailVerified: boolean
  displayName?: string
  avatarUrl?: string
  nonce?: string
  grantedScopes: string[]
}

export interface ManagedOAuthConnectorConfig {
  additionalScopes: string[]
  requiresRefreshToken: boolean
  pkce: boolean
  nonceVerification: 'id_token' | 'state_only'
  includeLoginHint: boolean
  prompt?: string
  authorizationUrlParams?: Record<string, string>
  getAuthorizationAppId(clientId: string): string
  verifyIdentity(params: {
    tokens: OAuth2Tokens
    clientId: string
  }): Promise<ManagedOAuthConnectorIdentity>
  hasRequiredScopes(grantedScopes: string[], requiredScopes: string[]): boolean
  isTerminalRefreshError(errorCode: string | undefined): boolean
}

export interface ConnectorProviderConfig extends GenericOAuthConfig {
  managedOAuth: ManagedOAuthConnectorConfig
}

function canonicalGoogleScope(scope: string): string {
  if (scope === 'email') return GOOGLE_EMAIL_SCOPE
  if (scope === 'profile') return GOOGLE_PROFILE_SCOPE
  return scope
}

function hasRequiredGoogleScopes(
  providerId: string,
  grantedScopes: string[],
  requiredScopes: string[]
): boolean {
  const granted = new Set(grantedScopes.map(canonicalGoogleScope))
  return requiredScopes.every((requestedScope) => {
    const required = canonicalGoogleScope(requestedScope)
    if (granted.has(required)) return true
    return (
      providerId === 'google-email' &&
      granted.has(GMAIL_MODIFY_SCOPE) &&
      (required === GMAIL_READONLY_SCOPE ||
        required === GMAIL_SEND_SCOPE ||
        required === GMAIL_LABELS_SCOPE)
    )
  })
}

function requireVerifiedGooglePayload(payload: TokenPayload | undefined): TokenPayload & {
  sub: string
  email: string
} {
  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw new Error('Google returned an invalid identity token')
  }
  return payload as TokenPayload & { sub: string; email: string }
}

export function createGoogleManagedOAuthConnector(providerId: string): ManagedOAuthConnectorConfig {
  return {
    additionalScopes: [GOOGLE_OPENID_SCOPE],
    requiresRefreshToken: true,
    pkce: true,
    nonceVerification: 'id_token',
    includeLoginHint: true,
    prompt: 'consent select_account',
    authorizationUrlParams: { include_granted_scopes: 'false' },
    getAuthorizationAppId(clientId) {
      return `google:${createHash('sha256').update(clientId).digest('hex')}`
    },
    async verifyIdentity({ tokens, clientId }) {
      if (!tokens.idToken || !tokens.accessToken) {
        throw new Error('Google returned an incomplete authorization')
      }
      const client = new OAuth2Client({ clientId })
      const ticket = await client.verifyIdToken({ idToken: tokens.idToken, audience: clientId })
      const payload = requireVerifiedGooglePayload(ticket.getPayload())
      const tokenInfo = await client.getTokenInfo(tokens.accessToken)
      if (tokenInfo.aud !== clientId || tokenInfo.sub !== payload.sub) {
        throw new Error('Google returned an access token for another identity')
      }
      return {
        providerSubjectId: payload.sub,
        providerTenantId: payload.hd ?? null,
        email: payload.email,
        emailVerified: true,
        ...(payload.name ? { displayName: payload.name } : {}),
        ...(payload.picture ? { avatarUrl: payload.picture } : {}),
        ...(payload.nonce ? { nonce: payload.nonce } : {}),
        grantedScopes: [...new Set(tokenInfo.scopes)],
      }
    },
    hasRequiredScopes(grantedScopes, requiredScopes) {
      return hasRequiredGoogleScopes(providerId, grantedScopes, requiredScopes)
    },
    isTerminalRefreshError(errorCode) {
      return errorCode === 'invalid_grant'
    },
  }
}

interface AtlassianUserProfile {
  account_type?: unknown
  account_id?: unknown
  email?: unknown
  name?: unknown
  picture?: unknown
  account_status?: unknown
}

function requireAtlassianUserProfile(value: AtlassianUserProfile): {
  accountId: string
  email: string
  name?: string
  picture?: string
} {
  if (
    value.account_type !== 'atlassian' ||
    typeof value.account_id !== 'string' ||
    !value.account_id.trim() ||
    typeof value.email !== 'string' ||
    !value.email.trim() ||
    value.account_status !== 'active'
  ) {
    throw new Error('Atlassian returned an invalid user identity')
  }
  return {
    accountId: value.account_id,
    email: value.email,
    ...(typeof value.name === 'string' && value.name ? { name: value.name } : {}),
    ...(typeof value.picture === 'string' && value.picture ? { picture: value.picture } : {}),
  }
}

/** Managed enrollment policy for Atlassian's Jira and Confluence 3LO clients. */
export function createAtlassianManagedOAuthConnector(
  providerId: AtlassianManagedOAuthProviderId
): ManagedOAuthConnectorConfig {
  return {
    additionalScopes: [],
    requiresRefreshToken: true,
    pkce: false,
    nonceVerification: 'state_only',
    includeLoginHint: false,
    prompt: 'consent',
    authorizationUrlParams: { audience: 'api.atlassian.com' },
    getAuthorizationAppId(clientId) {
      return `${providerId}:${createHash('sha256').update(clientId).digest('hex')}`
    },
    async verifyIdentity({ tokens }) {
      if (!tokens.accessToken || !tokens.scopes?.length) {
        throw new Error('Atlassian returned an incomplete authorization')
      }
      const response = await fetch(ATLASSIAN_USER_INFO_URL, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        signal: AbortSignal.timeout(ATLASSIAN_USER_INFO_TIMEOUT_MS),
      })
      const profile = await readResponseJsonWithLimit<AtlassianUserProfile>(response, {
        maxBytes: ATLASSIAN_USER_INFO_MAX_BYTES,
        label: 'Atlassian user identity response',
      })
      if (!response.ok) {
        throw new Error(`Atlassian user identity request failed with HTTP ${response.status}`)
      }
      const identity = requireAtlassianUserProfile(profile)
      return {
        providerSubjectId: identity.accountId,
        providerTenantId: null,
        email: identity.email,
        emailVerified: true,
        ...(identity.name ? { displayName: identity.name } : {}),
        ...(identity.picture ? { avatarUrl: identity.picture } : {}),
        grantedScopes: [...new Set(tokens.scopes)],
      }
    },
    hasRequiredScopes(grantedScopes, requiredScopes) {
      const granted = new Set(grantedScopes)
      return requiredScopes.every((scope) => granted.has(scope))
    },
    isTerminalRefreshError(errorCode) {
      return errorCode === 'invalid_grant'
    },
  }
}

export function getManagedOAuthConnectorProviderConfig(
  providerId: string
): ConnectorProviderConfig | undefined {
  const isGoogle = providerId === 'google-email' || providerId === 'google-calendar'
  const isAtlassian = providerId === 'confluence' || providerId === 'jira'
  if (!isGoogle && !isAtlassian) return undefined
  const connector = buildConnectorProviders().find(
    (candidate) => candidate.providerId === providerId
  )
  if (!connector) return undefined
  return {
    ...connector,
    managedOAuth: isGoogle
      ? createGoogleManagedOAuthConnector(providerId)
      : createAtlassianManagedOAuthConnector(providerId),
  }
}
