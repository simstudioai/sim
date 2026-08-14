import { createHash } from 'node:crypto'
import type { OAuth2Tokens } from '@better-auth/core/oauth2'
import type { GenericOAuthConfig } from 'better-auth/plugins'
import { OAuth2Client, type TokenPayload } from 'google-auth-library'
import { buildConnectorProviders } from '@/lib/auth/connectors/providers'

const GOOGLE_OPENID_SCOPE = 'openid'
const GOOGLE_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email'
const GOOGLE_PROFILE_SCOPE = 'https://www.googleapis.com/auth/userinfo.profile'
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
const GMAIL_LABELS_SCOPE = 'https://www.googleapis.com/auth/gmail.labels'

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

export function getManagedOAuthConnectorProviderConfig(
  providerId: string
): ConnectorProviderConfig | undefined {
  if (providerId !== 'google-email' && providerId !== 'google-calendar') return undefined
  const connector = buildConnectorProviders().find(
    (candidate) => candidate.providerId === providerId
  )
  if (!connector) return undefined
  return {
    ...connector,
    managedOAuth: createGoogleManagedOAuthConnector(providerId),
  }
}
