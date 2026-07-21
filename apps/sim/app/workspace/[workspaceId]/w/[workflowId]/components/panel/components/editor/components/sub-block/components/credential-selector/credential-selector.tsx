'use client'

import { useCallback, useMemo, useState } from 'react'
import { Button, Combobox, type ComboboxOptionGroup } from '@sim/emcn'
import { ExternalLink, KeyRound } from 'lucide-react'
import { useParams } from 'next/navigation'
import { consumeOAuthReturnContext, writeOAuthReturnContext } from '@/lib/credentials/client-state'
import {
  getCanonicalScopesForProvider,
  getProviderIdFromServiceId,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  parseProvider,
} from '@/lib/oauth'
import { getMissingRequiredScopes, getServiceConfigByServiceId } from '@/lib/oauth/utils'
import { ConnectOAuthModal } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal'
import {
  ConnectServiceAccountModal,
  type ServiceAccountProviderId,
} from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { getWorkflowSearchLabelHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-depends-on-gate'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import { getBareIconStyle, type StyleableIcon } from '@/blocks/icon-color'
import type { SubBlockConfig } from '@/blocks/types'
import { useWorkspaceCredential, useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'
import { useCredentialRefreshTriggers } from '@/hooks/use-credential-refresh-triggers'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

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
  const activeSearchTarget = useActiveSearchTarget()
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''
  const [showConnectModal, setShowConnectModal] = useState(false)
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [showSetupModal, setShowSetupModal] = useState(false)
  const [editingValue, setEditingValue] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const [storeValue, setStoreValue] = useSubBlockValue<string | null>(blockId, subBlock.id)

  const requiredScopes = subBlock.requiredScopes || []
  const label = subBlock.placeholder || 'Select credential'
  const serviceId = subBlock.serviceId || ''
  const isAllCredentials = !serviceId

  const { depsSatisfied, dependsOn } = useDependsOnGate(blockId, subBlock, {
    disabled,
    isPreview,
    previewContextValues,
  })
  const hasDependencies = dependsOn.length > 0

  const effectiveDisabled = disabled || (hasDependencies && !depsSatisfied)

  const effectiveValue = isPreview && previewValue !== undefined ? previewValue : storeValue
  const selectedId = typeof effectiveValue === 'string' ? effectiveValue : ''

  const effectiveProviderId = useMemo(
    () => getProviderIdFromServiceId(serviceId) as OAuthProvider,
    [serviceId]
  )
  const provider = effectiveProviderId

  const isTriggerMode = subBlock.mode === 'trigger' || subBlock.mode === 'trigger-advanced'

  const {
    data: rawCredentials = [],
    isFetching: oauthCredentialsLoading,
    refetch: refetchCredentials,
  } = useOAuthCredentials(effectiveProviderId, {
    enabled: !isAllCredentials && Boolean(effectiveProviderId),
    workspaceId,
    workflowId: activeWorkflowId || undefined,
  })

  const {
    data: allWorkspaceCredentials = [],
    isFetching: allCredentialsLoading,
    refetch: refetchAllCredentials,
  } = useWorkspaceCredentials({ workspaceId, enabled: isAllCredentials })

  const credentialsLoading = isAllCredentials ? allCredentialsLoading : oauthCredentialsLoading

  const credentialKind = subBlock.credentialKind
  const isMergedKinds = credentialKind === 'any'

  const credentials = useMemo(() => {
    // A service-account picker lists only the reusable service-account
    // credentials, including in trigger mode. A merged ('any') picker lists
    // OAuth accounts and service accounts together.
    if (credentialKind === 'service-account') {
      return rawCredentials.filter((cred) => cred.type === 'service_account')
    }
    if (isMergedKinds) {
      return rawCredentials
    }
    return isTriggerMode && !subBlock.allowServiceAccounts
      ? rawCredentials.filter((cred) => cred.type !== 'service_account')
      : rawCredentials
  }, [rawCredentials, isTriggerMode, credentialKind, isMergedKinds, subBlock.allowServiceAccounts])

  // Resolved service-account provider metadata for the setup modal. Gated on
  // `credentialKind` and using the non-throwing lookup so it never runs (or
  // throws) for plain OAuth pickers.
  const serviceAccountService = useMemo(
    () =>
      credentialKind === 'service-account' || isMergedKinds
        ? getServiceConfigByServiceId(serviceId)
        : null,
    [credentialKind, isMergedKinds, serviceId]
  )

  const selectedCredential = useMemo(
    () => credentials.find((cred) => cred.id === selectedId),
    [credentials, selectedId]
  )

  const selectedAllCredential = useMemo(
    () =>
      isAllCredentials ? (allWorkspaceCredentials.find((c) => c.id === selectedId) ?? null) : null,
    [isAllCredentials, allWorkspaceCredentials, selectedId]
  )

  const isServiceAccount = useMemo(
    () =>
      selectedCredential?.type === 'service_account' ||
      selectedAllCredential?.type === 'service_account',
    [selectedCredential, selectedAllCredential]
  )

  const { data: inaccessibleCredential } = useWorkspaceCredential(
    selectedId || undefined,
    Boolean(selectedId) &&
      !selectedCredential &&
      !selectedAllCredential &&
      !credentialsLoading &&
      Boolean(workspaceId)
  )
  const inaccessibleCredentialName = inaccessibleCredential?.displayName ?? null

  const resolvedLabel = useMemo(() => {
    if (selectedAllCredential) return selectedAllCredential.displayName
    if (selectedCredential) return selectedCredential.name
    if (inaccessibleCredentialName) return inaccessibleCredentialName
    return ''
  }, [selectedAllCredential, selectedCredential, inaccessibleCredentialName])

  const displayValue = isEditing ? editingValue : resolvedLabel

  const refetch = useCallback(
    () => (isAllCredentials ? refetchAllCredentials() : refetchCredentials()),
    [isAllCredentials, refetchAllCredentials, refetchCredentials]
  )

  useCredentialRefreshTriggers(refetch, effectiveProviderId, workspaceId)

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen) void refetch()
    },
    [refetch]
  )

  const hasOAuthSelection = Boolean(selectedCredential)
  const missingRequiredScopes = hasOAuthSelection
    ? getMissingRequiredScopes(selectedCredential!, requiredScopes || [])
    : []

  const needsUpdate =
    hasOAuthSelection &&
    !isServiceAccount &&
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
    if (credentialKind === 'service-account') {
      setShowSetupModal(true)
      return
    }
    setShowConnectModal(true)
  }, [credentialKind])

  const getProviderIcon = useCallback((providerName: OAuthProvider) => {
    const { baseProvider } = parseProvider(providerName)
    const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

    if (!baseProviderConfig) {
      return <ExternalLink className='size-3' />
    }
    const Icon: StyleableIcon = baseProviderConfig.icon
    return <Icon className='size-3 text-[var(--text-icon)]' style={getBareIconStyle(Icon)} />
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
    if (isAllCredentials) {
      const oauthCredentials = allWorkspaceCredentials.filter((c) => c.type === 'oauth')
      return oauthCredentials.map((cred) => ({ label: cred.displayName, value: cred.id }))
    }
    if (isMergedKinds) return []

    const options = credentials.map((cred) => ({
      label: cred.name,
      value: cred.id,
      iconElement: getProviderIcon((cred.provider ?? provider) as OAuthProvider),
    }))

    options.push({
      label:
        credentialKind === 'service-account'
          ? (subBlock.credentialLabels?.serviceAccountConnect ??
            (credentials.length > 0
              ? `Add another ${getProviderName(provider)} key`
              : `Add ${getProviderName(provider)} key`))
          : credentials.length > 0
            ? `Connect another ${getProviderName(provider)} account`
            : `Connect ${getProviderName(provider)} account`,
      value: '__connect_account__',
      iconElement: <ExternalLink className='size-3' />,
    })

    return options
  }, [
    isAllCredentials,
    isMergedKinds,
    allWorkspaceCredentials,
    credentials,
    credentialKind,
    subBlock.credentialLabels,
    provider,
    getProviderIcon,
    getProviderName,
  ])

  const comboboxGroups = useMemo<ComboboxOptionGroup[] | undefined>(() => {
    if (!isMergedKinds) return undefined

    const labels = subBlock.credentialLabels
    const toOption = (cred: (typeof credentials)[number]) => ({
      label: cred.name,
      value: cred.id,
      iconElement: getProviderIcon((cred.provider ?? provider) as OAuthProvider),
    })

    return [
      {
        section: labels?.oauthGroup ?? `${getProviderName(provider)} accounts`,
        items: [
          ...credentials.filter((c) => c.type !== 'service_account').map(toOption),
          {
            label: labels?.oauthConnect ?? `Connect ${getProviderName(provider)} account`,
            value: '__connect_account__',
            iconElement: <ExternalLink className='size-3' />,
          },
        ],
      },
      {
        section: labels?.serviceAccountGroup ?? 'Service accounts',
        items: [
          ...credentials.filter((c) => c.type === 'service_account').map(toOption),
          {
            label: labels?.serviceAccountConnect ?? `Add ${getProviderName(provider)} key`,
            value: '__connect_service_account__',
            iconElement: <ExternalLink className='size-3' />,
          },
        ],
      },
    ]
  }, [
    isMergedKinds,
    subBlock.credentialLabels,
    credentials,
    provider,
    getProviderIcon,
    getProviderName,
  ])

  const selectedCredentialProvider = selectedCredential?.provider ?? provider
  const workflowSearchHighlight = getWorkflowSearchLabelHighlight({
    activeSearchTarget,
    subBlockId: subBlock.id,
    valuePath: [],
    label: displayValue,
  })

  const overlayContent = useMemo(() => {
    if (!displayValue) return null

    if (isAllCredentials && selectedAllCredential) {
      return (
        <div className='flex w-full items-center truncate'>
          <div className='mr-2 flex-shrink-0 opacity-90'>
            <KeyRound className='size-3' />
          </div>
          <span className='truncate'>
            {formatDisplayText(displayValue, { workflowSearchHighlight })}
          </span>
        </div>
      )
    }

    return (
      <div className='flex w-full items-center truncate'>
        <div className='mr-2 flex-shrink-0 opacity-90'>
          {getProviderIcon(selectedCredentialProvider)}
        </div>
        <span className='truncate'>
          {formatDisplayText(displayValue, { workflowSearchHighlight })}
        </span>
      </div>
    )
  }, [
    getProviderIcon,
    displayValue,
    selectedCredentialProvider,
    isAllCredentials,
    selectedAllCredential,
    workflowSearchHighlight,
  ])

  const handleComboboxChange = useCallback(
    (value: string) => {
      if (value === '__connect_account__') {
        if (isMergedKinds) {
          setShowConnectModal(true)
          return
        }
        handleAddCredential()
        return
      }
      if (value === '__connect_service_account__') {
        setShowSetupModal(true)
        return
      }

      const matchedCred = (
        isAllCredentials ? allWorkspaceCredentials.filter((c) => c.type === 'oauth') : credentials
      ).find((c) => c.id === value)
      if (matchedCred) {
        handleSelect(value)
        return
      }

      setIsEditing(true)
      setEditingValue(value)
    },
    [
      isAllCredentials,
      isMergedKinds,
      allWorkspaceCredentials,
      credentials,
      handleAddCredential,
      handleSelect,
    ]
  )

  return (
    <div>
      <Combobox
        options={comboboxOptions}
        groups={comboboxGroups}
        value={displayValue}
        selectedValue={selectedId}
        onChange={handleComboboxChange}
        onOpenChange={handleOpenChange}
        placeholder={
          hasDependencies && !depsSatisfied ? 'Fill in required fields above first' : label
        }
        disabled={effectiveDisabled}
        editable={!isMergedKinds}
        filterOptions={!isMergedKinds}
        searchable={isMergedKinds}
        searchPlaceholder='Search credentials...'
        isLoading={credentialsLoading}
        overlayContent={overlayContent}
        className={overlayContent ? 'pl-7' : ''}
      />

      {needsUpdate && (
        <div className='mt-2 flex flex-col gap-1 rounded-sm border bg-[var(--surface-2)] px-2 py-1.5'>
          <div className='flex items-center font-medium text-caption'>
            <span className='mr-1.5 inline-block size-[6px] rounded-xs bg-amber-500' />
            Additional permissions required
          </div>
          <Button
            variant='active'
            onClick={() => {
              writeOAuthReturnContext({
                origin: 'workflow',
                workflowId: activeWorkflowId || '',
                displayName: selectedCredential?.name ?? getProviderName(provider),
                providerId: effectiveProviderId,
                preCount: credentials.filter((c) => c.type !== 'service_account').length,
                workspaceId,
                requestedAt: Date.now(),
              })
              setShowOAuthModal(true)
            }}
            className='w-full px-2 py-1 font-medium text-caption'
          >
            Update access
          </Button>
        </div>
      )}

      {showConnectModal && (
        <ConnectOAuthModal
          mode='connect'
          origin='workflow'
          open={showConnectModal}
          onOpenChange={(open) => !open && setShowConnectModal(false)}
          provider={provider}
          serviceId={serviceId}
          providerId={effectiveProviderId}
          requiredScopes={getCanonicalScopesForProvider(effectiveProviderId)}
          workspaceId={workspaceId}
          workflowId={activeWorkflowId || ''}
        />
      )}

      {showOAuthModal && (
        <ConnectOAuthModal
          mode='reauthorize'
          open={showOAuthModal}
          onOpenChange={(open) => {
            if (!open) {
              consumeOAuthReturnContext()
              setShowOAuthModal(false)
            }
          }}
          provider={provider}
          toolName={getProviderName(provider)}
          requiredScopes={getCanonicalScopesForProvider(effectiveProviderId)}
          newScopes={missingRequiredScopes}
          serviceId={serviceId}
        />
      )}

      {showSetupModal && serviceAccountService?.serviceAccountProviderId && (
        <ConnectServiceAccountModal
          open={showSetupModal}
          onOpenChange={setShowSetupModal}
          workspaceId={workspaceId}
          serviceAccountProviderId={
            serviceAccountService.serviceAccountProviderId as ServiceAccountProviderId
          }
          serviceName={serviceAccountService.name}
          serviceIcon={serviceAccountService.icon}
          onCreated={(newCredentialId) => {
            setStoreValue(newCredentialId)
            refetchCredentials()
          }}
        />
      )}
    </div>
  )
}
