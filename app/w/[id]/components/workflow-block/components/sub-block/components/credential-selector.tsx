'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ExternalLink, Key, RefreshCw } from 'lucide-react'
import { GoogleIcon } from '@/components/icons'
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
import { saveToStorage } from '@/stores/workflows/persistence'
import { OAuthProvider } from '@/tools/types'

interface CredentialSelectorProps {
  value: string
  onChange: (value: string) => void
  provider: OAuthProvider
  requiredScopes?: string[]
  label?: string
  disabled?: boolean
  serviceId?: string
}

interface Credential {
  id: string
  name: string
  provider: OAuthProvider
  lastUsed?: string
  isDefault?: boolean
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

  // Fetch available credentials for this provider
  const fetchCredentials = useCallback(async () => {
    if (!open) return
    setIsLoading(true)
    try {
      const response = await fetch(`/api/auth/oauth/credentials?provider=${provider}`)
      if (response.ok) {
        const data = await response.json()
        setCredentials(data.credentials)

        // If we have a value but it's not in the credentials, reset it
        if (selectedId && !data.credentials.some((cred: Credential) => cred.id === selectedId)) {
          setSelectedId('')
          onChange('')
        }

        // If we have no value but have a default credential, select it
        if (!selectedId && data.credentials.length > 0) {
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
  }, [open, provider, onChange, selectedId])

  // Only fetch credentials when opening the popover
  useEffect(() => {
    fetchCredentials()
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

  // Determine the appropriate service ID based on provider and scopes
  const getServiceId = (): string => {
    if (serviceId) return serviceId

    if (provider === 'google') {
      if (requiredScopes.some((scope) => scope.includes('gmail') || scope.includes('mail'))) {
        return 'gmail'
      } else if (requiredScopes.some((scope) => scope.includes('drive'))) {
        return 'google-drive'
      } else if (requiredScopes.some((scope) => scope.includes('calendar'))) {
        return 'google-calendar'
      } else {
        return 'gmail' // Default Google service
      }
    } else if (provider === 'github') {
      return 'github'
    } else if (provider === 'twitter') {
      return 'twitter'
    }

    return provider
  }

  // Determine the appropriate provider ID based on service and scopes
  const getProviderId = (): string => {
    const effectiveServiceId = getServiceId()

    switch (effectiveServiceId) {
      case 'gmail':
        return 'google-email'
      case 'google-drive':
        return 'google-drive'
      case 'google-calendar':
        return 'google-calendar'
      case 'github':
        if (requiredScopes.some((scope) => scope.includes('workflow'))) {
          return 'github-workflow'
        }
        return 'github-repo'
      case 'twitter':
        if (requiredScopes.some((scope) => scope.includes('write'))) {
          return 'twitter-write'
        }
        return 'twitter-read'
      default:
        return `${provider}-default`
    }
  }

  // Handle adding a new credential
  const handleAddCredential = () => {
    const effectiveServiceId = getServiceId()
    const providerId = getProviderId()

    // Store information about the required connection
    saveToStorage('pending_service_id', effectiveServiceId)
    saveToStorage('pending_oauth_scopes', requiredScopes)
    saveToStorage('pending_oauth_return_url', window.location.href)
    saveToStorage('pending_oauth_provider_id', providerId)

    // Show the OAuth modal
    setShowOAuthModal(true)
    setOpen(false)
  }

  // Get provider icon
  const getProviderIcon = (provider: OAuthProvider) => {
    switch (provider) {
      case 'google':
        return <GoogleIcon className="h-4 w-4" />
      default:
        return <ExternalLink className="h-4 w-4" />
    }
  }

  // Get provider name
  const getProviderName = (provider: OAuthProvider) => {
    switch (provider) {
      case 'google':
        return 'Google'
      case 'github':
        return 'GitHub'
      case 'twitter':
        return 'X (Twitter)'
      default:
        return provider
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
              <div className="flex items-center gap-2 text-muted-foreground">
                <Key className="h-4 w-4" />
                <span>{label}</span>
              </div>
            )}
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[250px] p-0">
          <Command>
            <CommandInput placeholder={`Search ${getProviderName(provider)} credentials...`} />
            <CommandList>
              <CommandEmpty>
                {isLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  </div>
                ) : (
                  <div className="py-6 text-center">
                    <p className="text-sm text-muted-foreground">No credentials found</p>
                  </div>
                )}
              </CommandEmpty>
              {credentials.length > 0 && (
                <CommandGroup>
                  {credentials.map((credential) => (
                    <CommandItem
                      key={credential.id}
                      value={credential.id}
                      onSelect={() => handleSelect(credential.id)}
                    >
                      <div className="flex items-center gap-2">
                        {getProviderIcon(credential.provider)}
                        <span>{credential.name}</span>
                      </div>
                      {credential.id === selectedId && <Check className="ml-auto h-4 w-4" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <div className="p-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleAddCredential}
                >
                  <span>Add New Credential</span>
                </Button>
              </div>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <OAuthRequiredModal
        isOpen={showOAuthModal}
        onClose={() => setShowOAuthModal(false)}
        provider={provider}
        toolName={`${getProviderName(provider)} Integration`}
        requiredScopes={requiredScopes}
        serviceId={getServiceId()}
      />
    </>
  )
}
