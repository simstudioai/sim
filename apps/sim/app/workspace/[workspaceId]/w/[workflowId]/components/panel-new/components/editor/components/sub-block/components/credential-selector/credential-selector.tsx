'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Button, Combobox } from '@/components/emcn/components'
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
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const { activeWorkflowId } = useWorkflowRegistry()
  const [storeValue, setStoreValue] = useSubBlockValue<string | null>(blockId, subBlock.id)

  const provider = subBlock.provider as OAuthProvider
  const requiredScopes = subBlock.requiredScopes || []
  const label = subBlock.placeholder || 'Select credential'
  const serviceId = subBlock.serviceId

  const effectiveValue = isPreview && previewValue !== undefined ? previewValue : storeValue
  const selectedId = typeof effectiveValue === 'string' ? effectiveValue : ''

  const effectiveServiceId = useMemo(
    () => serviceId || getServiceIdFromScopes(provider, requiredScopes),
    [provider, requiredScopes, serviceId]
  )

  const effectiveProviderId = useMemo(
    () => getProviderIdFromServiceId(effectiveServiceId),
    [effectiveServiceId]
  )

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
    if (isForeign) return 'Saved by collaborator'
    return ''
  }, [selectedCredential, isForeign])

  useEffect(() => {
    if (!isEditing) {
      setInputValue(resolvedLabel)
    }
  }, [resolvedLabel, isEditing])

  const invalidSelection =
    !isPreview &&
    Boolean(selectedId) &&
    !selectedCredential &&
    !hasForeignMeta &&
    !credentialsLoading &&
    !foreignMetaLoading

  useEffect(() => {
    if (!invalidSelection) return
    logger.info('Clearing invalid credential selection - credential was disconnected', {
      selectedId,
      provider: effectiveProviderId,
    })
    setStoreValue('')
  }, [invalidSelection, selectedId, effectiveProviderId, setStoreValue])

  useCredentialRefreshTriggers(refetchCredentials, effectiveProviderId, provider)

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
    hasSelection &&
    missingRequiredScopes.length > 0 &&
    !disabled &&
    !isPreview &&
    !credentialsLoading

  const handleSelect = useCallback(
    (credentialId: string) => {
      if (isPreview) return
      setStoreValue(credentialId)
      setIsEditing(false)
    },
    [isPreview, setStoreValue]
  )

  const handleAddCredential = useCallback(() => {
    setShowOAuthModal(true)
  }, [])

  const getProviderIcon = useCallback((providerName: OAuthProvider) => {
    const { baseProvider } = parseProvider(providerName)
    const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

    if (!baseProviderConfig) {
      return <ExternalLink className='h-3 w-3' />
    }
    return baseProviderConfig.icon({ className: 'h-3 w-3' })
  }, [])

  const getProviderName = useCallback((providerName: OAuthProvider) => {
    const { baseProvider } = parseProvider(providerName)
    const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

    if (baseProviderConfig) {
      return baseProviderConfig.name
    }

    return providerName
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
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
  }, [credentials, provider, getProviderName])

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
  }, [getProviderIcon, inputValue, selectedCredentialProvider])

  const handleComboboxChange = useCallback(
    (value: string) => {
      if (value === '__connect_account__') {
        handleAddCredential()
        return
      }

      const matchedCred = credentials.find((c) => c.id === value)
      if (matchedCred) {
        setInputValue(matchedCred.name)
        handleSelect(value)
        return
      }

      setIsEditing(true)
      setInputValue(value)
    },
    [credentials, handleAddCredential, handleSelect]
  )

  return (
    <>
      <Combobox
        options={comboboxOptions}
        value={inputValue}
        selectedValue={selectedId}
        onChange={handleComboboxChange}
        onOpenChange={handleOpenChange}
        placeholder={label}
        disabled={disabled}
        editable={true}
        filterOptions={true}
        isLoading={credentialsLoading}
        overlayContent={overlayContent}
        className={selectedId ? 'pl-[28px]' : ''}
      />

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

function useCredentialRefreshTriggers(
  refetchCredentials: () => Promise<unknown>,
  effectiveProviderId?: string,
  provider?: OAuthProvider
) {
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

    const handleCredentialDisconnected = (event: Event) => {
      const customEvent = event as CustomEvent<{ providerId?: string }>
      const providerId = customEvent.detail?.providerId

      if (
        providerId &&
        (providerId === effectiveProviderId || (provider && providerId.startsWith(provider)))
      ) {
        refresh()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', handlePageShow)
    window.addEventListener('credential-disconnected', handleCredentialDisconnected)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener('credential-disconnected', handleCredentialDisconnected)
    }
  }, [refetchCredentials, effectiveProviderId, provider])
}
