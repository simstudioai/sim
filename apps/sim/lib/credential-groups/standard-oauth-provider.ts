import { randomBytes } from 'node:crypto'
import { normalizeEmail } from '@sim/utils/string'
import {
  applyDefaultAccessTokenExpiry,
  createAuthorizationURL,
  type OAuth2Tokens,
  validateAuthorizationCode,
} from 'better-auth/oauth2'
import {
  type ConnectorProviderConfig,
  getManagedOAuthConnectorPolicy,
  getManagedOAuthConnectorProviderConfig,
  type ManagedOAuthConnectorConfig,
} from '@/lib/auth/connectors/managed-oauth'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { credentialGroupOAuthNonceMatches } from '@/lib/credential-groups/oauth-state'
import type {
  CredentialGroupProviderAdapter,
  CredentialGroupProviderPolicy,
} from '@/lib/credential-groups/provider-adapter'
import {
  CredentialGroupOAuthError,
  CredentialGroupProviderConfigurationError,
  credentialGroupScopePolicyVersion,
} from '@/lib/credential-groups/provider-adapter'
import type { CredentialGroupStandardOAuthProvider } from '@/lib/credential-groups/providers'
import { getCredentialGroupProviderService } from '@/lib/credential-groups/providers'
import { refreshOAuthToken } from '@/lib/oauth'

const OAUTH_DISCOVERY_TIMEOUT_MS = 10_000
const OAUTH_DISCOVERY_MAX_BYTES = 256 * 1024

interface OAuthEndpoints {
  authorizationEndpoint: string
  tokenEndpoint: string
}

/**
 * RFC 6749 §7.1 defines `token_type` as case-insensitive, and Better Auth passes the provider's
 * raw `token_type` through untouched. Several providers answer with lowercase `bearer`, so an
 * exact match would reject a perfectly valid grant as an incomplete authorization.
 */
function isBearerTokenType(tokenType: string | undefined): boolean {
  return tokenType?.toLowerCase() === 'bearer'
}

interface CurrentStandardOAuthProvider {
  connector: ConnectorProviderConfig
  policy: CredentialGroupProviderPolicy
}

function getRedirectUri(
  provider: CredentialGroupStandardOAuthProvider,
  current: CurrentStandardOAuthProvider
): string {
  if (!current.connector.redirectURI) {
    throw new CredentialGroupProviderConfigurationError(
      `${getCredentialGroupProviderService(provider).name} OAuth callback is not configured`
    )
  }
  return current.connector.redirectURI
}

function staticParams(
  value: ConnectorProviderConfig['authorizationUrlParams'],
  label: string
): Record<string, string> {
  if (typeof value === 'function') {
    throw new CredentialGroupProviderConfigurationError(
      `${label} cannot depend on an authenticated Sim request`
    )
  }
  return value ?? {}
}

async function resolveOAuthEndpoints(
  connector: ConnectorProviderConfig,
  providerName: string
): Promise<OAuthEndpoints> {
  if (connector.discoveryUrl) {
    let response: Response
    try {
      response = await fetch(connector.discoveryUrl, {
        headers: connector.discoveryHeaders,
        signal: AbortSignal.timeout(OAUTH_DISCOVERY_TIMEOUT_MS),
      })
    } catch {
      throw new CredentialGroupOAuthError(
        `${providerName} authorization is temporarily unavailable.`,
        503
      )
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw new CredentialGroupOAuthError(
        `${providerName} authorization is temporarily unavailable.`,
        503
      )
    }
    let document: unknown
    try {
      document = await readResponseJsonWithLimit(response, {
        maxBytes: OAUTH_DISCOVERY_MAX_BYTES,
        label: `${providerName} OAuth discovery response`,
      })
    } catch {
      throw new CredentialGroupOAuthError(
        `${providerName} authorization is temporarily unavailable.`,
        503
      )
    }
    if (!document || typeof document !== 'object') {
      throw new CredentialGroupOAuthError(`${providerName} OAuth configuration is invalid.`, 503)
    }
    const discovery = document as Record<string, unknown>
    if (
      typeof discovery.authorization_endpoint !== 'string' ||
      typeof discovery.token_endpoint !== 'string'
    ) {
      throw new CredentialGroupOAuthError(`${providerName} OAuth configuration is invalid.`, 503)
    }
    return {
      authorizationEndpoint: discovery.authorization_endpoint,
      tokenEndpoint: discovery.token_endpoint,
    }
  }

  if (!connector.authorizationUrl || !connector.tokenUrl) {
    throw new CredentialGroupProviderConfigurationError(
      `${providerName} OAuth endpoints are not configured`
    )
  }
  return {
    authorizationEndpoint: connector.authorizationUrl,
    tokenEndpoint: connector.tokenUrl,
  }
}

/**
 * The provider's scope policy on its own. Comparing scopes needs no OAuth
 * client, so a saved option can be validated against a connector wherever the
 * client is not configured, which `getCurrentProvider` would refuse.
 */
function getScopePolicy(
  provider: CredentialGroupStandardOAuthProvider
): ManagedOAuthConnectorConfig {
  const service = getCredentialGroupProviderService(provider)
  const policy = getManagedOAuthConnectorPolicy(service.providerId)
  if (!policy) {
    throw new CredentialGroupProviderConfigurationError(
      `Managed ${service.name} authorization is not configured`
    )
  }
  return policy
}

function getCurrentProvider(
  provider: CredentialGroupStandardOAuthProvider
): CurrentStandardOAuthProvider {
  const service = getCredentialGroupProviderService(provider)
  const connector = getManagedOAuthConnectorProviderConfig(service.providerId)
  if (!connector) {
    throw new CredentialGroupProviderConfigurationError(
      `Managed ${service.name} authorization is not configured`
    )
  }
  const requiredScopes = [
    ...new Set([...(connector.scopes ?? []), ...connector.managedOAuth.additionalScopes]),
  ]
  if (requiredScopes.length === 0 && !connector.managedOAuth.scopeless) {
    throw new CredentialGroupProviderConfigurationError(
      `Managed ${service.name} authorization has no scope policy`
    )
  }
  return {
    connector,
    policy: {
      provider,
      providerId: service.providerId,
      authorizationAppId: connector.managedOAuth.getAuthorizationAppId(connector.clientId),
      requiredScopes,
      scopeVersion: credentialGroupScopePolicyVersion(requiredScopes),
    },
  }
}

function assertCurrentPolicy(
  expected: CredentialGroupProviderPolicy,
  current: CredentialGroupProviderPolicy
): void {
  if (
    expected.provider !== current.provider ||
    expected.providerId !== current.providerId ||
    expected.authorizationAppId !== current.authorizationAppId ||
    expected.scopeVersion !== current.scopeVersion
  ) {
    throw new CredentialGroupOAuthError(
      'This credential option changed. Reload the invitation and try again.',
      409
    )
  }
}

function generatePkceVerifier(): string {
  return randomBytes(64).toString('base64url')
}

async function exchangeAuthorizationCode(params: {
  connector: ConnectorProviderConfig
  code: string
  codeVerifier?: string
  redirectUri: string
  tokenEndpoint: string
}): Promise<OAuth2Tokens> {
  const { connector, code, codeVerifier, redirectUri, tokenEndpoint } = params
  const tokens = connector.getToken
    ? await connector.getToken({ code, redirectURI: redirectUri, codeVerifier })
    : await validateAuthorizationCode({
        headers: connector.authorizationHeaders,
        code,
        codeVerifier,
        redirectURI: redirectUri,
        options: {
          clientId: connector.clientId,
          clientSecret: connector.clientSecret,
          redirectURI: redirectUri,
        },
        tokenEndpoint,
        authentication: connector.authentication,
        additionalParams: staticParams(connector.tokenUrlParams, 'OAuth token parameters'),
      })
  return applyDefaultAccessTokenExpiry(tokens, connector.accessTokenExpiresIn)
}

/**
 * Reuses the native connector's OAuth client, endpoints, scopes, and exchange hooks while
 * persisting the result through public enrollment instead of a signed-in Sim account.
 */
export function createStandardOAuthCredentialGroupProviderAdapter(
  provider: CredentialGroupStandardOAuthProvider
): CredentialGroupProviderAdapter {
  return {
    provider,
    get requiresRefreshToken() {
      return getCurrentProvider(provider).connector.managedOAuth.requiresRefreshToken
    },
    async getPolicy() {
      return getCurrentProvider(provider).policy
    },
    async prepareAuthorization(context, policy) {
      const current = getCurrentProvider(provider)
      assertCurrentPolicy(policy, current.policy)
      const managed = current.connector.managedOAuth
      const endpoints = await resolveOAuthEndpoints(
        current.connector,
        getCredentialGroupProviderService(provider).name
      )
      const redirectUri = getRedirectUri(provider, current)
      const codeVerifier = managed.pkce ? generatePkceVerifier() : undefined
      return {
        redirectUri,
        ...(codeVerifier ? { codeVerifier } : {}),
        buildAuthorizationUrl: async ({ state, nonce }) => {
          const authorizationUrl = await createAuthorizationURL({
            id: current.connector.providerId,
            options: {
              clientId: current.connector.clientId,
              clientSecret: current.connector.clientSecret,
              redirectURI: redirectUri,
            },
            authorizationEndpoint: endpoints.authorizationEndpoint,
            state,
            ...(codeVerifier ? { codeVerifier } : {}),
            scopes: policy.requiredScopes,
            redirectURI: redirectUri,
            prompt: managed.prompt ?? current.connector.prompt,
            accessType: current.connector.accessType,
            responseType: current.connector.responseType,
            responseMode: current.connector.responseMode,
            loginHint: managed.includeLoginHint ? context.email : undefined,
            additionalParams: {
              ...staticParams(
                current.connector.authorizationUrlParams,
                'OAuth authorization parameters'
              ),
              ...managed.authorizationUrlParams,
              ...(managed.nonceVerification === 'id_token' ? { nonce } : {}),
            },
          })
          return authorizationUrl.toString()
        },
      }
    },
    async exchangeAndVerify({ context, attempt, code, policy }) {
      const current = getCurrentProvider(provider)
      assertCurrentPolicy(policy, current.policy)
      const redirectUri = getRedirectUri(provider, current)
      if (attempt.redirectUri !== redirectUri) {
        throw new CredentialGroupOAuthError('Authorization state is invalid or expired.', 400)
      }
      const managed = current.connector.managedOAuth
      if (managed.pkce && !attempt.codeVerifier) {
        throw new CredentialGroupOAuthError('Authorization state is invalid or expired.', 400)
      }
      const service = getCredentialGroupProviderService(provider)
      const endpoints = await resolveOAuthEndpoints(current.connector, service.name)
      let tokens: OAuth2Tokens
      try {
        tokens = await exchangeAuthorizationCode({
          connector: current.connector,
          code,
          ...(attempt.codeVerifier ? { codeVerifier: attempt.codeVerifier } : {}),
          redirectUri: attempt.redirectUri,
          tokenEndpoint: endpoints.tokenEndpoint,
        })
      } catch {
        throw new CredentialGroupOAuthError(
          `${service.name} could not complete authorization. Please try again.`,
          502
        )
      }
      if (!isBearerTokenType(tokens.tokenType) || !tokens.accessToken) {
        throw new CredentialGroupOAuthError(
          `${service.name} returned an incomplete authorization.`,
          502
        )
      }
      let identity: Awaited<ReturnType<typeof managed.verifyIdentity>>
      try {
        identity = await managed.verifyIdentity({
          tokens,
          clientId: current.connector.clientId,
          expectedEmail: context.email,
        })
      } catch {
        throw new CredentialGroupOAuthError(
          `${service.name} returned an invalid identity token.`,
          502
        )
      }
      const nonceMatches =
        managed.nonceVerification === 'state_only' ||
        (identity.nonce && credentialGroupOAuthNonceMatches(identity.nonce, attempt.nonceHash))
      if (!identity.emailVerified || !nonceMatches) {
        throw new CredentialGroupOAuthError(
          `${service.name} returned an invalid identity token.`,
          502
        )
      }
      const email = normalizeEmail(identity.email)
      if (email !== context.email) {
        throw new CredentialGroupOAuthError(
          `Sign in with ${context.email} to complete this invitation.`,
          403
        )
      }
      if (!managed.hasRequiredScopes(identity.grantedScopes, policy.requiredScopes)) {
        throw new CredentialGroupOAuthError(
          `All requested ${service.name} permissions are required to connect this account.`,
          403
        )
      }
      return {
        providerId: policy.providerId,
        providerSubjectId: identity.providerSubjectId,
        providerTenantId: identity.providerTenantId,
        displayName: email,
        metadata: {
          email,
          ...(identity.displayName ? { displayName: identity.displayName } : {}),
          ...(identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
        },
        accessToken: tokens.accessToken,
        ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
        grantedScopes: identity.grantedScopes,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? null,
      }
    },
    hasRequiredScopes(grantedScopes, requiredScopes) {
      return getScopePolicy(provider).hasRequiredScopes(grantedScopes, requiredScopes)
    },
    async refreshToken(refreshToken) {
      return refreshOAuthToken(getCurrentProvider(provider).policy.providerId, refreshToken)
    },
    isTerminalRefreshError(errorCode) {
      return getCurrentProvider(provider).connector.managedOAuth.isTerminalRefreshError(errorCode)
    },
  }
}
