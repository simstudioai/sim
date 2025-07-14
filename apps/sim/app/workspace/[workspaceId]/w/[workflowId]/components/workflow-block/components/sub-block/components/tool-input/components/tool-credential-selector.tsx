import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, ExternalLink, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createLogger } from '@/lib/logs/console-logger'
import {
  type Credential,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  type OAuthService,
  parseProvider,
} from '@/lib/oauth'
import { OAuthRequiredModal } from '../../credential-selector/components/oauth-required-modal'

const logger = createLogger('ToolCredentialSelector')

// Helper functions for provider icons and names
const getProviderIcon = (providerName: OAuthProvider) => {
  const { baseProvider } = parseProvider(providerName)
  const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

  if (!baseProviderConfig) {
    return <ExternalLink className='h-4 w-4' />
  }
  // Always use the base provider icon for a more consistent UI
  return baseProviderConfig.icon({ className: 'h-4 w-4' })
}

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

interface ToolCredentialSelectorProps {
  value: string
  onChange: (value: string) => void
  provider: OAuthProvider
  requiredScopes?: string[]
  label?: string
  serviceId?: OAuthService
  disabled?: boolean
}

export function ToolCredentialSelector({
  value,
  onChange,
  provider,
  requiredScopes = [],
  label = 'Select account',
  serviceId,
  disabled = false,
}: ToolCredentialSelectorProps) {
  const [open, setOpen] = useState(false)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [selectedId, setSelectedId] = useState('')

  // Update selected ID when value changes
  useEffect(() => {
    setSelectedId(value)
  }, [value])

  const fetchCredentials = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/auth/oauth/credentials?provider=${provider}`)
      if (response.ok) {
        const data = await response.json()
        setCredentials(data.credentials || [])

        // If we have a value but it's not in the credentials, reset it
        if (value && !data.credentials?.some((cred: Credential) => cred.id === value)) {
          onChange('')
        }

        // Auto-selection logic (like credential-selector):
        // 1. If we already have a valid selection, keep it
        // 2. If there's a default credential, select it
        // 3. If there's only one credential, select it
        if (
          (!value || !data.credentials?.some((cred: Credential) => cred.id === value)) &&
          data.credentials &&
          data.credentials.length > 0
        ) {
          const defaultCred = data.credentials.find((cred: Credential) => cred.isDefault)
          if (defaultCred) {
            onChange(defaultCred.id)
          } else if (data.credentials.length === 1) {
            // If only one credential, select it
            onChange(data.credentials[0].id)
          }
        }
      } else {
        logger.error('Error fetching credentials:', { error: await response.text() })
        setCredentials([])
      }
    } catch (error) {
      logger.error('Error fetching credentials:', { error })
      setCredentials([])
    } finally {
      setIsLoading(false)
    }
  }, [provider, value, onChange])

  // Fetch credentials on initial mount only
  useEffect(() => {
    fetchCredentials()
    // This effect should only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const handleSelect = (credentialId: string) => {
    setSelectedId(credentialId)
    onChange(credentialId)
    setOpen(false)
  }

  const handleOAuthClose = () => {
    setShowOAuthModal(false)
    // Refetch credentials to include any new ones
    fetchCredentials()
  }

  // Handle popover open to fetch fresh credentials
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen) {
      // Fetch fresh credentials when opening the dropdown
      fetchCredentials()
    }
  }

  const selectedCredential = credentials.find((cred) => cred.id === selectedId)

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant='outline'
            role='combobox'
            aria-expanded={open}
            className='h-10 w-full min-w-0 justify-between'
            disabled={disabled}
          >
            <div className='flex min-w-0 items-center gap-2 overflow-hidden'>
              {selectedCredential ? (
                <>
                  {getProviderIcon(provider)}
                  <span className='truncate font-normal'>{selectedCredential.name}</span>
                </>
              ) : (
                <>
                  {getProviderIcon(provider)}
                  <span className='truncate text-muted-foreground'>{label}</span>
                </>
              )}
            </div>
            <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-[300px] p-0' align='start'>
          <Command>
            <CommandList>
              <CommandEmpty>
                {isLoading ? (
                  <div className='flex items-center justify-center p-4'>
                    <RefreshCw className='h-4 w-4 animate-spin' />
                    <span className='ml-2'>Loading...</span>
                  </div>
                ) : credentials.length === 0 ? (
                  <div className='p-4 text-center'>
                    <p className='font-medium text-sm'>No accounts connected.</p>
                    <p className='text-muted-foreground text-xs'>
                      Connect a {getProviderName(provider)} account to continue.
                    </p>
                  </div>
                ) : (
                  <div className='p-4 text-center'>
                    <p className='font-medium text-sm'>No accounts found.</p>
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
                      <div className='flex items-center gap-2'>
                        {getProviderIcon(credential.provider)}
                        <span className='font-normal'>{credential.name}</span>
                      </div>
                      {credential.id === selectedId && <Check className='ml-auto h-4 w-4' />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              <CommandGroup>
                <CommandItem onSelect={() => setShowOAuthModal(true)}>
                  <div className='flex items-center gap-2'>
                    <Plus className='h-4 w-4' />
                    <span className='font-normal'>Connect {getProviderName(provider)} account</span>
                  </div>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <OAuthRequiredModal
        isOpen={showOAuthModal}
        onClose={handleOAuthClose}
        provider={provider}
        toolName={label}
        requiredScopes={requiredScopes}
        serviceId={serviceId}
      />
    </>
  )
}
