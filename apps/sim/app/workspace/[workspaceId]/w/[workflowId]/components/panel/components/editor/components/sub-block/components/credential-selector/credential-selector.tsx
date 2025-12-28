'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ExternalLink } from 'lucide-react'
import { Button, Combobox } from '@/components/emcn/components'
import {
  getCanonicalScopesForProvider,
  getProviderIdFromServiceId,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  parseProvider,
} from '@/lib/oauth'
import { OAuthRequiredModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/credential-selector/components/oauth-required-modal'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-depends-on-gate'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
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

  const requiredScopes = subBlock.requiredScopes || []
  const label = subBlock.placeholder || 'Select credential'
  const serviceId = subBlock.serviceId || ''

  const { depsSatisfied, dependsOn } = useDependsOnGate(blockId, subBlock, { disabled, isPreview })
  const hasDependencies = dependsOn.length > 0

  const effectiveDisabled = disabled || (hasDependencies && !depsSatisfied)

  const effectiveValue = isPreview && previewValue !== undefined ? previewValue : storeValue
  const selectedId = typeof effectiveValue === 'string' ? effectiveValue : ''

  const effectiveProviderId = useMemo(
    () => getProviderIdFromServiceId(serviceId) as OAuthProvider,
    [serviceId]
  )
  const provider = effectiveProviderId

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
    hasSelection &&
    missingRequiredScopes.length > 0 &&
    !effectiveDisabled &&
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
    <div>
      <Combobox
        options={comboboxOptions}
        value={inputValue}
        selectedValue={selectedId}
        onChange={handleComboboxChange}
        onOpenChange={handleOpenChange}
        placeholder={
          hasDependencies && !depsSatisfied ? 'Fill in required fields above first' : label
        }
        disabled={effectiveDisabled}
        editable={true}
        filterOptions={true}
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
