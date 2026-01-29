'use client'

import { createElement, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Check, ChevronDown, ExternalLink, Search } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Button,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { Input, Skeleton } from '@/components/ui'
import { cn } from '@/lib/core/utils/cn'
import { OAUTH_PROVIDERS } from '@/lib/oauth'
import {
  type ServiceInfo,
  useConnectOAuthService,
  useDisconnectOAuthService,
  useOAuthConnections,
} from '@/hooks/queries/oauth-connections'
import { usePermissionConfig } from '@/hooks/use-permission-config'

const logger = createLogger('Integrations')

/**
 * Static skeleton structure matching OAUTH_PROVIDERS layout
 * Each entry: [providerName, serviceCount]
 */
const SKELETON_STRUCTURE: [string, number][] = [
  ['Google', 7],
  ['Microsoft', 6],
  ['GitHub', 1],
  ['X', 1],
  ['Confluence', 1],
  ['Jira', 1],
  ['Airtable', 1],
  ['Notion', 1],
  ['Linear', 1],
  ['Slack', 1],
  ['Reddit', 1],
  ['Wealthbox', 1],
  ['Webflow', 1],
  ['Trello', 1],
  ['Asana', 1],
  ['Pipedrive', 1],
  ['HubSpot', 1],
  ['Salesforce', 1],
]

function IntegrationsSkeleton() {
  return (
    <div className='flex h-full flex-col gap-[16px]'>
      <div className='flex w-full items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px] transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover:border-[var(--border-1)] dark:hover:bg-[var(--surface-5)]'>
        <Search className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]' />
        <Input
          placeholder='Search integrations...'
          disabled
          className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
        />
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='flex flex-col gap-[16px]'>
          {SKELETON_STRUCTURE.map(([providerName, serviceCount]) => (
            <div key={providerName} className='flex flex-col gap-[8px]'>
              <Skeleton className='h-[14px] w-[60px]' />
              {Array.from({ length: serviceCount }).map((_, index) => (
                <div key={index} className='flex items-center justify-between'>
                  <div className='flex items-center gap-[12px]'>
                    <Skeleton className='h-9 w-9 flex-shrink-0 rounded-[6px]' />
                    <div className='flex flex-col justify-center gap-[1px]'>
                      <Skeleton className='h-[14px] w-[100px]' />
                      <Skeleton className='h-[13px] w-[200px]' />
                    </div>
                  </div>
                  <Skeleton className='h-[32px] w-[72px] rounded-[6px]' />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface IntegrationsProps {
  onOpenChange?: (open: boolean) => void
  registerCloseHandler?: (handler: (open: boolean) => void) => void
}

export function Integrations({ onOpenChange, registerCloseHandler }: IntegrationsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pendingServiceRef = useRef<HTMLDivElement>(null)

  const { data: services = [], isPending } = useOAuthConnections()
  const connectService = useConnectOAuthService()
  const disconnectService = useDisconnectOAuthService()
  const { config: permissionConfig } = usePermissionConfig()

  const [searchTerm, setSearchTerm] = useState('')
  const [pendingService, setPendingService] = useState<string | null>(null)
  const [authSuccess, setAuthSuccess] = useState(false)
  const [showActionRequired, setShowActionRequired] = useState(false)
  const prevConnectedIdsRef = useRef<Set<string>>(new Set())
  const connectionAddedRef = useRef<boolean>(false)

  // Disconnect confirmation dialog state
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false)
  const [serviceToDisconnect, setServiceToDisconnect] = useState<{
    service: ServiceInfo
    accountId: string
  } | null>(null)

  // Check for OAuth callback - just show success message
  useEffect(() => {
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (code && state) {
      logger.info('OAuth callback successful')
      setAuthSuccess(true)

      // Clear URL parameters without changing the page
      const url = new URL(window.location.href)
      url.searchParams.delete('code')
      url.searchParams.delete('state')
      router.replace(url.pathname + url.search)
    } else if (error) {
      logger.error('OAuth error:', { error })
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

      // better-auth will automatically redirect back to this URL after OAuth
      await connectService.mutateAsync({
        providerId: service.providerId,
        callbackURL: window.location.href,
      })
    } catch (error) {
      logger.error('OAuth connection error:', { error })
    }
  }

  /**
   * Opens the disconnect confirmation dialog for a service.
   */
  const handleDisconnect = (service: ServiceInfo, accountId: string) => {
    setServiceToDisconnect({ service, accountId })
    setShowDisconnectDialog(true)
  }

  /**
   * Confirms and executes the service disconnection.
   */
  const confirmDisconnect = async () => {
    if (!serviceToDisconnect) return

    setShowDisconnectDialog(false)
    const { service, accountId } = serviceToDisconnect
    setServiceToDisconnect(null)

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

  // Group services by provider, filtering by permission config
  const groupedServices = services.reduce(
    (acc, service) => {
      // Filter based on allowedIntegrations
      if (
        permissionConfig.allowedIntegrations !== null &&
        !permissionConfig.allowedIntegrations.includes(service.id)
      ) {
        return acc
      }

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

  if (isPending) {
    return <IntegrationsSkeleton />
  }

  return (
    <>
      <div className='flex h-full flex-col gap-[16px]'>
        <div className='flex w-full items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px] transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover:border-[var(--border-1)] dark:hover:bg-[var(--surface-5)]'>
          <Search className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]' />
          <Input
            placeholder='Search services...'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto'>
          <div className='flex flex-col gap-[16px]'>
            {authSuccess && (
              <div className='flex items-center gap-[12px] rounded-[8px] border border-green-200 bg-green-50 p-[12px]'>
                <Check className='h-4 w-4 flex-shrink-0 text-green-500' />
                <p className='font-medium text-[13px] text-green-800'>
                  Account connected successfully!
                </p>
              </div>
            )}

            {pendingService && showActionRequired && (
              <div className='flex items-start gap-[12px] rounded-[8px] border border-[var(--border)] bg-[var(--bg)] p-[12px]'>
                <ExternalLink className='mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--text-muted)]' />
                <div className='flex flex-1 flex-col gap-[8px]'>
                  <p className='text-[13px] text-[var(--text-muted)]'>
                    <span className='font-medium text-[var(--text-primary)]'>Action Required:</span>{' '}
                    Please connect your account to enable the requested features.
                  </p>
                  <Button variant='outline' onClick={scrollToHighlightedService}>
                    <span>Go to service</span>
                    <ChevronDown className='h-3 w-3' />
                  </Button>
                </div>
              </div>
            )}

            <div className='flex flex-col gap-[16px]'>
              {Object.entries(filteredGroupedServices).map(([providerKey, providerServices]) => (
                <div key={providerKey} className='flex flex-col gap-[8px]'>
                  <Label className='text-[12px] text-[var(--text-tertiary)]'>
                    {OAUTH_PROVIDERS[providerKey]?.name || 'Other Services'}
                  </Label>
                  {providerServices.map((service) => (
                    <div
                      key={service.id}
                      className={cn(
                        'flex items-center justify-between',
                        pendingService === service.id &&
                          '-m-[8px] rounded-[8px] bg-[var(--bg)] p-[8px]'
                      )}
                      ref={pendingService === service.id ? pendingServiceRef : undefined}
                    >
                      <div className='flex items-center gap-[12px]'>
                        <div className='flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-[var(--surface-5)]'>
                          {createElement(service.icon, { className: 'h-4 w-4' })}
                        </div>
                        <div className='flex flex-col justify-center gap-[1px]'>
                          <span className='font-medium text-[14px]'>{service.name}</span>
                          {service.accounts && service.accounts.length > 0 ? (
                            <p className='truncate text-[13px] text-[var(--text-muted)]'>
                              {service.accounts.map((a) => a.name).join(', ')}
                            </p>
                          ) : (
                            <p className='truncate text-[13px] text-[var(--text-muted)]'>
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
                        >
                          Disconnect
                        </Button>
                      ) : (
                        <Button
                          variant='tertiary'
                          onClick={() => handleConnect(service)}
                          disabled={connectService.isPending}
                        >
                          Connect
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ))}

              {searchTerm.trim() && Object.keys(filteredGroupedServices).length === 0 && (
                <div className='py-[16px] text-center text-[13px] text-[var(--text-muted)]'>
                  No services found matching "{searchTerm}"
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Modal open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <ModalContent size='sm'>
          <ModalHeader>Disconnect Service</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to disconnect{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {serviceToDisconnect?.service.name}
              </span>
              ?{' '}
              <span className='text-[var(--text-error)]'>
                This will revoke access and you will need to reconnect to use this service.
              </span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setShowDisconnectDialog(false)}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={confirmDisconnect}>
              Disconnect
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
