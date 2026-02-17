import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/auth/auth-client'
import { OAUTH_PROVIDERS, type OAuthServiceConfig } from '@/lib/oauth'

const logger = createLogger('OAuthConnectionsQuery')

/**
 * Query key factory for OAuth connection queries.
 * Provides hierarchical cache keys for connections and provider-specific accounts.
 */
export const oauthConnectionsKeys = {
  all: ['oauthConnections'] as const,
  connections: () => [...oauthConnectionsKeys.all, 'connections'] as const,
  accounts: (provider: string) => [...oauthConnectionsKeys.all, 'accounts', provider] as const,
}

/** OAuth service with connection status and linked accounts. */
export interface ServiceInfo extends OAuthServiceConfig {
  id: string
  isConnected: boolean
  lastConnected?: string
  accounts?: { id: string; name: string }[]
}

/** OAuth connection data returned from the API. */
interface OAuthConnectionResponse {
  provider: string
  baseProvider?: string
  accounts?: { id: string; name: string }[]
  lastConnected?: string
  scopes?: string[]
}

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

async function fetchOAuthConnections(): Promise<ServiceInfo[]> {
  try {
    const serviceDefinitions = defineServices()

    const response = await fetch('/api/auth/oauth/connections')

    if (response.status === 404) {
      return serviceDefinitions
    }

    if (!response.ok) {
      throw new Error('Failed to fetch OAuth connections')
    }

    const data = await response.json()
    const connections = data.connections || []

    const updatedServices = serviceDefinitions.map((service) => {
      const connection = connections.find(
        (conn: OAuthConnectionResponse) => conn.provider === service.providerId
      )

      if (connection) {
        return {
          ...service,
          isConnected: connection.accounts?.length > 0,
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
          isConnected: connectionWithScopes.accounts?.length > 0,
          accounts: connectionWithScopes.accounts || [],
          lastConnected: connectionWithScopes.lastConnected,
        }
      }

      return service
    })

    return updatedServices
  } catch (error) {
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
    queryFn: fetchOAuthConnections,
    staleTime: 30 * 1000,
    retry: false,
    placeholderData: keepPreviousData,
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

      if (providerId === 'shopify') {
        const returnUrl = encodeURIComponent(callbackURL)
        window.location.href = `/api/auth/shopify/authorize?returnUrl=${returnUrl}`
        return { success: true }
      }

      await client.oauth2.link({
        providerId,
        callbackURL,
      })

      return { success: true }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: oauthConnectionsKeys.connections() })
    },
    onError: (error) => {
      logger.error('OAuth connection error:', error)
    },
  })
}

interface DisconnectServiceParams {
  provider: string
  providerId: string
  serviceId: string
  accountId: string
}

/**
 * Disconnects an OAuth service account.
 * Performs optimistic update and rolls back on failure.
 */
export function useDisconnectOAuthService() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ provider, providerId }: DisconnectServiceParams) => {
      const response = await fetch('/api/auth/oauth/disconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider,
          providerId,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to disconnect service')
      }

      return response.json()
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
              const updatedAccounts = svc.accounts?.filter((acc) => acc.id !== accountId) || []
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
export interface ConnectedAccount {
  id: string
  accountId: string
  providerId: string
  displayName?: string
}

async function fetchConnectedAccounts(provider: string): Promise<ConnectedAccount[]> {
  const response = await fetch(`/api/auth/accounts?provider=${provider}`)

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `Failed to load ${provider} accounts`)
  }

  const data = await response.json()
  return data.accounts || []
}

/**
 * Fetches connected accounts for a specific OAuth provider.
 * @param provider - The provider ID (e.g., 'slack', 'google')
 * @param options - Query options including enabled flag
 */
export function useConnectedAccounts(provider: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: oauthConnectionsKeys.accounts(provider),
    queryFn: () => fetchConnectedAccounts(provider),
    enabled: options?.enabled ?? true,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}
