'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { client } from '@/lib/auth-client'
import {
  type Credential,
  getProviderIdFromServiceId,
  getServiceIdFromScopes,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  parseProvider,
} from '@/lib/oauth'
import { OAuthRequiredModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/credential-selector/components/oauth-required-modal'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
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
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [hasForeignMeta, setHasForeignMeta] = useState(false)
  const [isAuthorizing, setIsAuthorizing] = useState(false)
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

  // Fetch available credentials for this provider
  const fetchCredentials = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/auth/oauth/credentials?provider=${effectiveProviderId}`)
      if (response.ok) {
        const data = await response.json()
        const creds = data.credentials as Credential[]
        let foreignMetaFound = false

        // If persisted selection is not among viewer's credentials, attempt to fetch its metadata
        if (
          selectedId &&
          !(creds || []).some((cred: Credential) => cred.id === selectedId) &&
          activeWorkflowId
        ) {
          try {
            const metaResp = await fetch(
              `/api/auth/oauth/credentials?credentialId=${selectedId}&workflowId=${activeWorkflowId}`
            )
            if (metaResp.ok) {
              const meta = await metaResp.json()
              if (meta.credentials?.length) {
                // Mark as foreign, but do NOT merge into list to avoid leaking owner email
                foreignMetaFound = true
              }
            }
          } catch {
            // ignore meta errors
          }
        }

        setHasForeignMeta(foreignMetaFound)
        setCredentials(creds)

        // Do not auto-select or reset. We only show what's persisted.
      }
    } catch (error) {
      logger.error('Error fetching credentials:', { error })
    } finally {
      setIsLoading(false)
    }
  }, [effectiveProviderId, selectedId, activeWorkflowId])

  // Fetch credentials on initial mount and whenever the subblock value changes externally
  useEffect(() => {
    fetchCredentials()
  }, [fetchCredentials, effectiveValue])

  // When the selectedId changes (e.g., collaborator saved a credential), determine if it's foreign
  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        if (!selectedId) {
          setHasForeignMeta(false)
          return
        }
        // If the selected credential exists in viewer's list, it's not foreign
        if ((credentials || []).some((cred) => cred.id === selectedId)) {
          setHasForeignMeta(false)
          return
        }
        if (!activeWorkflowId) return
        const metaResp = await fetch(
          `/api/auth/oauth/credentials?credentialId=${selectedId}&workflowId=${activeWorkflowId}`
        )
        if (aborted) return
        if (metaResp.ok) {
          const meta = await metaResp.json()
          setHasForeignMeta(!!meta.credentials?.length)
        }
      } catch {
        // ignore
      }
    })()
    return () => {
      aborted = true
    }
  }, [selectedId, credentials, activeWorkflowId])

  // This effect is no longer needed since we're using effectiveValue directly

  // Listen for visibility changes to update credentials when user returns from settings
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchCredentials()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [fetchCredentials])

  // Also handle BFCache restores (back/forward navigation) where visibility change may not fire reliably
  useEffect(() => {
    const handlePageShow = (event: any) => {
      if (event?.persisted) {
        fetchCredentials()
      }
    }
    window.addEventListener('pageshow', handlePageShow)
    return () => {
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [fetchCredentials])

  // Handle popover open to fetch fresh credentials
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen) {
      // Fetch fresh credentials when opening the dropdown
      fetchCredentials()
    }
  }

  // Get the selected credential
  const selectedCredential = useMemo(
    () => credentials.find((cred) => cred.id === selectedId),
    [credentials, selectedId]
  )
  const isForeign = !!(selectedId && !selectedCredential && hasForeignMeta)
  const missingScopes = selectedCredential?.missingScopes || []
  const extraScopes = selectedCredential?.extraScopes || []
  const requiresReauthorization = !!selectedCredential?.requiresReauthorization

  const handleAuthorize = useCallback(async () => {
    if (!selectedCredential) {
      setShowOAuthModal(true)
      return
    }

    try {
      setIsAuthorizing(true)
      await client.oauth2.link({
        providerId: selectedCredential.provider,
        callbackURL: window.location.href,
      })
    } catch (error) {
      logger.error('Error initiating OAuth reauthorization:', {
        error,
        credentialId: selectedCredential.id,
        provider: selectedCredential.provider,
      })
    } finally {
      setIsAuthorizing(false)
    }
  }, [selectedCredential])


  // If the list doesn’t contain the effective value but meta says it exists, synthesize a non-leaky placeholder to render stable UI
  const displayName = selectedCredential
    ? selectedCredential.name
    : isForeign
      ? 'Saved by collaborator'
      : undefined

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
                {isLoading ? (
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
                      <div className='flex w-full items-center justify-between gap-2'>
                        <div className='flex items-center gap-2'>
                          {getProviderIcon(cred.provider)}
                          <span className='font-normal'>{cred.name}</span>
                        </div>
                        <div className='flex items-center gap-2'>
                          {cred.requiresReauthorization && (
                            <span className='rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900'>
                              Update
                            </span>
                          )}
                          {cred.id === selectedId && <Check className='h-4 w-4' />}
                        </div>
                      </div>
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

      {requiresReauthorization && (
        <div className='mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div className='flex items-start gap-2'>
              <AlertTriangle className='mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500' />
              <div className='space-y-1'>
                <p className='font-medium text-sm'>More permissions needed</p>
                <p className='text-xs'>
                  Re-authorize this connection to continue using {getProviderName(provider)} in this workflow.
                </p>
                {missingScopes.length > 0 && (
                  <p className='text-xs'>
                    Missing scopes: {missingScopes.join(', ')}
                  </p>
                )}
                {missingScopes.length === 0 && extraScopes.length > 0 && (
                  <p className='text-xs'>
                    Scope changes detected: {extraScopes.join(', ')}
                  </p>
                )}
              </div>
            </div>
            <Button
              size='sm'
              variant='outline'
              onClick={handleAuthorize}
              disabled={isAuthorizing}
            >
              {isAuthorizing ? 'Authorizing...' : 'Authorize'}
            </Button>
          </div>
        </div>
      )}

      {showOAuthModal && (
        <OAuthRequiredModal
          isOpen={showOAuthModal}
          onClose={() => setShowOAuthModal(false)}
          provider={provider}
          toolName={getProviderName(provider)}
          requiredScopes={requiredScopes}
          serviceId={effectiveServiceId}
        />
      )}
    </>
  )
}
