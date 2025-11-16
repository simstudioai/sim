'use client'

import { useEffect, useMemo, useState } from 'react'
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
  const [selectedId, setSelectedId] = useState('')
  const [inputValue, setInputValue] = useState('')
  const { activeWorkflowId } = useWorkflowRegistry()

  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)

  const provider = subBlock.provider as OAuthProvider
  const requiredScopes = subBlock.requiredScopes || []
  const label = subBlock.placeholder || 'Select credential'
  const serviceId = subBlock.serviceId

  const effectiveValue = isPreview && previewValue !== undefined ? previewValue : storeValue

  useEffect(() => {
    setSelectedId(effectiveValue || '')
  }, [effectiveValue])

  const effectiveServiceId = useMemo(() => {
    return serviceId || getServiceIdFromScopes(provider, requiredScopes)
  }, [provider, requiredScopes, serviceId])

  const effectiveProviderId = useMemo(() => {
    return getProviderIdFromServiceId(effectiveServiceId)
  }, [effectiveServiceId])

  const {
    data: credentials = [],
    isFetching: credentialsLoading,
    refetch: refetchCredentials,
  } = useOAuthCredentials(effectiveProviderId, Boolean(effectiveProviderId))

  const selectedCredential = credentials.find((cred) => cred.id === selectedId)

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

  useEffect(() => {
    if (!isPreview && selectedId && !selectedCredential && !hasForeignMeta && !credentialsLoading) {
      logger.info('Clearing invalid credential selection - credential was disconnected', {
        selectedId,
        provider: effectiveProviderId,
      })
      setStoreValue('')
      setSelectedId('')
    }
  }, [
    isPreview,
    selectedId,
    selectedCredential,
    hasForeignMeta,
    credentialsLoading,
    effectiveProviderId,
    setStoreValue,
  ])

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

  useEffect(() => {
    const handlePageShow = (event: any) => {
      if (event?.persisted) {
        void refetchCredentials()
      }
    }
    window.addEventListener('pageshow', handlePageShow)
    return () => {
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [refetchCredentials])

  useEffect(() => {
    const handleCredentialDisconnected = (event: Event) => {
      const customEvent = event as CustomEvent
      const { providerId } = customEvent.detail
      if (providerId && (providerId === effectiveProviderId || providerId.startsWith(provider))) {
        void refetchCredentials()
      }
    }

    window.addEventListener('credential-disconnected', handleCredentialDisconnected)

    return () => {
      window.removeEventListener('credential-disconnected', handleCredentialDisconnected)
    }
  }, [refetchCredentials, effectiveProviderId, provider])

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      void refetchCredentials()
    }
  }

  const isForeign = !!(selectedId && !selectedCredential && hasForeignMeta)

  const displayName = selectedCredential
    ? selectedCredential.name
    : isForeign
      ? 'Saved by collaborator'
      : undefined

  useEffect(() => {
    if (displayName) {
      setInputValue(displayName)
    } else {
      setInputValue('')
    }
  }, [displayName])

  const hasSelection = !!selectedCredential
  const missingRequiredScopes = hasSelection
    ? getMissingRequiredScopes(selectedCredential, requiredScopes || [])
    : []
  const needsUpdate =
    hasSelection &&
    missingRequiredScopes.length > 0 &&
    !disabled &&
    !isPreview &&
    !credentialsLoading

  const handleSelect = (credentialId: string) => {
    setSelectedId(credentialId)
    if (!isPreview) {
      setStoreValue(credentialId)
    }
  }

  const handleAddCredential = () => {
    setShowOAuthModal(true)
  }

  const getProviderIcon = (providerName: OAuthProvider) => {
    const { baseProvider } = parseProvider(providerName)
    const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

    if (!baseProviderConfig) {
      return <ExternalLink className='h-3 w-3' />
    }
    return baseProviderConfig.icon({ className: 'h-3 w-3' })
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

  const selectedCredentialProvider = useMemo(() => {
    if (!selectedId || !selectedCredential) return provider
    return selectedCredential.provider
  }, [selectedId, selectedCredential, provider])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue, selectedCredentialProvider])

  const handleComboboxChange = (value: string) => {
    if (value === '__connect_account__') {
      handleAddCredential()
      return
    }

    const matchedCred = credentials.find((c) => c.id === value)
    if (matchedCred) {
      setInputValue(matchedCred.name)
      handleSelect(value)
    } else {
      setInputValue(value)
    }
  }

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
