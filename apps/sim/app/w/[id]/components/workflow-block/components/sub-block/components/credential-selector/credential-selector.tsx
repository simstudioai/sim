'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ExternalLink, RefreshCw } from 'lucide-react'
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
import { createLogger } from '@/lib/logs/console-logger'
import {
  Credential,
  getProviderIdFromServiceId,
  getServiceIdFromScopes,
  OAUTH_PROVIDERS,
  OAuthProvider,
  parseProvider,
} from '@/lib/oauth'
import { saveToStorage } from '@/stores/workflows/persistence'
import { OAuthRequiredModal } from './components/oauth-required-modal'

const logger = createLogger('CredentialSelector')

interface CredentialSelectorProps {
  value: string
  onChange: (value: string) => void
  provider: OAuthProvider
  requiredScopes?: string[]
  label?: string
  disabled?: boolean
  serviceId?: string
}

export function CredentialSelector({
  value,
  onChange,
  provider,
  requiredScopes = [],
  label = 'Select credential',
  disabled = false,
  serviceId,
}: CredentialSelectorProps) {
  const [open, setOpen] = useState(false)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [selectedId, setSelectedId] = useState(value)

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
        setCredentials(data.credentials)

        // If we have a value but it's not in the credentials, reset it
        if (selectedId && !data.credentials.some((cred: Credential) => cred.id === selectedId)) {
          setSelectedId('')
          onChange('')
        }

        // Auto-select logic:
        // 1. If we already have a valid selection, keep it
        // 2. If there's a default credential, select it
        // 3. If there's only one credential, select it
        if (
          (!selectedId || !data.credentials.some((cred: Credential) => cred.id === selectedId)) &&
          data.credentials.length > 0
        ) {
          const defaultCred = data.credentials.find((cred: Credential) => cred.isDefault)
          if (defaultCred) {
            setSelectedId(defaultCred.id)
            onChange(defaultCred.id)
          } else if (data.credentials.length === 1) {
            // If only one credential, select it
            setSelectedId(data.credentials[0].id)
            onChange(data.credentials[0].id)
          }
        }
      }
    } catch (error) {
      logger.error('Error fetching credentials:', { error })
    } finally {
      setIsLoading(false)
    }
  }, [effectiveProviderId, onChange, selectedId])

  // Fetch credentials on initial mount
  useEffect(() => {
    fetchCredentials()
    // This effect should only run once on mount, so empty dependency array
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update local state when external value changes
  useEffect(() => {
    setSelectedId(value)
  }, [value])

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

  // Handle popover open to fetch fresh credentials
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen) {
      // Fetch fresh credentials when opening the dropdown
      fetchCredentials()
    }
  }

  // Get the selected credential
  const selectedCredential = credentials.find((cred) => cred.id === selectedId)

  // Handle selection
  const handleSelect = (credentialId: string) => {
    setSelectedId(credentialId)
    onChange(credentialId)
    setOpen(false)
  }

  // Handle adding a new credential
  const handleAddCredential = () => {
    // Store information about the required connection
    saveToStorage<string>('pending_service_id', effectiveServiceId)
    saveToStorage<string[]>('pending_oauth_scopes', requiredScopes)
    saveToStorage<string>('pending_oauth_return_url', window.location.href)
    saveToStorage<string>('pending_oauth_provider_id', effectiveProviderId)

    // Show the OAuth modal
    setShowOAuthModal(true)
    setOpen(false)
  }

  // Get provider icon
  const getProviderIcon = (providerName: OAuthProvider) => {
    const { baseProvider } = parseProvider(providerName)
    const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

    if (!baseProviderConfig) {
      return <ExternalLink className="h-4 w-4" />
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
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between relative"
            disabled={disabled}
          >
            <div className="flex items-center gap-2 max-w-[calc(100%-20px)] overflow-hidden">
              {getProviderIcon(provider)}
              {selectedCredential ? (
                <span className="font-normal truncate">{selectedCredential.name}</span>
              ) : (
                <span className="text-muted-foreground truncate">{label}</span>
              )}
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50 absolute right-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[250px]" align="start">
          <Command>
            <CommandInput placeholder="Search credentials..." />
            <CommandList>
              <CommandEmpty>
                {isLoading ? (
                  <div className="flex items-center justify-center p-4">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span className="ml-2">Loading credentials...</span>
                  </div>
                ) : (
                  <div className="p-4 text-center">
                    <p className="text-sm font-medium">No credentials found.</p>
                    <p className="text-xs text-muted-foreground">
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
                      <div className="flex items-center gap-2">
                        {getProviderIcon(cred.provider)}
                        <span className="font-normal">{cred.name}</span>
                      </div>
                      {cred.id === selectedId && <Check className="ml-auto h-4 w-4" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {credentials.length === 0 && (
                <CommandGroup>
                  <CommandItem onSelect={handleAddCredential}>
                    <div className="flex items-center gap-2 text-primary">
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
