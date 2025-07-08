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

        // If we have a selected value but it's not in the credentials list, clear it
        if (value && !data.credentials?.some((cred: Credential) => cred.id === value)) {
          onChange('')
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

  // Fetch credentials on mount and when provider changes
  useEffect(() => {
    fetchCredentials()
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

  const selectedCredential = credentials.find((cred) => cred.id === selectedId)

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant='outline'
            role='combobox'
            aria-expanded={open}
            className='w-full justify-between'
            disabled={disabled}
          >
            {selectedCredential ? (
              <div className='flex items-center gap-2 overflow-hidden'>
                {getProviderIcon(provider)}
                <span className='truncate font-normal'>{selectedCredential.name}</span>
              </div>
            ) : (
              <div className='flex items-center gap-2'>
                {getProviderIcon(provider)}
                <span className='text-muted-foreground'>{label}</span>
              </div>
            )}
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
