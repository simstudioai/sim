import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ConnectedAccount,
  disconnectOAuthContract,
  listConnectedAccountsContract,
  listOAuthConnectionsContract,
  type OAuthAccountSummary,
  type OAuthConnection,
} from '@/lib/api/contracts/oauth-connections'
import { client } from '@/lib/auth/auth-client'
import { getDesktopBridge } from '@/lib/desktop'
import { OAUTH_PROVIDERS, type OAuthServiceConfig } from '@/lib/oauth'

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
}

/**
 * Initiates OAuth connection flow for a service.
 * Redirects the user to the provider's authorization page.
 */
export function useConnectOAuthService() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ providerId, callbackURL }: ConnectServiceParams) => {
      if (providerId === 'trello') {
        window.location.href = '/api/auth/trello/authorize'
        return { success: true }
      }

      if (providerId === 'instagram') {
        const returnUrl = encodeURIComponent(callbackURL)
        window.location.href = `/api/auth/instagram/authorize?returnUrl=${returnUrl}`
        return { success: true }
      }

      if (providerId === 'shopify') {
        const returnUrl = encodeURIComponent(callbackURL)
        window.location.href = `/api/auth/shopify/authorize?returnUrl=${returnUrl}`
        return { success: true }
      }

      // Desktop app: OAuth cannot run in the embedded window (Google/Microsoft
      // block embedded user agents, and better-auth binds the flow's state to
      // the initiating browser's cookies), so the whole flow is handed to the
      // system browser and returns via the app's loopback. Completion arrives
      // through onOAuthConnectComplete (see useDesktopOAuthConnectListener),
      // which refreshes caches and shows the connected toast.
      const desktopBridge = getDesktopBridge()
      if (desktopBridge?.beginOAuthConnect) {
        const opened = await desktopBridge.beginOAuthConnect(providerId)
        if (!opened) {
          throw new Error('Could not open your browser to connect this account.')
        }
        return { success: true }
      }

      await client.oauth2.link({
        providerId,
        callbackURL,
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

interface DisconnectServiceParams {
  provider: string
  providerId?: string
  serviceId: string
  accountId?: string
}

/**
 * Disconnects an OAuth service account.
 * Performs optimistic update and rolls back on failure.
 */
export function useDisconnectOAuthService() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ provider, providerId, accountId }: DisconnectServiceParams) => {
      return requestJson(disconnectOAuthContract, {
        body: {
          provider,
          providerId,
          accountId,
        },
      })
    },
    onMutate: async ({ serviceId, accountId }) => {
      await queryClient.cancelQueries({ queryKey: oauthConnectionsKeys.connections() })

      const previousServices = queryClient.getQueryData<ServiceInfo[]>(
        oauthConnectionsKeys.connections()
      )

      if (previousServices) {
        queryClient.setQueryData<ServiceInfo[]>(
          oauthConnectionsKeys.connections(),
          previousServices.map((svc) => {
            if (svc.id === serviceId) {
              const updatedAccounts =
                accountId && svc.accounts ? svc.accounts.filter((acc) => acc.id !== accountId) : []
              return {
                ...svc,
                accounts: updatedAccounts,
                isConnected: updatedAccounts.length > 0,
              }
            }
            return svc
          })
        )
      }

      return { previousServices }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousServices) {
        queryClient.setQueryData(oauthConnectionsKeys.connections(), context.previousServices)
      }
      logger.error('Failed to disconnect service')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: oauthConnectionsKeys.connections() })
    },
  })
}

/** Connected OAuth account for a specific provider. */
export type { ConnectedAccount }

async function fetchConnectedAccounts(
  provider: string,
  signal?: AbortSignal
): Promise<ConnectedAccount[]> {
  const data = await requestJson(listConnectedAccountsContract, {
    query: { provider },
    signal,
  })
  return data.accounts
}

/**
 * Fetches connected accounts for a specific OAuth provider.
 * @param provider - The provider ID (e.g., 'slack', 'google')
 * @param options - Query options including enabled flag
 */
export function useConnectedAccounts(provider: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: oauthConnectionsKeys.account(provider),
    queryFn: ({ signal }) => fetchConnectedAccounts(provider, signal),
    enabled: options?.enabled ?? true,
    staleTime: OAUTH_CONNECTED_ACCOUNTS_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}
