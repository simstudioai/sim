'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '@/components/emcn/components/button/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createLogger } from '@/lib/logs/console/logger'
import {
  getCanonicalScopesForProvider,
  getProviderIdFromServiceId,
  getServiceIdFromScopes,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  parseProvider,
} from '@/lib/oauth'
import { OAuthRequiredModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/credential-selector/components/oauth-required-modal'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { useOAuthCredentialDetail, useOAuthCredentials } from '@/hooks/queries/oauth-credentials'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { getMissingRequiredScopes } from '@/hooks/use-oauth-scope-status'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('CredentialSelector')

interface CredentialSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: any | null
}

export function CredentialSelector({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
}: CredentialSelectorProps) {
  const [open, setOpen] = useState(false)
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const { activeWorkflowId } = useWorkflowRegistry()
  const { collaborativeSetSubblockValue } = useCollaborativeWorkflow()

  // Use collaborative state management via useSubBlockValue hook
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)

  // Extract values from subBlock config
  const provider = subBlock.provider as OAuthProvider
  const requiredScopes = subBlock.requiredScopes || []
  const label = subBlock.placeholder || 'Select credential'
  const serviceId = subBlock.serviceId

  // Get the effective value (preview or store value)
  const effectiveValue = isPreview && previewValue !== undefined ? previewValue : storeValue

  // Initialize selectedId with the effective value
  useEffect(() => {
    setSelectedId(effectiveValue || '')
  }, [effectiveValue])

  // Derive service and provider IDs using useMemo
  const effectiveServiceId = useMemo(() => {
    return serviceId || getServiceIdFromScopes(provider, requiredScopes)
  }, [provider, requiredScopes, serviceId])

  const effectiveProviderId = useMemo(() => {
    return getProviderIdFromServiceId(effectiveServiceId)
  }, [effectiveServiceId])

  const {
    data: credentials = [],
    isFetching: credentialsLoading,
    refetch: refetchCredentials,
  } = useOAuthCredentials(effectiveProviderId, Boolean(effectiveProviderId))

  const selectedCredential = credentials.find((cred) => cred.id === selectedId)

  const shouldFetchForeignMeta =
    Boolean(selectedId) &&
    !selectedCredential &&
    Boolean(activeWorkflowId) &&
    Boolean(effectiveProviderId)

  const { data: foreignCredentials = [], isFetching: foreignMetaLoading } =
    useOAuthCredentialDetail(
      shouldFetchForeignMeta ? selectedId : undefined,
      activeWorkflowId || undefined,
      shouldFetchForeignMeta
    )

  const hasForeignMeta = foreignCredentials.length > 0

  useEffect(() => {
    if (!isPreview && selectedId && !selectedCredential && !hasForeignMeta && !credentialsLoading) {
      logger.info('Clearing invalid credential selection - credential was disconnected', {
        selectedId,
        provider: effectiveProviderId,
      })
      setStoreValue('')
      setSelectedId('')
    }
  }, [
    isPreview,
    selectedId,
    selectedCredential,
    hasForeignMeta,
    credentialsLoading,
    effectiveProviderId,
    setStoreValue,
  ])

  // Listen for visibility changes to update credentials when user returns from settings
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refetchCredentials()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refetchCredentials])

  // Also handle BFCache restores (back/forward navigation) where visibility change may not fire reliably
  useEffect(() => {
    const handlePageShow = (event: any) => {
      if (event?.persisted) {
        void refetchCredentials()
      }
    }
    window.addEventListener('pageshow', handlePageShow)
    return () => {
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [refetchCredentials])

  // Listen for credential disconnection events from settings modal
  useEffect(() => {
    const handleCredentialDisconnected = (event: Event) => {
      const customEvent = event as CustomEvent
      const { providerId } = customEvent.detail
      // Re-fetch if this disconnection affects our provider
      if (providerId && (providerId === effectiveProviderId || providerId.startsWith(provider))) {
        void refetchCredentials()
      }
    }

    window.addEventListener('credential-disconnected', handleCredentialDisconnected)

    return () => {
      window.removeEventListener('credential-disconnected', handleCredentialDisconnected)
    }
  }, [refetchCredentials, effectiveProviderId, provider])

  // Handle popover open to fetch fresh credentials
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen) {
      void refetchCredentials()
    }
  }

  const isForeign = !!(selectedId && !selectedCredential && hasForeignMeta)

  // If the list doesn’t contain the effective value but meta says it exists, synthesize a non-leaky placeholder to render stable UI
  const displayName = selectedCredential
    ? selectedCredential.name
    : isForeign
      ? 'Saved by collaborator'
      : undefined

  // Determine if additional permissions are required for the selected credential
  const hasSelection = !!selectedCredential
  const missingRequiredScopes = hasSelection
    ? getMissingRequiredScopes(selectedCredential, requiredScopes || [])
    : []
  const needsUpdate =
    hasSelection &&
    missingRequiredScopes.length > 0 &&
    !disabled &&
    !isPreview &&
    !credentialsLoading

  // Handle selection
  const handleSelect = (credentialId: string) => {
    const previousId = selectedId || (effectiveValue as string) || ''
    setSelectedId(credentialId)
    if (!isPreview) {
      setStoreValue(credentialId)
    }
    setOpen(false)
  }

  // Handle adding a new credential
  const handleAddCredential = () => {
    // Show the OAuth modal
    setShowOAuthModal(true)
    setOpen(false)
  }

  // Get provider icon
  const getProviderIcon = (providerName: OAuthProvider) => {
    const { baseProvider } = parseProvider(providerName)
    const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

    if (!baseProviderConfig) {
      return <ExternalLink className='h-4 w-4' />
    }
    // Always use the base provider icon for a more consistent UI
    return baseProviderConfig.icon({ className: 'h-4 w-4' })
  }

  // Get provider name
  const getProviderName = (providerName: OAuthProvider) => {
    const { baseProvider } = parseProvider(providerName)
    const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

    if (baseProviderConfig) {
      return baseProviderConfig.name
    }

    // Fallback: capitalize the provider name
    return providerName
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant='outline'
            role='combobox'
            aria-expanded={open}
            className='relative w-full justify-between'
            disabled={disabled}
          >
            <div className='flex max-w-[calc(100%-20px)] items-center gap-2 overflow-hidden'>
              {getProviderIcon(provider)}
              <span
                className={displayName ? 'truncate font-normal' : 'truncate text-muted-foreground'}
              >
                {displayName || label}
              </span>
            </div>
            <ChevronDown className='absolute right-3 h-4 w-4 shrink-0 opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-[250px] p-0' align='start'>
          <Command>
            <CommandInput
              placeholder='Search credentials...'
              className='text-foreground placeholder:text-muted-foreground'
            />
            <CommandList>
              <CommandEmpty>
                {credentialsLoading ? (
                  <div className='flex items-center justify-center p-4'>
                    <RefreshCw className='h-4 w-4 animate-spin' />
                    <span className='ml-2'>Loading credentials...</span>
                  </div>
                ) : (
                  <div className='p-4 text-center'>
                    <p className='font-medium text-sm'>No credentials found.</p>
                    <p className='text-muted-foreground text-xs'>
                      Connect a new account to continue.
                    </p>
                  </div>
                )}
              </CommandEmpty>
              {credentials.length > 0 && (
                <CommandGroup>
                  {credentials.map((cred) => (
                    <CommandItem
                      key={cred.id}
                      value={cred.id}
                      onSelect={() => handleSelect(cred.id)}
                    >
                      <div className='flex items-center gap-2'>
                        {getProviderIcon(cred.provider)}
                        <span className='font-normal'>{cred.name}</span>
                      </div>
                      {cred.id === selectedId && <Check className='ml-auto h-4 w-4' />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {credentials.length === 0 && (
                <CommandGroup>
                  <CommandItem onSelect={handleAddCredential}>
                    <div className='flex items-center gap-2 text-foreground'>
                      {getProviderIcon(provider)}
                      <span>Connect {getProviderName(provider)} account</span>
                    </div>
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {needsUpdate && (
        <div className='mt-2 flex items-center justify-between rounded-[6px] border border-amber-300/40 bg-amber-50/60 px-2 py-1 font-medium text-[12px] transition-colors dark:bg-amber-950/10'>
          <span>Additional permissions required</span>
          {!isForeign && <Button onClick={() => setShowOAuthModal(true)}>Update access</Button>}
        </div>
      )}

      {showOAuthModal && (
        <OAuthRequiredModal
          isOpen={showOAuthModal}
          onClose={() => setShowOAuthModal(false)}
          provider={provider}
          toolName={getProviderName(provider)}
          requiredScopes={getCanonicalScopesForProvider(effectiveProviderId)}
          newScopes={missingRequiredScopes}
          serviceId={effectiveServiceId}
        />
      )}
    </>
  )
}
