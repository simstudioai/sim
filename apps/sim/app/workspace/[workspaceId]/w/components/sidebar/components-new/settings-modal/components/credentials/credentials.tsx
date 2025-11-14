'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ExternalLink, Search } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/emcn'
import { Input, Label } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'
import { cn } from '@/lib/utils'
import {
  type ServiceInfo,
  useConnectOAuthService,
  useDisconnectOAuthService,
  useOAuthConnections,
} from '@/hooks/queries/oauth-connections'

const logger = createLogger('Credentials')

interface CredentialsProps {
  onOpenChange?: (open: boolean) => void
  registerCloseHandler?: (handler: (open: boolean) => void) => void
}

export function Credentials({ onOpenChange, registerCloseHandler }: CredentialsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const userId = session?.user?.id
  const pendingServiceRef = useRef<HTMLDivElement>(null)

  // React Query hooks - with placeholderData to show cached data immediately (no skeleton loading!)
  const { data: services = [] } = useOAuthConnections()
  const connectService = useConnectOAuthService()
  const disconnectService = useDisconnectOAuthService()

  // Local UI state
  const [searchTerm, setSearchTerm] = useState('')
  const [pendingService, setPendingService] = useState<string | null>(null)
  const [_pendingScopes, setPendingScopes] = useState<string[]>([])
  const [authSuccess, setAuthSuccess] = useState(false)
  const [showActionRequired, setShowActionRequired] = useState(false)
  const prevConnectedIdsRef = useRef<Set<string>>(new Set())
  const connectionAddedRef = useRef<boolean>(false)

  // Check for OAuth callback
  useEffect(() => {
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    // Handle OAuth callback
    if (code && state) {
      // This is an OAuth callback - try to restore state from localStorage
      try {
        const stored = localStorage.getItem('pending_oauth_state')
        if (stored) {
          const oauthState = JSON.parse(stored)
          logger.info('OAuth callback with restored state:', oauthState)

          // Mark as pending if we have context about what service was being connected
          if (oauthState.serviceId) {
            setPendingService(oauthState.serviceId)
            setShowActionRequired(true)
          }

          // Clean up the state (one-time use)
          localStorage.removeItem('pending_oauth_state')
        } else {
          logger.warn('OAuth callback but no state found in localStorage')
        }
      } catch (error) {
        logger.error('Error loading OAuth state from localStorage:', error)
        localStorage.removeItem('pending_oauth_state') // Clean up corrupted state
      }

      // Set success flag
      setAuthSuccess(true)

      // Clear the URL parameters
      router.replace('/workspace')
    } else if (error) {
      logger.error('OAuth error:', { error })
      router.replace('/workspace')
    }
  }, [searchParams, router])

  // Track when a new connection is added compared to previous render
  useEffect(() => {
    try {
      const currentConnected = new Set<string>()
      services.forEach((svc) => {
        if (svc.isConnected) currentConnected.add(svc.id)
      })
      // Detect new connections by comparing to previous connected set
      for (const id of currentConnected) {
        if (!prevConnectedIdsRef.current.has(id)) {
          connectionAddedRef.current = true
          break
        }
      }
      prevConnectedIdsRef.current = currentConnected
    } catch {}
  }, [services])

  // On mount, register a close handler so the parent modal can delegate close events here
  useEffect(() => {
    if (!registerCloseHandler) return
    const handle = (open: boolean) => {
      if (open) return
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('oauth-integration-closed', {
              detail: { success: connectionAddedRef.current === true },
            })
          )
        }
      } catch {}
      onOpenChange?.(open)
    }
    registerCloseHandler(handle)
  }, [registerCloseHandler, onOpenChange])

  // Handle connect button click
  const handleConnect = async (service: ServiceInfo) => {
    try {
      logger.info('Connecting service:', {
        serviceId: service.id,
        providerId: service.providerId,
        scopes: service.scopes,
      })

      await connectService.mutateAsync({
        providerId: service.providerId,
        callbackURL: window.location.href,
      })
    } catch (error) {
      logger.error('OAuth connection error:', { error })
    }
  }

  // Handle disconnect button click
  const handleDisconnect = async (service: ServiceInfo, accountId: string) => {
    try {
      await disconnectService.mutateAsync({
        provider: service.providerId.split('-')[0],
        providerId: service.providerId,
        serviceId: service.id,
        accountId,
      })
    } catch (error) {
      logger.error('Error disconnecting service:', { error })
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

  // Filter services based on search term
  const filteredGroupedServices = Object.entries(groupedServices).reduce(
    (acc, [providerKey, providerServices]) => {
      const filteredServices = providerServices.filter(
        (service) =>
          service.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          service.description.toLowerCase().includes(searchTerm.toLowerCase())
      )

      if (filteredServices.length > 0) {
        acc[providerKey] = filteredServices
      }

      return acc
    },
    {} as Record<string, ServiceInfo[]>
  )

  const scrollToHighlightedService = () => {
    if (pendingServiceRef.current) {
      pendingServiceRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }
  }

  return (
    <div className='relative flex h-full flex-col'>
      {/* Search Input */}
      <div className='px-6 pt-4 pb-2'>
        <div className='flex h-9 w-56 items-center gap-2 rounded-[8px] border bg-transparent pr-2 pl-3'>
          <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
          <Input
            placeholder='Search services...'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className='flex-1 border-0 bg-transparent px-0 font-[380] font-sans text-base text-foreground leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>
      </div>

      {/* Scrollable Content */}
      <div className='min-h-0 flex-1 overflow-y-auto px-6'>
        <div className='flex flex-col gap-6 pt-2 pb-6'>
          {/* Success message */}
          {authSuccess && (
            <div className='rounded-[8px] border border-green-200 bg-green-50 p-4'>
              <div className='flex'>
                <div className='flex-shrink-0'>
                  <Check className='h-5 w-5 text-green-400' />
                </div>
                <div className='ml-3'>
                  <p className='font-medium text-green-800 text-sm'>
                    Account connected successfully!
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Pending service message - only shown when coming from OAuth required modal */}
          {pendingService && showActionRequired && (
            <div className='flex items-start gap-3 rounded-[8px] border border-primary/20 bg-primary/5 p-5 text-sm shadow-sm'>
              <div className='mt-0.5 min-w-5'>
                <ExternalLink className='h-4 w-4 text-muted-foreground' />
              </div>
              <div className='flex flex-1 flex-col'>
                <p className='text-muted-foreground'>
                  <span className='font-medium text-foreground'>Action Required:</span> Please
                  connect your account to enable the requested features. The required service is
                  highlighted below.
                </p>
                <Button
                  variant='outline'
                  onClick={scrollToHighlightedService}
                  className='mt-3 flex h-8 items-center gap-1.5 self-start border-primary/20 px-3 font-medium text-muted-foreground text-sm transition-colors hover:border-primary hover:bg-primary/10 hover:text-muted-foreground'
                >
                  <span>Go to service</span>
                  <ChevronDown className='h-3.5 w-3.5' />
                </Button>
              </div>
            </div>
          )}

          {/* Services list */}
          <div className='flex flex-col gap-6'>
            {Object.entries(filteredGroupedServices).map(([providerKey, providerServices]) => (
              <div key={providerKey} className='flex flex-col gap-2'>
                <Label className='font-normal text-muted-foreground text-xs uppercase'>
                  {OAUTH_PROVIDERS[providerKey]?.name || 'Other Services'}
                </Label>
                {providerServices.map((service) => (
                  <div
                    key={service.id}
                    className={cn(
                      'flex items-center justify-between gap-4',
                      pendingService === service.id && '-m-2 rounded-[8px] bg-primary/5 p-2'
                    )}
                    ref={pendingService === service.id ? pendingServiceRef : undefined}
                  >
                    <div className='flex items-center gap-3'>
                      <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-muted'>
                        {typeof service.icon === 'function'
                          ? service.icon({ className: 'h-5 w-5' })
                          : service.icon}
                      </div>
                      <div className='min-w-0'>
                        <div className='flex items-center gap-2'>
                          <span className='font-normal text-sm'>{service.name}</span>
                        </div>
                        {service.accounts && service.accounts.length > 0 ? (
                          <p className='truncate text-muted-foreground text-xs'>
                            {service.accounts.map((a) => a.name).join(', ')}
                          </p>
                        ) : (
                          <p className='truncate text-muted-foreground text-xs'>
                            {service.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {service.accounts && service.accounts.length > 0 ? (
                      <Button
                        variant='ghost'
                        onClick={() => handleDisconnect(service, service.accounts![0].id)}
                        disabled={disconnectService.isPending}
                        className='h-8 text-muted-foreground hover:text-foreground'
                      >
                        Disconnect
                      </Button>
                    ) : (
                      <Button
                        variant='outline'
                        onClick={() => handleConnect(service)}
                        disabled={connectService.isPending}
                        className='h-8'
                      >
                        Connect
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ))}

            {/* Show message when search has no results */}
            {searchTerm.trim() && Object.keys(filteredGroupedServices).length === 0 && (
              <div className='py-8 text-center text-muted-foreground text-sm'>
                No services found matching "{searchTerm}"
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
