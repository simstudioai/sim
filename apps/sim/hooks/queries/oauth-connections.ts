import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { OAUTH_PROVIDERS, type OAuthServiceConfig } from '@/lib/oauth/oauth'

const logger = createLogger('OAuthConnectionsQuery')

/**
 * Query key factories for OAuth connections
 */
export const oauthConnectionsKeys = {
  all: ['oauthConnections'] as const,
  connections: () => [...oauthConnectionsKeys.all, 'connections'] as const,
}

/**
 * Service info type
 */
export interface ServiceInfo extends OAuthServiceConfig {
  isConnected: boolean
  lastConnected?: string
  accounts?: { id: string; name: string }[]
}

/**
 * Define available services from standardized OAuth providers
 */
function defineServices(): ServiceInfo[] {
  const servicesList: ServiceInfo[] = []

  Object.values(OAUTH_PROVIDERS).forEach((provider) => {
    Object.values(provider.services).forEach((service) => {
      servicesList.push({
        ...service,
        isConnected: false,
        scopes: service.scopes || [],
      })
    })
  })

  return servicesList
}

/**
 * Fetch OAuth connections and merge with service definitions
 */
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
      const connection = connections.find((conn: any) => conn.provider === service.providerId)

      if (connection) {
        return {
          ...service,
          isConnected: connection.accounts?.length > 0,
          accounts: connection.accounts || [],
          lastConnected: connection.lastConnected,
        }
      }

      const connectionWithScopes = connections.find((conn: any) => {
        if (!conn.baseProvider || !service.providerId.startsWith(conn.baseProvider)) {
          return false
        }

        if (conn.scopes && service.scopes) {
          return service.scopes.every((scope) => conn.scopes.includes(scope))
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
 * Hook to fetch OAuth connections
 */
export function useOAuthConnections() {
  return useQuery({
    queryKey: oauthConnectionsKeys.connections(),
    queryFn: fetchOAuthConnections,
    staleTime: 30 * 1000, // 30 seconds - connections don't change often
    retry: false, // Don't retry on 404
    placeholderData: keepPreviousData, // Show cached data immediately
  })
}

/**
 * Connect OAuth service mutation
 */
interface ConnectServiceParams {
  providerId: string
  callbackURL: string
}

export function useConnectOAuthService() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ providerId, callbackURL }: ConnectServiceParams) => {
      if (providerId === 'trello') {
        window.location.href = '/api/auth/trello/authorize'
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

/**
 * Disconnect OAuth service mutation
 */
interface DisconnectServiceParams {
  provider: string
  providerId: string
  serviceId: string
  accountId: string
}

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
