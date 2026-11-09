'use client'

import { useState } from 'react'
import type { ConnectorData } from '@/lib/api/contracts/knowledge/connectors'
import { type ResourceScope, resourceScopeFields } from '@/lib/core/resource-scope'
import {
  derivedAclCapFieldIds,
  isConnectorFieldRequired,
} from '@/lib/knowledge/connectors/access-fields'
import { initialConnectorAccessMode } from '@/lib/knowledge/connectors/access-modes'
import { getProviderIdFromServiceId, type OAuthProvider } from '@/lib/oauth'
import { GITHUB_INSTALLATION_PROVIDER_ID } from '@/lib/oauth/github-installation-types'
import { getSearchConnectionLabels } from '@/lib/sim-search/connection-labels'
import { getConnectorAccessAvailability } from '@/lib/sim-search/connectors'
import { SIM_SEARCH_SYNC_INTERVAL_MINUTES } from '@/lib/sim-search/constants'
import { liveSearchSourceMeta } from '@/lib/sim-search/live/source-settings'
import { getConnectorApiKeyConfig, isConnectorCredentialTypeAllowed } from '@/connectors/auth'
import { useGitLabPermissionForm } from '@/connectors/gitlab/permission-config/use-permission-form'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import type { ConnectorConfigField, ConnectorMeta } from '@/connectors/types'
import { useConnectorConfigFields } from '@/hooks/kb/connectors/use-connector-config-fields'
import { useCreateConnector } from '@/hooks/queries/kb/connectors'
import { useOAuthCredentials } from '@/hooks/queries/oauth/credentials'
import { useSourceAccounts } from '@/hooks/queries/source-accounts'
import { useCredentialRefreshTriggers } from '@/hooks/use-credential-refresh-triggers'
import { useGitHubInstallationSetup } from '@/hooks/use-github-installation-setup'
import { useOAuthReturnForKBConnectors } from '@/hooks/use-oauth-return'
import { connectorServiceAccount } from '@/platform/lib/data/knowledge/connectors/service-account'
import { useConnectorScope, useSearchAvailability } from '@/platform/lib/data/search-sources/scope'
import type {
  ConnectorAccessSelection,
  ConnectorConfigFieldsProps,
} from '@/platform/lib/data/search-sources/types'
import { useConnectorSetupStore } from '@/stores/connector-setup/store'

const CONNECTOR_ENTRIES = Object.entries(CONNECTOR_META_REGISTRY)

/** The settings a new connector's form starts from; a Search source adds its own defaults. */
function startingSourceConfig(
  meta: Pick<ConnectorMeta, 'defaultSourceConfig' | 'searchDefaultSourceConfig'> | null | undefined,
  isSearchIndex: boolean | undefined
): Record<string, string> {
  return {
    ...meta?.defaultSourceConfig,
    ...(isSearchIndex ? meta?.searchDefaultSourceConfig : undefined),
  }
}

export interface AddConnectorFormOptions {
  scope: ResourceScope
  onOpenChange: (open: boolean) => void
  onConnectorTypeChange?: (connectorType: string | null) => void
  knowledgeBaseId: string
  isSearchIndex?: boolean
  initialConnectorType?: string | null
  initialAccessMode?: ConnectorAccessSelection['accessMode']
  lockConnectorType?: boolean
  /** The entry point has already chosen how this source connects. */
  lockedAccessMode?: 'members' | 'admin'
  initialSyncIntervalMinutes?: number
  onCreated?: (connectorType: string, connector: ConnectorData) => void
  setupDraftKey?: string
}

type Step = 'select-type' | 'configure'

/** A new connector's form: draft, accounts, availability, and submission. Surfaces draw their own. */
export function useAddConnectorForm({
  onOpenChange,
  onConnectorTypeChange,
  knowledgeBaseId,
  isSearchIndex = false,
  initialConnectorType,
  initialAccessMode = 'workspace',
  lockConnectorType = false,
  lockedAccessMode,
  initialSyncIntervalMinutes = 1440,
  onCreated,
  setupDraftKey,
  scope: explicitScope,
}: AddConnectorFormOptions) {
  const initialType =
    initialConnectorType &&
    (!isSearchIndex || CONNECTOR_META_REGISTRY[initialConnectorType]?.search)
      ? initialConnectorType
      : null
  const { scope, canAdmin, memberAccessAvailable, mirroredAccessAvailable, hasMaxAccess } =
    useConnectorScope(explicitScope)
  const owner = resourceScopeFields(scope)
  const [draft] = useState(() =>
    setupDraftKey ? useConnectorSetupStore.getState().getDraft(setupDraftKey) : undefined
  )
  const [step, setStep] = useState<Step>(() => (initialType ? 'configure' : 'select-type'))
  const [selectedType, setSelectedType] = useState<string | null>(initialType)
  const [syncInterval, setSyncInterval] = useState(
    isSearchIndex ? SIM_SEARCH_SYNC_INTERVAL_MINUTES : initialSyncIntervalMinutes
  )
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(
    draft?.credentialId ?? null
  )
  const [contentCredentialId, setContentCredentialId] = useState<string | null>(
    draft?.contentCredentialId ?? null
  )
  const [access, setAccess] = useState<ConnectorAccessSelection>(() => ({
    accessMode: initialConnectorAccessMode(
      initialType ? CONNECTOR_META_REGISTRY[initialType] : undefined,
      canAdmin && isSearchIndex && initialType === 'github' && scope.kind === 'organization'
        ? 'members'
        : (lockedAccessMode ??
            (lockConnectorType ? initialAccessMode : draft?.accessMode) ??
            (isSearchIndex && initialAccessMode === 'workspace'
              ? initialType && CONNECTOR_META_REGISTRY[initialType]?.auth.mode === 'apiKey'
                ? 'admin'
                : 'members'
              : initialAccessMode))
    ),
  }))
  const [disabledTagIds, setDisabledTagIds] = useState<Set<string>>(
    () => new Set(draft?.disabledTagIds)
  )
  const [showMetadata, setShowMetadata] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  /** Which picker a new service account fills: the browsing account or the content account. */
  const [serviceAccountField, setServiceAccountField] = useState<'browsing' | 'content' | null>(
    null
  )

  const gitlabPermissions = useGitLabPermissionForm()
  const [apiKeyValue, setApiKeyValue] = useState('')
  const [useApiKey, setUseApiKey] = useState(!isSearchIndex)
  const [searchTerm, setSearchTerm] = useState('')

  useOAuthReturnForKBConnectors(
    isSearchIndex ? knowledgeBaseId : undefined,
    setSelectedCredentialId,
    selectedType ?? undefined,
    scope
  )
  const { mutate: createConnector, isPending: isCreating } = useCreateConnector()

  const liveSearch = isSearchIndex
  const canSetUpGitHubInstallation =
    canAdmin && isSearchIndex && selectedType === 'github' && scope.kind === 'organization'
  const connectorConfig = liveSearchSourceMeta(
    selectedType ? (CONNECTOR_META_REGISTRY[selectedType] ?? null) : null,
    Boolean(liveSearch),
    { githubInstallation: canSetUpGitHubInstallation }
  )
  const docsUrl = isSearchIndex ? connectorConfig?.searchDocsUrl : undefined
  const setupGuideActions = docsUrl
    ? [
        {
          label: 'Setup guide',
          onClick: () => window.open(docsUrl, '_blank', 'noopener,noreferrer'),
        },
      ]
    : undefined
  const searchLabels =
    isSearchIndex && selectedType
      ? getSearchConnectionLabels(selectedType, access.accessMode)
      : undefined
  const modalTitle = searchLabels?.title ?? `Configure ${connectorConfig?.name}`
  const showGitLabPermissions = selectedType === 'gitlab' && access.accessMode === 'admin'
  const isMembersMode = access.accessMode === 'members'
  const apiKeyConfig = connectorConfig ? getConnectorApiKeyConfig(connectorConfig.auth) : undefined
  const isApiKeyMode =
    connectorConfig?.auth.mode === 'apiKey' || Boolean(apiKeyConfig && !isMembersMode && useApiKey)
  const {
    integrationAvailability,
    oauthServiceAvailability,
    isIntegrationAvailabilityReady,
    isIntegrationAvailabilityFetching,
    isIntegrationAvailabilityLoading,
    integrationAvailabilityError,
    refetchIntegrationAvailability,
  } = useSearchAvailability()
  const { admin: allowAdmin, members: allowMembers } = connectorConfig
    ? getConnectorAccessAvailability(connectorConfig, integrationAvailability, {
        memberAccessAvailable,
        mirroredAccessAvailable,
        oauthServiceAvailability,
        isIntegrationAvailabilityReady,
      })
    : { admin: false, members: false }
  const needsSlackSetup = selectedType === 'slack' && isMembersMode
  const { data: sourceAccounts } = useSourceAccounts(
    canAdmin && needsSlackSetup ? scope : undefined
  )
  const slackConfigured =
    sourceAccounts?.credentialGroup?.status === 'active' &&
    sourceAccounts.credentialGroup.options.some(
      (option) =>
        option.provider === 'slack' &&
        option.status === 'active' &&
        option.configurationStatus === 'ready'
    )
  const slackSetupRequired = needsSlackSetup && !slackConfigured
  const hiddenCapFieldIds = derivedAclCapFieldIds(connectorConfig, access.accessMode)
  /** True when the connector declares its key optional (public sources need none). */
  const isApiKeyOptional =
    connectorConfig?.auth.mode === 'apiKey' && connectorConfig.auth.optional === true
  const connectorProviderId =
    connectorConfig?.auth.mode === 'oauth'
      ? (getProviderIdFromServiceId(connectorConfig.auth.provider) as OAuthProvider)
      : null

  const requiresServiceAccount =
    access.accessMode === 'admin' &&
    connectorConfig?.auth.mode === 'oauth' &&
    !isConnectorCredentialTypeAllowed(connectorConfig.auth, access.accessMode, 'oauth')
  const serviceAccount = connectorServiceAccount({
    connectorConfig,
    providerId: connectorProviderId,
    offered: isSearchIndex || requiresServiceAccount,
    integrationAvailability,
    docsUrl,
  })

  const browsePersonalAccounts =
    isMembersMode && (selectedType === 'jira' || selectedType === 'confluence')
  const {
    data: rawCredentials = [],
    isLoading: credentialsLoading,
    isFetching: credentialsFetching,
    error: credentialsError,
    refetch: refetchCredentials,
  } = useOAuthCredentials(connectorProviderId ?? undefined, {
    enabled: Boolean(connectorConfig) && !isApiKeyMode,
    purpose: browsePersonalAccounts ? 'browsing' : undefined,
    ...owner,
  })

  useCredentialRefreshTriggers(refetchCredentials, connectorProviderId ?? '', scope)

  const credentials = rawCredentials.filter(
    (credential) =>
      (browsePersonalAccounts && credential.type === 'managed_oauth') ||
      !connectorConfig ||
      isConnectorCredentialTypeAllowed(connectorConfig.auth, access.accessMode, credential.type)
  )
  const canConnectOAuth =
    connectorConfig &&
    isConnectorCredentialTypeAllowed(connectorConfig.auth, access.accessMode, 'oauth')
  const effectiveCredentialId =
    selectedCredentialId && credentials.some((credential) => credential.id === selectedCredentialId)
      ? selectedCredentialId
      : credentials.length === 1
        ? credentials[0].id
        : null
  const installations = credentials.filter(
    (credential) => credential.provider === GITHUB_INSTALLATION_PROVIDER_ID
  )
  const installationCredentialId = contentCredentialId
    ? (installations.find((credential) => credential.id === contentCredentialId)?.id ?? null)
    : installations.length === 1
      ? installations[0].id
      : null
  const effectiveContentCredentialId = canSetUpGitHubInstallation
    ? installationCredentialId
    : contentCredentialId

  const {
    sourceConfig,
    setSourceConfig,
    selectionLabels,
    canonicalModes,
    setCanonicalModes,
    canonicalGroups,
    isFieldVisible: isConfigFieldVisible,
    isFieldPopulated,
    handleFieldChange,
    toggleCanonicalMode,
    resolveSourceConfig,
  } = useConnectorConfigFields({
    connectorConfig,
    accessMode: access.accessMode,
    initialSourceConfig: {
      ...startingSourceConfig(connectorConfig, isSearchIndex),
      ...draft?.sourceConfig,
    },
    initialCanonicalModes: draft?.canonicalModes,
    initialSelectionLabels: draft?.selectionLabels,
  })

  const githubSetup = useGitHubInstallationSetup({
    organizationId:
      canSetUpGitHubInstallation && scope.kind === 'organization'
        ? scope.organizationId
        : undefined,
    onConnected: (credentialId) => {
      if (credentialId !== installationCredentialId) handleFieldChange('repository', '')
      setContentCredentialId(credentialId)
    },
  })

  const indexingCredentialId = isApiKeyMode
    ? null
    : isMembersMode
      ? effectiveContentCredentialId
      : effectiveCredentialId
  const indexingCredential = credentials.find(
    (credential) => credential.id === indexingCredentialId
  )
  const isFieldVisible = (field: ConnectorConfigField) =>
    isConfigFieldVisible(field) &&
    (connectorConfig?.auth.mode !== 'oauth' ||
      connectorConfig.auth.serviceAccountSubjectFieldId !== field.id ||
      indexingCredential?.type === 'service_account')

  const showCredentialPicker =
    !canSetUpGitHubInstallation &&
    (!isMembersMode ||
      connectorConfig?.configFields.some(
        (field) => field.type === 'selector' && isFieldVisible(field)
      ))

  const saveSetup = () => {
    if (!setupDraftKey) return
    useConnectorSetupStore.getState().saveDraft(setupDraftKey, {
      sourceConfig,
      selectionLabels,
      canonicalModes,
      accessMode: access.accessMode,
      credentialId: effectiveCredentialId,
      contentCredentialId: effectiveContentCredentialId,
      disabledTagIds: Array.from(disabledTagIds),
      savedAt: Date.now(),
    })
  }

  /** Keeps the draft through the provider's round trip, which returns to this setup page. */
  const connectOAuth = () => {
    saveSetup()
    setShowOAuthModal(true)
  }

  const isOptionalSetupField = (field: ConnectorConfigField) =>
    (isSearchIndex || connectorConfig?.supportedAccessModes?.length === 1) &&
    field.setupGroup === 'options' &&
    Boolean(connectorConfig && !isConnectorFieldRequired(field, connectorConfig, access.accessMode))
  const hasOptionalSetupFields = connectorConfig?.configFields.some(
    (field) =>
      isOptionalSetupField(field) && isFieldVisible(field) && !hiddenCapFieldIds.has(field.id)
  )
  const configFieldsProps: Omit<ConnectorConfigFieldsProps, 'isFieldVisible'> | null =
    connectorConfig
      ? {
          scope,
          accessMode: access.accessMode,
          connectorConfig,
          sourceConfig,
          selectionLabels,
          credentialId: canSetUpGitHubInstallation
            ? installationCredentialId
            : effectiveCredentialId,
          credentialType: credentials.find((item) => item.id === effectiveCredentialId)?.type,
          canonicalGroups,
          canonicalModes,
          onFieldChange: handleFieldChange,
          onToggleCanonicalMode: toggleCanonicalMode,
          disabled: isCreating,
        }
      : null

  const closeSetup = (nextOpen: boolean) => {
    if (!nextOpen && setupDraftKey) useConnectorSetupStore.getState().clearDraft(setupDraftKey)
    if (!nextOpen) {
      gitlabPermissions.reset()
      setApiKeyValue('')
    }
    onOpenChange(nextOpen)
  }

  const handleSelectType = (type: string) => {
    if (setupDraftKey) useConnectorSetupStore.getState().clearDraft(setupDraftKey)
    gitlabPermissions.reset()
    setSelectedType(type)
    setSourceConfig(startingSourceConfig(CONNECTOR_META_REGISTRY[type], isSearchIndex))
    setSelectedCredentialId(null)
    setContentCredentialId(null)
    setAccess({
      accessMode: initialConnectorAccessMode(
        CONNECTOR_META_REGISTRY[type],
        isSearchIndex
          ? CONNECTOR_META_REGISTRY[type]?.auth.mode === 'apiKey'
            ? 'admin'
            : 'members'
          : 'workspace'
      ),
    })
    setApiKeyValue('')
    setUseApiKey(!isSearchIndex)
    setDisabledTagIds(new Set())
    setShowMetadata(false)
    setCanonicalModes({})
    setError(null)
    setSearchTerm('')
    setStep('configure')
    onConnectorTypeChange?.(type)
  }

  const hasRequiredCredential = isApiKeyMode
    ? isApiKeyOptional || Boolean(apiKeyValue.trim())
    : canSetUpGitHubInstallation
      ? Boolean(installationCredentialId)
      : isMembersMode || Boolean(effectiveCredentialId)
  const hasSearchAccess =
    !isSearchIndex ||
    Boolean(
      connectorConfig?.search &&
        access.accessMode !== 'workspace' &&
        (!isMembersMode || allowMembers) &&
        (access.accessMode !== 'admin' || allowAdmin)
    )
  const canSubmit = Boolean(
    connectorConfig &&
      hasRequiredCredential &&
      (!showGitLabPermissions || gitlabPermissions.complete) &&
      hasSearchAccess &&
      (access.accessMode !== 'admin' || allowAdmin) &&
      (!isMembersMode || allowMembers) &&
      !slackSetupRequired &&
      connectorConfig.configFields.every(
        (field) =>
          !isConnectorFieldRequired(field, connectorConfig, access.accessMode) ||
          !isFieldVisible(field) ||
          hiddenCapFieldIds.has(field.id) ||
          isFieldPopulated(field)
      )
  )

  const handleSubmit = () => {
    if (!selectedType || !canSubmit) return

    setError(null)

    const resolvedConfig: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(resolveSourceConfig())) {
      if (hiddenCapFieldIds.has(key)) continue
      if (Array.isArray(value)) {
        if (value.length > 0) resolvedConfig[key] = value
      } else if (typeof value === 'string') {
        if (value) resolvedConfig[key] = value
      } else if (value !== undefined && value !== null) {
        resolvedConfig[key] = value
      }
    }
    if (disabledTagIds.size > 0) {
      resolvedConfig.disabledTagIds = Array.from(disabledTagIds)
    }
    if (Object.keys(canonicalModes).length > 0) {
      resolvedConfig._canonicalModes = canonicalModes
    }
    const finalSourceConfig = resolvedConfig

    createConnector(
      {
        knowledgeBaseId,
        connectorType: selectedType,
        ...(showGitLabPermissions ? { permissionConfig: gitlabPermissions.input } : {}),
        accessMode: access.accessMode,
        ...(isApiKeyMode
          ? apiKeyValue.trim()
            ? { apiKey: apiKeyValue }
            : {}
          : isMembersMode
            ? {
                accessMode: 'members' as const,
                credentialId: effectiveContentCredentialId ?? undefined,
              }
            : { accessMode: access.accessMode, credentialId: effectiveCredentialId ?? undefined }),
        sourceConfig: finalSourceConfig,
        syncIntervalMinutes: syncInterval,
      },
      {
        onSuccess: (connector) => {
          closeSetup(false)
          onCreated?.(selectedType, connector)
        },
        onError: (err) => {
          setError(err.message)
        },
      }
    )
  }

  const term = searchTerm.toLowerCase().trim()
  const entries = isSearchIndex
    ? CONNECTOR_ENTRIES.filter(([, config]) => config.search)
    : CONNECTOR_ENTRIES
  const filteredEntries = term
    ? entries.filter(
        ([, config]) =>
          config.name.toLowerCase().includes(term) ||
          config.description.toLowerCase().includes(term)
      )
    : entries

  return {
    access,
    allowAdmin,
    allowMembers,
    apiKeyConfig,
    apiKeyValue,
    canAdmin,
    canConnectOAuth,
    canSetUpGitHubInstallation,
    canSubmit,
    closeSetup,
    configFieldsProps,
    connectOAuth,
    connectorConfig,
    connectorProviderId,
    contentCredentialId,
    credentials,
    credentialsError,
    credentialsFetching,
    credentialsLoading,
    disabledTagIds,
    docsUrl,
    effectiveCredentialId,
    entries,
    error,
    filteredEntries,
    githubSetup,
    gitlabPermissions,
    handleFieldChange,
    handleSelectType,
    handleSubmit,
    hasMaxAccess,
    hasOptionalSetupFields,
    hiddenCapFieldIds,
    installationCredentialId,
    installations,
    integrationAvailabilityError,
    isApiKeyMode,
    isConfigFieldVisible,
    isCreating,
    isFieldVisible,
    isIntegrationAvailabilityFetching,
    isIntegrationAvailabilityLoading,
    isIntegrationAvailabilityReady,
    isMembersMode,
    isOptionalSetupField,
    liveSearch,
    memberAccessAvailable,
    mirroredAccessAvailable,
    modalTitle,
    owner,
    rawCredentials,
    refetchCredentials,
    refetchIntegrationAvailability,
    saveSetup,
    scope,
    searchLabels,
    searchTerm,
    selectedType,
    serviceAccount,
    serviceAccountField,
    setAccess,
    setApiKeyValue,
    setContentCredentialId,
    setDisabledTagIds,
    setSearchTerm,
    setSelectedCredentialId,
    setServiceAccountField,
    setShowMetadata,
    setShowOAuthModal,
    setStep,
    setSyncInterval,
    setUseApiKey,
    setupGuideActions,
    showCredentialPicker,
    showGitLabPermissions,
    showMetadata,
    showOAuthModal,
    slackSetupRequired,
    step,
    syncInterval,
  }
}
