import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ExternalLink, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createLogger } from '@/lib/logs/console/logger'
import { client } from '@/lib/auth-client'
import {
  type Credential,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  type OAuthService,
  parseProvider,
} from '@/lib/oauth'
import { OAuthRequiredModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/credential-selector/components/oauth-required-modal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('ToolCredentialSelector')

// Helper functions for provider icons and names
const getProviderIcon = (providerName: OAuthProvider) => {
  const { baseProvider } = parseProvider(providerName)
  const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

  if (!baseProviderConfig) {
    return <ExternalLink className='h-4 w-4' />
  }
  return baseProviderConfig.icon({ className: 'h-4 w-4' })
}

const getProviderName = (providerName: OAuthProvider) => {
  const { baseProvider } = parseProvider(providerName)
  const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

  if (baseProviderConfig) {
    return baseProviderConfig.name
  }

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
  const [isAuthorizing, setIsAuthorizing] = useState(false)
  const { activeWorkflowId } = useWorkflowRegistry()

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

        if (
          value &&
          !(data.credentials || []).some((cred: Credential) => cred.id === value) &&
          activeWorkflowId
        ) {
          try {
            const metaResp = await fetch(
              `/api/auth/oauth/credentials?credentialId=${value}&workflowId=${activeWorkflowId}`
            )
            if (metaResp.ok) {
              const meta = await metaResp.json()
              if (meta.credentials?.length) {
                setCredentials([meta.credentials[0], ...(data.credentials || [])])
              }
            }
          } catch {
            // ignore
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
    fetchCredentials()
  }

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen) {
      fetchCredentials()
    }
  }

  const selectedCredential = useMemo(
    () => credentials.find((cred) => cred.id === selectedId),
    [credentials, selectedId]
  )
  const isForeign = !!(selectedId && !selectedCredential)

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
              {getProviderIcon(provider)}
              <span
                className={
                  selectedCredential ? 'truncate font-normal' : 'truncate text-muted-foreground'
                }
              >
                {selectedCredential
                  ? selectedCredential.name
                  : isForeign
                    ? 'Saved by collaborator'
                    : label}
              </span>
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
                      <div className='flex w-full items-center justify-between gap-2'>
                        <div className='flex items-center gap-2'>
                          {getProviderIcon(credential.provider)}
                          <span className='font-normal'>{credential.name}</span>
                        </div>
                        <div className='flex items-center gap-2'>
                          {credential.requiresReauthorization && (
                            <span className='rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900'>
                              Update
                            </span>
                          )}
                          {credential.id === selectedId && <Check className='h-4 w-4' />}
                        </div>
                      </div>
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

      {requiresReauthorization && (
        <div className='mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div className='flex items-start gap-2'>
              <AlertTriangle className='mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500' />
              <div className='space-y-1'>
                <p className='font-medium text-sm'>More permissions needed</p>
                <p className='text-xs'>
                  Re-authorize this connection to unlock the latest features for {getProviderName(provider)}.
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
