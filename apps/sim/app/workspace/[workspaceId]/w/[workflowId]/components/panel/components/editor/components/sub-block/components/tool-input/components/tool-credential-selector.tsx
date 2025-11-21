import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ExternalLink, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/emcn/components/button/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createLogger } from '@/lib/logs/console/logger'
import {
  getCanonicalScopesForProvider,
  getProviderIdFromServiceId,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  type OAuthService,
  parseProvider,
} from '@/lib/oauth'
import { OAuthRequiredModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/credential-selector/components/oauth-required-modal'
import { useOAuthCredentialDetail, useOAuthCredentials } from '@/hooks/queries/oauth-credentials'
import { getMissingRequiredScopes } from '@/hooks/use-oauth-scope-status'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('ToolCredentialSelector')

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
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const { activeWorkflowId } = useWorkflowRegistry()

  useEffect(() => {
    setSelectedId(value)
  }, [value])

  const {
    data: fetchedCredentials = [],
    isFetching: credentialsLoading,
    refetch: refetchCredentials,
  } = useOAuthCredentials(provider, true)

  const shouldFetchDetail =
    Boolean(value) &&
    !fetchedCredentials.some((cred) => cred.id === value) &&
    Boolean(activeWorkflowId)

  const { data: collaboratorCredentials = [], isFetching: collaboratorLoading } =
    useOAuthCredentialDetail(
      shouldFetchDetail ? value : undefined,
      activeWorkflowId || undefined,
      shouldFetchDetail
    )

  const credentials = useMemo(() => {
    if (collaboratorCredentials.length === 0) {
      return fetchedCredentials
    }
    const collaborator = collaboratorCredentials[0]
    if (!collaborator) {
      return fetchedCredentials
    }
    const alreadyIncluded = fetchedCredentials.some((cred) => cred.id === collaborator.id)
    if (alreadyIncluded) {
      return fetchedCredentials
    }
    return [collaborator, ...fetchedCredentials]
  }, [fetchedCredentials, collaboratorCredentials])

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

  const handleSelect = (credentialId: string) => {
    setSelectedId(credentialId)
    onChange(credentialId)
    setOpen(false)
  }

  const handleOAuthClose = () => {
    setShowOAuthModal(false)
    void refetchCredentials()
  }

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen) {
      void refetchCredentials()
    }
  }

  const selectedCredential = credentials.find((cred) => cred.id === selectedId)
  const isForeign = !!(selectedId && !selectedCredential)

  // Determine if additional permissions are required for the selected credential
  const hasSelection = !!selectedCredential
  const missingRequiredScopes = hasSelection
    ? getMissingRequiredScopes(selectedCredential, requiredScopes || [])
    : []
  const needsUpdate =
    hasSelection && missingRequiredScopes.length > 0 && !disabled && !credentialsLoading

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
                {credentialsLoading || collaboratorLoading ? (
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

      {needsUpdate && (
        <div className='mt-2 flex items-center justify-between rounded-[6px] border border-amber-300/40 bg-amber-50/60 px-2 py-1 font-medium text-[12px] transition-colors dark:bg-amber-950/10'>
          <span>Additional permissions required</span>
          {/* We don't have reliable foreign detection context here; always show CTA */}
          <Button onClick={() => setShowOAuthModal(true)}>Update access</Button>
        </div>
      )}

      <OAuthRequiredModal
        isOpen={showOAuthModal}
        onClose={handleOAuthClose}
        provider={provider}
        toolName={label}
        requiredScopes={getCanonicalScopesForProvider(
          serviceId ? getProviderIdFromServiceId(serviceId) : (provider as string)
        )}
        newScopes={missingRequiredScopes}
        serviceId={serviceId}
      />
    </>
  )
}
