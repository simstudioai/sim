'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ExternalLink, Key, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { OAuthRequiredModal } from '@/components/ui/oauth-required-modal'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { client } from '@/lib/auth-client'
import {
  Credential,
  OAUTH_PROVIDERS,
  OAuthProvider,
  getProviderIdFromServiceId,
  getServiceByProviderAndId,
  getServiceIdFromScopes,
} from '@/lib/oauth'
import { saveToStorage } from '@/stores/workflows/persistence'

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
  const initialFetchRef = useRef(false)

  // Determine the appropriate service ID based on provider and scopes
  const getServiceId = (): string => {
    if (serviceId) return serviceId
    return getServiceIdFromScopes(provider, requiredScopes)
  }

  // Determine the appropriate provider ID based on service and scopes
  const getProviderId = (): string => {
    const effectiveServiceId = getServiceId()
    return getProviderIdFromServiceId(effectiveServiceId)
  }

  // Fetch available credentials for this provider
  const fetchCredentials = useCallback(async () => {
    setIsLoading(true)
    try {
      const providerId = getProviderId()

      const response = await fetch(`/api/auth/oauth/credentials?provider=${providerId}`)
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
      console.error('Error fetching credentials:', error)
    } finally {
      setIsLoading(false)
    }
  }, [provider, onChange, selectedId])

  // Fetch credentials on initial mount and when dependencies change
  useEffect(() => {
    if (!initialFetchRef.current) {
      fetchCredentials()
      initialFetchRef.current = true
    }
  }, [fetchCredentials])

  // Also fetch credentials when opening the popover
  useEffect(() => {
    if (open) {
      fetchCredentials()
    }
  }, [open, fetchCredentials])

  // Update local state when external value changes
  useEffect(() => {
    setSelectedId(value)
  }, [value])

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
    const effectiveServiceId = getServiceId()
    const providerId = getProviderId()

    // Store information about the required connection
    saveToStorage<string>('pending_service_id', effectiveServiceId)
    saveToStorage<string[]>('pending_oauth_scopes', requiredScopes)
    saveToStorage<string>('pending_oauth_return_url', window.location.href)
    saveToStorage<string>('pending_oauth_provider_id', providerId)

    // Show the OAuth modal
    setShowOAuthModal(true)
    setOpen(false)
  }

  // Handle direct OAuth flow
  const handleDirectOAuth = async () => {
    try {
      const providerId = getProviderId()

      // Begin OAuth flow with the appropriate provider
      await client.signIn.oauth2({
        providerId,
        callbackURL: window.location.href,
      })
    } catch (error) {
      console.error('OAuth login error:', error)
    }
  }

  // Get provider icon
  const getProviderIcon = (providerName: OAuthProvider) => {
    const providerConfig = OAUTH_PROVIDERS[providerName]
    if (providerConfig) {
      return providerConfig.icon({ className: 'h-4 w-4' })
    }
    return <ExternalLink className="h-4 w-4" />
  }

  // Get provider name
  const getProviderName = (providerName: OAuthProvider) => {
    const effectiveServiceId = getServiceId()
    try {
      const service = getServiceByProviderAndId(providerName, effectiveServiceId)
      return service.name
    } catch (error) {
      // Fallback to provider name if service not found
      const providerConfig = OAUTH_PROVIDERS[providerName]
      if (providerConfig) {
        return providerConfig.name
      }
      return providerName
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
            disabled={disabled}
          >
            {selectedCredential ? (
              <div className="flex items-center gap-2">
                {getProviderIcon(provider)}
                <span>{selectedCredential.name}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4" />
                <span>{label}</span>
              </div>
            )}
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0" align="start">
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
                    <p className="text-sm">No credentials found.</p>
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
                        <span>{cred.name}</span>
                      </div>
                      {cred.id === selectedId && <Check className="ml-auto h-4 w-4" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <CommandGroup>
                <CommandItem onSelect={handleAddCredential}>
                  <div className="flex items-center gap-2 text-primary">
                    <ExternalLink className="h-4 w-4" />
                    <span>Connect {getProviderName(provider)} account</span>
                  </div>
                </CommandItem>
              </CommandGroup>
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
          serviceId={getServiceId()}
        />
      )}
    </>
  )
}
