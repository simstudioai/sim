'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, ExternalLink, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { client, useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { OAUTH_PROVIDERS, OAuthServiceConfig } from '@/lib/oauth'
import { cn } from '@/lib/utils'
import { loadFromStorage, removeFromStorage, saveToStorage } from '@/stores/workflows/persistence'

const logger = createLogger('Credentials')

interface CredentialsProps {
  onOpenChange?: (open: boolean) => void
}

interface ServiceInfo extends OAuthServiceConfig {
  isConnected: boolean
  lastConnected?: string
  accounts?: { id: string; name: string }[]
}

export function Credentials({ onOpenChange }: CredentialsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const userId = session?.user?.id

  const [services, setServices] = useState<ServiceInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isConnecting, setIsConnecting] = useState<string | null>(null)
  const [pendingService, setPendingService] = useState<string | null>(null)
  const [pendingScopes, setPendingScopes] = useState<string[]>([])
  const [authSuccess, setAuthSuccess] = useState(false)

  // Define available services from our standardized OAuth providers
  const defineServices = (): ServiceInfo[] => {
    const servicesList: ServiceInfo[] = []

    // Convert our standardized providers to ServiceInfo objects
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

  // Fetch services and their connection status
  const fetchServices = async () => {
    if (!userId) return

    setIsLoading(true)
    try {
      // Start with the base service definitions
      const serviceDefinitions = defineServices()

      // Fetch all OAuth connections for the user
      const response = await fetch('/api/auth/oauth/connections')
      if (response.ok) {
        const data = await response.json()
        const connections = data.connections || []

        // Update services with connection status and account info
        const updatedServices = serviceDefinitions.map((service) => {
          // Find matching connection - now we can do an exact match on providerId
          const connection = connections.find((conn: any) => {
            // Exact match on providerId is the most reliable
            return conn.provider === service.providerId;
          });

          // If we found an exact match, use it
          if (connection) {
            return {
              ...service,
              isConnected: connection.accounts?.length > 0,
              accounts: connection.accounts || [],
              lastConnected: connection.lastConnected,
            }
          }

          // If no exact match, check if any connection has all the required scopes
          const connectionWithScopes = connections.find((conn: any) => {
            // Only consider connections from the same base provider
            if (!conn.baseProvider || !service.providerId.startsWith(conn.baseProvider)) {
              return false;
            }
            
            // Check if all required scopes for this service are included in the connection
            if (conn.scopes && service.scopes) {
              return service.scopes.every(scope => conn.scopes.includes(scope));
            }
            
            return false;
          });

          if (connectionWithScopes) {
            return {
              ...service,
              isConnected: connectionWithScopes.accounts?.length > 0,
              accounts: connectionWithScopes.accounts || [],
              lastConnected: connectionWithScopes.lastConnected,
            }
          }

          return service;
        })

        setServices(updatedServices)
      } else {
        // If there's an error, just use the base definitions
        setServices(serviceDefinitions)
      }
    } catch (error) {
      logger.error('Error fetching services:', { error })
      // Use base definitions on error
      setServices(defineServices())
    } finally {
      setIsLoading(false)
    }
  }

  // Check for OAuth callback
  useEffect(() => {
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    // Handle OAuth callback
    if (code && state) {
      // This is an OAuth callback - set success flag
      setAuthSuccess(true)

      // Refresh connections to show the new connection
      if (userId) {
        fetchServices()
      }

      // Clear the URL parameters
      router.replace('/w')
    } else if (error) {
      logger.error('OAuth error:', { error })
      router.replace('/w')
    }
  }, [searchParams, router, userId])

  // Check for pending OAuth connections and return URL
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Check if there's a pending OAuth connection
    const serviceId = loadFromStorage<string>('pending_service_id')
    const scopes = loadFromStorage<string[]>('pending_oauth_scopes') || []
    const returnUrl = loadFromStorage<string>('pending_oauth_return_url')

    if (serviceId) {
      setPendingService(serviceId)
      setPendingScopes(scopes)

      // Clear the pending connection after a short delay
      // This gives the user time to see the highlighted connection
      setTimeout(() => {
        removeFromStorage('pending_service_id')
        removeFromStorage('pending_oauth_scopes')
      }, 500)
    }

    // Handle successful authentication return
    if (authSuccess && returnUrl && onOpenChange) {
      // Clear the success flag
      setAuthSuccess(false)
      removeFromStorage('pending_oauth_return_url')

      // Close the settings modal and return to workflow
      setTimeout(() => {
        onOpenChange(false)

        // Navigate back to the workflow if needed
        if (returnUrl !== window.location.href) {
          router.push(returnUrl)
        }
      }, 1500) // Slightly longer delay to show the connected state
    }
  }, [authSuccess, onOpenChange, router])

  // Fetch services on mount
  useEffect(() => {
    if (userId) {
      fetchServices()
    }
  }, [userId])

  // Handle connect button click
  const handleConnect = async (service: ServiceInfo) => {
    try {
      setIsConnecting(service.id)

      // Store information about the connection
      saveToStorage<string>('pending_service_id', service.id)
      saveToStorage<string[]>('pending_oauth_scopes', service.scopes)
      saveToStorage<string>('pending_oauth_return_url', window.location.href)
      saveToStorage<string>('pending_oauth_provider_id', service.providerId)
      
      logger.info('Connecting service:', {
        serviceId: service.id,
        providerId: service.providerId,
        scopes: service.scopes,
      })

      await client.oauth2.link({
        providerId: service.providerId,
        callbackURL: window.location.href,
      })
    } catch (error) {
      logger.error('OAuth connection error:', { error })
      setIsConnecting(null)
    }
  }

  // Handle disconnect button click
  const handleDisconnect = async (service: ServiceInfo, accountId: string) => {
    setIsConnecting(`${service.id}-${accountId}`)
    try {
      // Call the API to disconnect the account
      const response = await fetch('/api/auth/oauth/disconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: service.providerId.split('-')[0],
          accountId,
        }),
      })

      if (response.ok) {
        // Update the local state by removing the disconnected account
        setServices((prev) =>
          prev.map((svc) => {
            if (svc.id === service.id) {
              return {
                ...svc,
                accounts: svc.accounts?.filter((acc) => acc.id !== accountId) || [],
                isConnected: (svc.accounts?.length || 0) > 1,
              }
            }
            return svc
          })
        )
      } else {
        logger.error('Error disconnecting service')
      }
    } catch (error) {
      logger.error('Error disconnecting service:', { error })
    } finally {
      setIsConnecting(null)
    }
  }

  // Group services by provider
  const groupedServices = services.reduce(
    (acc, service) => {
      // Find the provider for this service
      const providerKey =
        Object.keys(OAUTH_PROVIDERS).find((key) =>
          Object.keys(OAUTH_PROVIDERS[key].services).includes(service.id)
        ) || 'other'

      if (!acc[providerKey]) {
        acc[providerKey] = []
      }

      acc[providerKey].push(service)
      return acc
    },
    {} as Record<string, ServiceInfo[]>
  )

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-1">Credentials</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Connect your accounts to use tools that require authentication.
        </p>
      </div>

      {/* Success message */}
      {authSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-md p-4 mb-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <Check className="h-5 w-5 text-green-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-green-800">Account connected successfully!</p>
            </div>
          </div>
        </div>
      )}

      {/* Pending service message */}
      {pendingService && (
        <div className="mb-6 p-4 bg-primary/10 border border-primary rounded-md text-sm flex items-start gap-2">
          <div className="min-w-4 mt-0.5">
            <ExternalLink className="h-4 w-4 text-primary" />
          </div>
          <p>
            <span className="font-medium text-primary">Action Required:</span> Please connect your
            account to enable the requested features. The required service will be highlighted
            below.
          </p>
        </div>
      )}

      {/* Loading state */}
      {isLoading ? (
        <div className="space-y-4">
          <ConnectionSkeleton />
          <ConnectionSkeleton />
          <ConnectionSkeleton />
          <ConnectionSkeleton />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Group services by provider */}
          {Object.entries(groupedServices).map(([providerKey, providerServices]) => (
            <div key={providerKey} className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground">
                {OAUTH_PROVIDERS[providerKey]?.name || 'Other Services'}
              </h4>
              <div className="space-y-4">
                {providerServices.map((service) => (
                  <Card
                    key={service.id}
                    className={cn(
                      'p-6 transition-all hover:shadow-md',
                      pendingService === service.id && 'border-primary shadow-md'
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted shrink-0">
                          {typeof service.icon === 'function'
                            ? service.icon({ className: 'h-5 w-5' })
                            : service.icon}
                        </div>
                        <div className="space-y-1">
                          <div>
                            <h4 className="font-medium leading-none">{service.name}</h4>
                            <p className="text-sm text-muted-foreground mt-1">
                              {service.description}
                            </p>
                          </div>
                          {service.accounts && service.accounts.length > 0 && (
                            <div className="pt-3 space-y-2">
                              {service.accounts.map((account) => (
                                <div
                                  key={account.id}
                                  className="flex items-center justify-between gap-2 rounded-md border bg-card/50 p-2"
                                >
                                  <div className="flex items-center gap-2">
                                    <div className="h-6 w-6 rounded-full bg-green-500/10 flex items-center justify-center">
                                      <Check className="h-3 w-3 text-green-600" />
                                    </div>
                                    <span className="text-sm font-medium">{account.name}</span>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDisconnect(service, account.id)}
                                    disabled={isConnecting === `${service.id}-${account.id}`}
                                    className="h-7 px-2"
                                  >
                                    {isConnecting === `${service.id}-${account.id}` ? (
                                      <RefreshCw className="h-3 w-3 animate-spin" />
                                    ) : (
                                      'Disconnect'
                                    )}
                                  </Button>
                                </div>
                              ))}
                              {/* <Button
                                variant="outline"
                                size="sm"
                                className="w-full mt-2"
                                onClick={() => handleConnect(service)}
                                disabled={isConnecting === service.id}
                              >
                                {isConnecting === service.id ? (
                                  <>
                                    <RefreshCw className="h-3 w-3 animate-spin mr-2" />
                                    Connecting...
                                  </>
                                ) : (
                                  <>
                                    <Plus className="h-3 w-3 mr-2" />
                                    Connect Another Account
                                  </>
                                )}
                              </Button> */}
                            </div>
                          )}
                        </div>
                      </div>

                      {!service.accounts?.length && (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleConnect(service)}
                          disabled={isConnecting === service.id}
                          className="shrink-0"
                        >
                          {isConnecting === service.id ? (
                            <>
                              <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                              Connecting...
                            </>
                          ) : (
                            'Connect'
                          )}
                        </Button>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Loading skeleton for connections
function ConnectionSkeleton() {
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Skeleton className="h-12 w-12 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <Skeleton className="h-9 w-24 shrink-0" />
      </div>
    </Card>
  )
}
