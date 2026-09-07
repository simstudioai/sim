import { createLogger } from '@sim/logger'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ConnectedAccount,
  listOAuthConnectionsContract,
  type OAuthAccountSummary,
  type OAuthConnection,
} from '@/lib/api/contracts/oauth-connections'
import { client } from '@/lib/auth/auth-client'
import { OAUTH_CREDENTIAL_DRAFT_CALLBACK_PARAM } from '@/lib/credentials/draft-constants'
import { getDesktopBridge } from '@/lib/desktop'
import { OAUTH_PROVIDERS, type OAuthServiceConfig } from '@/lib/oauth'
import { getPerRequestOAuthLinkScopes } from '@/lib/oauth/utils'

const logger = createLogger('OAuthConnectionsQuery')

export const OAUTH_CONNECTIONS_STALE_TIME = 30 * 1000
export const OAUTH_CONNECTED_ACCOUNTS_STALE_TIME = 60 * 1000

/**
 * Query key factory for OAuth connection queries.
 * Provides hierarchical cache keys for connections and provider-specific accounts.
 */
export const oauthConnectionsKeys = {
  all: ['oauthConnections'] as const,
  connections: () => [...oauthConnectionsKeys.all, 'connections'] as const,
  accounts: () => [...oauthConnectionsKeys.all, 'accounts'] as const,
  account: (provider: string) => [...oauthConnectionsKeys.accounts(), provider] as const,
}

/** OAuth service with connection status and linked accounts. */
export interface ServiceInfo extends OAuthServiceConfig {
  id: string
  isConnected: boolean
  lastConnected?: string
  accounts?: OAuthAccountSummary[]
}

type OAuthConnectionResponse = OAuthConnection

function defineServices(): ServiceInfo[] {
  const servicesList: ServiceInfo[] = []

  Object.entries(OAUTH_PROVIDERS).forEach(([_providerKey, provider]) => {
    Object.entries(provider.services).forEach(([serviceKey, service]) => {
      servicesList.push({
        ...service,
        id: serviceKey,
        isConnected: false,
        scopes: service.scopes || [],
      })
    })
  })

  return servicesList
}

/**
 * Resolves the service catalog merged with the caller's connections.
 *
 * A failed request resolves with the bare catalog rather than rejecting, so
 * consumers keep correct service names and ids when the merge data is
 * unavailable. The cost is that `isConnected`/`accounts` then report *unknown*
 * as *disconnected*, which the result cannot distinguish. Read connection
 * state from the workspace credentials query (`useWorkspaceCredentials`), which
 * surfaces its own errors; a consumer that must branch on `isConnected` here
 * needs this fallback removed first, or it will tell a connected user they are
 * not.
 */
async function fetchOAuthConnections(signal?: AbortSignal): Promise<ServiceInfo[]> {
  try {
    const serviceDefinitions = defineServices()

    const data = await requestJson(listOAuthConnectionsContract, { signal })
    const connections = data.connections || []

    const updatedServices = serviceDefinitions.map((service) => {
      const connection = connections.find(
        (conn: OAuthConnectionResponse) => conn.provider === service.providerId
      )

      if (connection) {
        return {
          ...service,
          isConnected: (connection.accounts?.length ?? 0) > 0,
          accounts: connection.accounts || [],
          lastConnected: connection.lastConnected,
        }
      }

      const connectionWithScopes = connections.find((conn: OAuthConnectionResponse) => {
        if (!conn.baseProvider || !service.providerId.startsWith(conn.baseProvider)) {
          return false
        }

        if (conn.scopes && service.scopes) {
          const connScopes = conn.scopes
          return service.scopes.every((scope) => connScopes.includes(scope))
        }

        return false
      })

      if (connectionWithScopes) {
        return {
          ...service,
          isConnected: (connectionWithScopes.accounts?.length ?? 0) > 0,
          accounts: connectionWithScopes.accounts || [],
          lastConnected: connectionWithScopes.lastConnected,
        }
      }

      return service
    })

    return updatedServices
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return defineServices()
    }
    logger.error('Error fetching OAuth connections:', error)
    return defineServices()
  }
}

/**
 * Fetches all OAuth service connections with their status.
 * Returns service definitions merged with connection data.
 */
export function useOAuthConnections() {
  return useQuery({
    queryKey: oauthConnectionsKeys.connections(),
    queryFn: ({ signal }) => fetchOAuthConnections(signal),
    staleTime: OAUTH_CONNECTIONS_STALE_TIME,
    retry: false,
  })
}

interface ConnectServiceParams {
  providerId: string
  callbackURL: string
  draftId?: string
}

/**
 * Initiates OAuth connection flow for a service.
 * Redirects the user to the provider's authorization page.
 */
export function useConnectOAuthService() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ providerId, callbackURL, draftId }: ConnectServiceParams) => {
      /**
       * Desktop keeps the entire provider flow in the system browser so the
       * authorization route's state cookies and callback use one cookie jar.
       */
      const desktopBridge = getDesktopBridge()
      if (desktopBridge?.beginOAuthConnect) {
        const opened = await desktopBridge.beginOAuthConnect(
          providerId,
          draftId ? { draftId } : undefined
        )
        if (!opened) {
          throw new Error('Could not open your browser to connect this account.')
        }
        return { success: true }
      }

      if (providerId === 'trello') {
        const returnUrl = encodeURIComponent(callbackURL)
        const draftQuery = draftId ? `&draftId=${encodeURIComponent(draftId)}` : ''
        window.location.href = `/api/auth/trello/authorize?returnUrl=${returnUrl}${draftQuery}`
        return { success: true }
      }

      if (providerId === 'instagram') {
        const returnUrl = encodeURIComponent(callbackURL)
        const draftQuery = draftId ? `&draftId=${encodeURIComponent(draftId)}` : ''
        window.location.href = `/api/auth/instagram/authorize?returnUrl=${returnUrl}${draftQuery}`
        return { success: true }
      }

      if (providerId === 'shopify') {
        const returnUrl = encodeURIComponent(callbackURL)
        const draftQuery = draftId ? `&draftId=${encodeURIComponent(draftId)}` : ''
        window.location.href = `/api/auth/shopify/authorize?returnUrl=${returnUrl}${draftQuery}`
        return { success: true }
      }

      if (providerId === 'quickbooks') {
        if (!draftId) {
          throw new Error('QuickBooks authorization requires a credential connection draft.')
        }
        const authorizeUrl = new URL('/api/auth/oauth2/authorize', window.location.origin)
        authorizeUrl.searchParams.set('draftId', draftId)
        authorizeUrl.searchParams.set('callbackURL', callbackURL)
        window.location.href = authorizeUrl.toString()
        return { success: true }
      }

      const stateCallbackUrl = new URL(callbackURL)
      if (draftId) {
        stateCallbackUrl.searchParams.set(OAUTH_CREDENTIAL_DRAFT_CALLBACK_PARAM, draftId)
      }

      const scopes = getPerRequestOAuthLinkScopes(providerId)
      await client.oauth2.link({
        providerId,
        callbackURL: stateCallbackUrl.toString(),
        ...(scopes && { scopes }),
      })

      return { success: true }
    },
    onError: (error) => {
      logger.error('OAuth connection error:', error)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: oauthConnectionsKeys.connections() })
    },
  })
}

/** Connected OAuth account for a specific provider. */
export type { ConnectedAccount }
