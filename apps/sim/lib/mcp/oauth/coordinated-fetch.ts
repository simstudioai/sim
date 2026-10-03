import {
  extractWWWAuthenticateParams,
  type OAuthClientProvider,
  UnauthorizedError,
} from '@modelcontextprotocol/sdk/client/auth.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { mcpAuthGuarded } from '@/lib/mcp/oauth/auth'
import { withMcpOauthRefreshLock } from '@/lib/mcp/oauth/storage'

export interface McpOauthCredentials {
  /** Shared server ID for workspace OAuth, personal credential ID for managed OAuth. */
  credentialId: string
  /** Reloads the persisted grant; called again under the refresh lock after a challenge. */
  loadProvider: () => Promise<OAuthClientProvider>
}

export interface McpOauthSession extends McpOauthCredentials {
  /** Loaded before connecting so credential errors retain their application-level meaning. */
  initialProvider: OAuthClientProvider
}

/** Applies configured headers only to the MCP endpoint, never to OAuth discovery or token URLs. */
export function createMcpEndpointFetch(
  fetchFn: FetchLike,
  options: { serverUrl: string; headers?: HeadersInit }
): FetchLike {
  if (!options.headers) return fetchFn
  const serverUrl = new URL(options.serverUrl)
  const configuredHeaders = new Headers(options.headers)

  return (input, init) => {
    if (new URL(input).href !== serverUrl.href) return fetchFn(input, init)
    const headers = new Headers(init?.headers)
    configuredHeaders.forEach((value, key) => headers.set(key, value))
    return fetchFn(input, { ...init, headers })
  }
}

/**
 * Coordinates the SDK's public OAuth flow across clients without locking MCP requests.
 * The transport must omit authProvider so it cannot refresh outside this boundary.
 * Only explicit authentication rejections are replayed. Allow a concurrent token
 * update, authentication, and a scope upgrade, with at most three replays total.
 */
export function createCoordinatedMcpOauthFetch(
  { credentialId, loadProvider, initialProvider }: McpOauthSession,
  options: { serverUrl: string; fetch: FetchLike }
): FetchLike {
  const serverUrl = new URL(options.serverUrl)
  let currentProvider = initialProvider

  return async (input, init) => {
    if (new URL(input).href !== serverUrl.href) {
      return options.fetch(input, init)
    }

    init?.signal?.throwIfAborted()
    let provider = currentProvider
    const authenticatedChallenges = new Set<string>()

    for (let attempt = 0; ; attempt++) {
      init?.signal?.throwIfAborted()
      const tokens = await provider.tokens()
      const headers = new Headers(init?.headers)
      if (tokens && !headers.has('authorization')) {
        headers.set('authorization', `Bearer ${tokens.access_token}`)
      }
      const response = await options.fetch(input, { ...init, headers })
      if ((response.status !== 401 && response.status !== 403) || attempt === 3) {
        return response
      }
      const challenge = extractWWWAuthenticateParams(response)
      const needsAuth =
        response.status === 401 ||
        (response.status === 403 && challenge.error === 'insufficient_scope')
      if (!needsAuth) return response
      const challengeKey =
        response.status === 401 ? '401' : `403:${response.headers.get('www-authenticate')}`
      if (authenticatedChallenges.has(challengeKey)) return response

      await response.body?.cancel()
      await withMcpOauthRefreshLock(
        credentialId,
        async () => {
          init?.signal?.throwIfAborted()
          const current = await loadProvider()
          const latestTokens = await current.tokens()
          const refreshedElsewhere =
            latestTokens && latestTokens.access_token !== tokens?.access_token

          init?.signal?.throwIfAborted()
          if (!refreshedElsewhere) {
            const result = await mcpAuthGuarded(current, {
              serverUrl,
              resourceMetadataUrl: challenge.resourceMetadataUrl,
              scope: challenge.scope,
              fetchFn: options.fetch,
            })
            if (result !== 'AUTHORIZED') throw new UnauthorizedError()
            authenticatedChallenges.add(challengeKey)
          }
          provider = current
          currentProvider = current
        },
        init?.signal ?? undefined
      )
    }
  }
}
