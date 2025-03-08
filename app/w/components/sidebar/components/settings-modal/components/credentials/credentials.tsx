'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, ExternalLink, Plus, RefreshCw } from 'lucide-react'
import {
  GithubIcon,
  GoogleDocsIcon,
  GoogleDriveIcon,
  GoogleSheetsIcon,
  xIcon as XIcon,
} from '@/components/icons'
import { GmailIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { client } from '@/lib/auth-client'
import { useSession } from '@/lib/auth-client'
import { cn } from '@/lib/utils'
import { loadFromStorage, removeFromStorage, saveToStorage } from '@/stores/workflows/persistence'
import { OAuthProvider } from '@/tools/types'

interface CredentialsProps {
  onOpenChange?: (open: boolean) => void
}

interface ServiceInfo {
  id: string
  name: string
  description: string
  provider: OAuthProvider
  providerId: string
  icon: React.ReactNode
  isConnected: boolean
  scopes: string[]
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

  // Define available services
  const defineServices = (): ServiceInfo[] => [
    {
      id: 'gmail',
      name: 'Gmail',
      description: 'Automate email workflows and enhance communication efficiency.',
      provider: 'google',
      providerId: 'google-email',
      icon: <GmailIcon className="h-5 w-5" />,
      isConnected: false,
      scopes: [],
    },
    {
      id: 'google-drive',
      name: 'Google Drive',
      description: 'Streamline file organization and document workflows.',
      provider: 'google',
      providerId: 'google-drive',
      icon: <GoogleDriveIcon className="h-5 w-5" />,
      isConnected: false,
      scopes: [],
    },
    {
      id: 'google-docs',
      name: 'Google Docs',
      description: 'Create, read, and edit Google Documents programmatically.',
      provider: 'google',
      providerId: 'google-docs',
      icon: <GoogleDocsIcon className="h-5 w-5" />,
      isConnected: false,
      scopes: [],
    },
    {
      id: 'google-sheets',
      name: 'Google Sheets',
      description: 'Create, read, and edit Google Sheets programmatically.',
      provider: 'google',
      providerId: 'google-sheets',
      icon: <GoogleSheetsIcon className="h-5 w-5" />,
      isConnected: false,
      scopes: [],
    },
    {
      id: 'github',
      name: 'GitHub',
      description: 'Access repositories, issues, and other GitHub features.',
      provider: 'github',
      providerId: 'github-repo',
      icon: <GithubIcon className="h-5 w-5" />,
      isConnected: false,
      scopes: [],
    },
    {
      id: 'twitter',
      name: 'X (Twitter)',
      description: 'Read and post tweets, access user data, and more.',
      provider: 'twitter',
      providerId: 'twitter-read',
      icon: <XIcon className="h-5 w-5" />,
      isConnected: false,
      scopes: [],
    },
  ]

  // Fetch connection status
  const fetchServices = async () => {
    if (!userId) return

    setIsLoading(true)
    try {
      // Get the base services
      const baseServices = defineServices()

      // Call your API to check connections
      const response = await fetch('/api/auth/oauth/connections')
      if (response.ok) {
        const data = await response.json()
        const connections = data.connections || []

        // Update services with connection status
        const updatedServices = baseServices.map((service) => {
          // Find matching connection
          const connection = connections.find((conn: any) => {
            if (
              service.id === 'gmail' &&
              conn.provider === 'google' &&
              conn.featureType === 'email'
            ) {
              return true
            }
            if (
              service.id === 'google-drive' &&
              conn.provider === 'google' &&
              conn.featureType === 'drive'
            ) {
              return true
            }
            if (
              service.id === 'google-docs' &&
              conn.provider === 'google' &&
              conn.featureType === 'docs'
            ) {
              return true
            }
            if (
              service.id === 'google-sheets' &&
              conn.provider === 'google' &&
              conn.featureType === 'sheets'
            ) {
              return true
            }
            if (service.id === 'github' && conn.provider === 'github') {
              return true
            }
            if (service.id === 'twitter' && conn.provider === 'twitter') {
              return true
            }
            return false
          })

          if (connection) {
            return {
              ...service,
              isConnected: connection.accounts?.length > 0,
              scopes: connection.scopes || [],
              lastConnected: connection.lastConnected,
              accounts: connection.accounts || [],
            }
          }

          return service
        })

        setServices(updatedServices)
      } else {
        // If API fails, set default state
        setServices(baseServices)
      }
    } catch (error) {
      console.error('Error fetching connections:', error)
      // Set default state on error
      setServices(defineServices())
    } finally {
      setIsLoading(false)
    }
  }

  // Handle OAuth callback
  useEffect(() => {
    // Check if this is an OAuth callback
    const code = searchParams.get('code')
    const state = searchParams.get('state')

    if (code && state) {
      // This is an OAuth callback - set success flag
      setAuthSuccess(true)

      // Refresh connections to show the new connection
      if (userId) {
        fetchServices()
      }
    }
  }, [searchParams, userId])

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

  // Fetch connection status on component mount
  useEffect(() => {
    fetchServices()
  }, [userId])

  const handleConnect = async (service: ServiceInfo) => {
    setIsConnecting(service.id)
    try {
      // Store information about the required connection
      saveToStorage('auth_return_url', window.location.href)
      saveToStorage('pending_service_id', service.id)
      saveToStorage('pending_oauth_provider_id', service.providerId)

      // Begin OAuth flow with the appropriate provider
      await client.signIn.oauth2({
        providerId: service.providerId,
        callbackURL: window.location.href,
      })
    } catch (error) {
      console.error('OAuth login error:', error)
      setIsConnecting(null)
    }
  }

  const handleDisconnect = async (service: ServiceInfo, accountId: string) => {
    setIsConnecting(`${service.id}-${accountId}`)
    try {
      // Call your API to disconnect the provider
      const response = await fetch('/api/auth/oauth/disconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: service.provider,
          providerId: service.providerId,
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
      }
    } catch (error) {
      console.error('Error disconnecting provider:', error)
    } finally {
      setIsConnecting(null)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-1">Credentials</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Connect your accounts to use tools that require authentication.
        </p>
      </div>

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

      <div className="space-y-4">
        {isLoading ? (
          <>
            <ConnectionSkeleton />
            <ConnectionSkeleton />
            <ConnectionSkeleton />
            <ConnectionSkeleton />
          </>
        ) : (
          services.map((service) => (
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
                    {service.icon}
                  </div>
                  <div className="space-y-1">
                    <div>
                      <h4 className="font-medium leading-none">{service.name}</h4>
                      <p className="text-sm text-muted-foreground mt-1">{service.description}</p>
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
                        <Button
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
                        </Button>
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
          ))
        )}
      </div>
    </div>
  )
}

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
