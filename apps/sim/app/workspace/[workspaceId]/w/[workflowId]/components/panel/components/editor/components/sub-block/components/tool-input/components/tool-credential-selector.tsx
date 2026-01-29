import { createElement, useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Button, Combobox } from '@/components/emcn/components'
import {
  getCanonicalScopesForProvider,
  getProviderIdFromServiceId,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  type OAuthService,
  parseProvider,
} from '@/lib/oauth'
import { OAuthRequiredModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/credential-selector/components/oauth-required-modal'
import { CREDENTIAL } from '@/executor/constants'
import { useOAuthCredentialDetail, useOAuthCredentials } from '@/hooks/queries/oauth-credentials'
import { getMissingRequiredScopes } from '@/hooks/use-oauth-scope-status'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const getProviderIcon = (providerName: OAuthProvider) => {
  const { baseProvider } = parseProvider(providerName)
  const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

  if (!baseProviderConfig) {
    return <ExternalLink className='h-3 w-3' />
  }
  return createElement(baseProviderConfig.icon, { className: 'h-3 w-3' })
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
  serviceId: OAuthService
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
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const { activeWorkflowId } = useWorkflowRegistry()

  const selectedId = value || ''

  const effectiveProviderId = useMemo(() => getProviderIdFromServiceId(serviceId), [serviceId])

  const {
    data: credentials = [],
    isFetching: credentialsLoading,
    refetch: refetchCredentials,
  } = useOAuthCredentials(effectiveProviderId, Boolean(effectiveProviderId))

  const selectedCredential = useMemo(
    () => credentials.find((cred) => cred.id === selectedId),
    [credentials, selectedId]
  )

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
  const isForeign = Boolean(selectedId && !selectedCredential && hasForeignMeta)

  const resolvedLabel = useMemo(() => {
    if (selectedCredential) return selectedCredential.name
    if (isForeign) return CREDENTIAL.FOREIGN_LABEL
    return ''
  }, [selectedCredential, isForeign])

  useEffect(() => {
    if (!isEditing) {
      setInputValue(resolvedLabel)
    }
  }, [resolvedLabel, isEditing])

  const invalidSelection =
    Boolean(selectedId) &&
    !selectedCredential &&
    !hasForeignMeta &&
    !credentialsLoading &&
    !foreignMetaLoading

  useEffect(() => {
    if (!invalidSelection) return
    onChange('')
  }, [invalidSelection, onChange])

  useCredentialRefreshTriggers(refetchCredentials)

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        void refetchCredentials()
      }
    },
    [refetchCredentials]
  )

  const hasSelection = Boolean(selectedCredential)
  const missingRequiredScopes = hasSelection
    ? getMissingRequiredScopes(selectedCredential!, requiredScopes || [])
    : []

  const needsUpdate =
    hasSelection && missingRequiredScopes.length > 0 && !disabled && !credentialsLoading

  const handleSelect = useCallback(
    (credentialId: string) => {
      onChange(credentialId)
      setIsEditing(false)
    },
    [onChange]
  )

  const handleAddCredential = useCallback(() => {
    setShowOAuthModal(true)
  }, [])

  const comboboxOptions = useMemo(() => {
    const options = credentials.map((cred) => ({
      label: cred.name,
      value: cred.id,
    }))

    if (credentials.length === 0) {
      options.push({
        label: `Connect ${getProviderName(provider)} account`,
        value: '__connect_account__',
      })
    }

    return options
  }, [credentials, provider])

  const selectedCredentialProvider = selectedCredential?.provider ?? provider

  const overlayContent = useMemo(() => {
    if (!inputValue) return null

    return (
      <div className='flex w-full items-center truncate'>
        <div className='mr-2 flex-shrink-0 opacity-90'>
          {getProviderIcon(selectedCredentialProvider)}
        </div>
        <span className='truncate'>{inputValue}</span>
      </div>
    )
  }, [inputValue, selectedCredentialProvider])

  const handleComboboxChange = useCallback(
    (newValue: string) => {
      if (newValue === '__connect_account__') {
        handleAddCredential()
        return
      }

      const matchedCred = credentials.find((c) => c.id === newValue)
      if (matchedCred) {
        setInputValue(matchedCred.name)
        handleSelect(newValue)
        return
      }

      setIsEditing(true)
      setInputValue(newValue)
    },
    [credentials, handleAddCredential, handleSelect]
  )

  return (
    <div>
      <Combobox
        options={comboboxOptions}
        value={inputValue}
        selectedValue={selectedId}
        onChange={handleComboboxChange}
        onOpenChange={handleOpenChange}
        placeholder={label}
        disabled={disabled}
        editable={true}
        filterOptions={!isForeign}
        isLoading={credentialsLoading}
        overlayContent={overlayContent}
        className={selectedId ? 'pl-[28px]' : ''}
      />

      {needsUpdate && (
        <div className='mt-[8px] flex flex-col gap-[4px] rounded-[4px] border bg-[var(--surface-2)] px-[8px] py-[6px]'>
          <div className='flex items-center font-medium text-[12px]'>
            <span className='mr-[6px] inline-block h-[6px] w-[6px] rounded-[2px] bg-amber-500' />
            Additional permissions required
          </div>
          {!isForeign && (
            <Button
              variant='active'
              onClick={() => setShowOAuthModal(true)}
              className='w-full px-[8px] py-[4px] font-medium text-[12px]'
            >
              Update access
            </Button>
          )}
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
          serviceId={serviceId}
        />
      )}
    </div>
  )
}

function useCredentialRefreshTriggers(refetchCredentials: () => Promise<unknown>) {
  useEffect(() => {
    const refresh = () => {
      void refetchCredentials()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }

    const handlePageShow = (event: Event) => {
      if ('persisted' in event && (event as PageTransitionEvent).persisted) {
        refresh()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [refetchCredentials])
}
