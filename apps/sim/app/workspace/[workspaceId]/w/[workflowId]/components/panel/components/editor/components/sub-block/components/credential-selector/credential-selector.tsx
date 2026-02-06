'use client'

import { createElement, useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ExternalLink, Users } from 'lucide-react'
import { Button, Combobox } from '@/components/emcn/components'
import { getSubscriptionStatus } from '@/lib/billing/client'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { getPollingProviderFromOAuth } from '@/lib/credential-sets/providers'
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
import { CREDENTIAL, CREDENTIAL_SET } from '@/executor/constants'
import { useCredentialSets } from '@/hooks/queries/credential-sets'
import { useOAuthCredentialDetail, useOAuthCredentials } from '@/hooks/queries/oauth-credentials'
import { useOrganizations } from '@/hooks/queries/organization'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import { getMissingRequiredScopes } from '@/hooks/use-oauth-scope-status'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('CredentialSelector')
const isBillingEnabled = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))

interface CredentialSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: any | null
  previewContextValues?: Record<string, unknown>
}

export function CredentialSelector({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
  previewContextValues,
}: CredentialSelectorProps) {
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [editingValue, setEditingValue] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const { activeWorkflowId } = useWorkflowRegistry()
  const [storeValue, setStoreValue] = useSubBlockValue<string | null>(blockId, subBlock.id)

  const requiredScopes = subBlock.requiredScopes || []
  const label = subBlock.placeholder || 'Select credential'
  const serviceId = subBlock.serviceId || ''
  const supportsCredentialSets = subBlock.supportsCredentialSets || false

  const { data: organizationsData } = useOrganizations()
  const { data: subscriptionData } = useSubscriptionData({ enabled: isBillingEnabled })
  const activeOrganization = organizationsData?.activeOrganization
  const subscriptionStatus = getSubscriptionStatus(subscriptionData?.data)
  const hasTeamPlan = subscriptionStatus.isTeam || subscriptionStatus.isEnterprise
  const canUseCredentialSets = supportsCredentialSets && hasTeamPlan && !!activeOrganization?.id

  const { data: credentialSets = [] } = useCredentialSets(
    activeOrganization?.id,
    canUseCredentialSets
  )

  const { depsSatisfied, dependsOn } = useDependsOnGate(blockId, subBlock, {
    disabled,
    isPreview,
    previewContextValues,
  })
  const hasDependencies = dependsOn.length > 0

  const effectiveDisabled = disabled || (hasDependencies && !depsSatisfied)

  const effectiveValue = isPreview && previewValue !== undefined ? previewValue : storeValue
  const rawSelectedId = typeof effectiveValue === 'string' ? effectiveValue : ''
  const isCredentialSetSelected = rawSelectedId.startsWith(CREDENTIAL_SET.PREFIX)
  const selectedId = isCredentialSetSelected ? '' : rawSelectedId
  const selectedCredentialSetId = isCredentialSetSelected
    ? rawSelectedId.slice(CREDENTIAL_SET.PREFIX.length)
    : ''

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

  const selectedCredentialSet = useMemo(
    () => credentialSets.find((cs) => cs.id === selectedCredentialSetId),
    [credentialSets, selectedCredentialSetId]
  )

  const isForeignCredentialSet = Boolean(isCredentialSetSelected && !selectedCredentialSet)

  const resolvedLabel = useMemo(() => {
    if (selectedCredentialSet) return selectedCredentialSet.name
    if (isForeignCredentialSet) return CREDENTIAL.FOREIGN_LABEL
    if (selectedCredential) return selectedCredential.name
    if (isForeign) return CREDENTIAL.FOREIGN_LABEL
    return ''
  }, [selectedCredentialSet, isForeignCredentialSet, selectedCredential, isForeign])

  const displayValue = isEditing ? editingValue : resolvedLabel

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

  const handleCredentialSetSelect = useCallback(
    (credentialSetId: string) => {
      if (isPreview) return
      setStoreValue(`${CREDENTIAL_SET.PREFIX}${credentialSetId}`)
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
    return createElement(baseProviderConfig.icon, { className: 'h-3 w-3' })
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

  const { comboboxOptions, comboboxGroups } = useMemo(() => {
    const pollingProviderId = getPollingProviderFromOAuth(effectiveProviderId)
    // Handle both old ('gmail') and new ('google-email') provider IDs for backwards compatibility
    const matchesProvider = (csProviderId: string | null) => {
      if (!csProviderId || !pollingProviderId) return false
      if (csProviderId === pollingProviderId) return true
      // Handle legacy 'gmail' mapping to 'google-email'
      if (pollingProviderId === 'google-email' && csProviderId === 'gmail') return true
      return false
    }
    const filteredCredentialSets = pollingProviderId
      ? credentialSets.filter((cs) => matchesProvider(cs.providerId))
      : []

    if (canUseCredentialSets && filteredCredentialSets.length > 0) {
      const groups = []

      groups.push({
        section: 'Polling Groups',
        items: filteredCredentialSets.map((cs) => ({
          label: cs.name,
          value: `${CREDENTIAL_SET.PREFIX}${cs.id}`,
        })),
      })

      const credentialItems = credentials.map((cred) => ({
        label: cred.name,
        value: cred.id,
      }))

      if (credentialItems.length > 0) {
        groups.push({
          section: 'Personal Credential',
          items: credentialItems,
        })
      } else {
        groups.push({
          section: 'Personal Credential',
          items: [
            {
              label: `Connect ${getProviderName(provider)} account`,
              value: '__connect_account__',
            },
          ],
        })
      }

      return { comboboxOptions: [], comboboxGroups: groups }
    }

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

    return { comboboxOptions: options, comboboxGroups: undefined }
  }, [
    credentials,
    provider,
    effectiveProviderId,
    getProviderName,
    canUseCredentialSets,
    credentialSets,
  ])

  const selectedCredentialProvider = selectedCredential?.provider ?? provider

  const overlayContent = useMemo(() => {
    if (!displayValue) return null

    if (isCredentialSetSelected && selectedCredentialSet) {
      return (
        <div className='flex w-full items-center truncate'>
          <div className='mr-2 flex-shrink-0 opacity-90'>
            <Users className='h-3 w-3' />
          </div>
          <span className='truncate'>{displayValue}</span>
        </div>
      )
    }

    return (
      <div className='flex w-full items-center truncate'>
        <div className='mr-2 flex-shrink-0 opacity-90'>
          {getProviderIcon(selectedCredentialProvider)}
        </div>
        <span className='truncate'>{displayValue}</span>
      </div>
    )
  }, [
    getProviderIcon,
    displayValue,
    selectedCredentialProvider,
    isCredentialSetSelected,
    selectedCredentialSet,
  ])

  const handleComboboxChange = useCallback(
    (value: string) => {
      if (value === '__connect_account__') {
        handleAddCredential()
        return
      }

      if (value.startsWith(CREDENTIAL_SET.PREFIX)) {
        const credentialSetId = value.slice(CREDENTIAL_SET.PREFIX.length)
        const matchedSet = credentialSets.find((cs) => cs.id === credentialSetId)
        if (matchedSet) {
          handleCredentialSetSelect(credentialSetId)
          return
        }
      }

      const matchedCred = credentials.find((c) => c.id === value)
      if (matchedCred) {
        handleSelect(value)
        return
      }

      setIsEditing(true)
      setEditingValue(value)
    },
    [credentials, credentialSets, handleAddCredential, handleSelect, handleCredentialSetSelect]
  )

  return (
    <div>
      <Combobox
        options={comboboxOptions}
        groups={comboboxGroups}
        value={displayValue}
        selectedValue={rawSelectedId}
        onChange={handleComboboxChange}
        onOpenChange={handleOpenChange}
        placeholder={
          hasDependencies && !depsSatisfied ? 'Fill in required fields above first' : label
        }
        disabled={effectiveDisabled}
        editable={true}
        filterOptions={!isForeign && !isForeignCredentialSet}
        isLoading={credentialsLoading}
        overlayContent={overlayContent}
        className={selectedId || isCredentialSetSelected ? 'pl-[28px]' : ''}
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
