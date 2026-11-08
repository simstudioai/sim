'use client'

import { useState } from 'react'
import type { ConnectorAccessMode, ConnectorData } from '@/lib/api/contracts/knowledge/connectors'
import { resourceScopeFields } from '@/lib/core/resource-scope'
import { initialConnectorAccessMode } from '@/lib/knowledge/connectors/access-modes'
import { getProviderIdFromServiceId, type OAuthProvider } from '@/lib/oauth'
import { getSearchConnectionLabels } from '@/lib/sim-search/connection-labels'
import { getConnectorAccessAvailability } from '@/lib/sim-search/connectors'
import { SIM_SEARCH_SYNC_INTERVAL_MINUTES } from '@/lib/sim-search/constants'
import { liveSearchSourceMeta } from '@/lib/sim-search/live/source-settings'
import {
  derivedAclCapFieldIds,
  isConnectorFieldRequired,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access'
import { useConnectorConfigFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { getConnectorApiKeyConfig, isConnectorCredentialTypeAllowed } from '@/connectors/auth'
import { useGitLabPermissionForm } from '@/connectors/gitlab/permission-config/use-permission-form'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import type { ConnectorConfigField, ConnectorMeta } from '@/connectors/types'
import { useCreateConnector } from '@/hooks/queries/kb/connectors'
import { useOAuthCredentials } from '@/hooks/queries/oauth/credentials'
import { useSourceAccounts } from '@/hooks/queries/source-accounts'
import { useCredentialRefreshTriggers } from '@/hooks/use-credential-refresh-triggers'
import { useOAuthReturnForKBConnectors } from '@/hooks/use-oauth-return'
import {
  useConnectorAvailability,
  useConnectorScope,
} from '@/platform/lib/data/knowledge/connectors/scope'
import { connectorServiceAccount } from '@/platform/lib/data/knowledge/connectors/service-account'
import { useConnectorSetupStore } from '@/stores/connector-setup/store'

/** Every source the registry offers, in its order. */
const CONNECTOR_ENTRIES = Object.entries(CONNECTOR_META_REGISTRY)

/** The settings a new connector's form starts from; a Search source adds its own defaults. */
function startingSourceConfig(meta: ConnectorMeta | null | undefined, isSearchIndex: boolean) {
  return {
    ...meta?.defaultSourceConfig,
    ...(isSearchIndex ? meta?.searchDefaultSourceConfig : undefined),
  }
}

interface AddConnectorFormOptions {
  workspaceId: string
  knowledgeBaseId: string
  isSearchIndex: boolean
  initialConnectorType?: string
  onConnectorTypeChange: (connectorType: string) => void
  onClose: () => void
}

/**
 * A new connector's form, as the legacy Add connector dialog keeps it: the source, how it connects
 * and authenticates, its configuration and metadata tags, and how often it syncs. The draft is saved
 * before an OAuth round trip and restored when the page reopens the dialog for the same source.
 */
export function useAddConnectorForm({
  workspaceId,
  knowledgeBaseId,
  isSearchIndex,
  initialConnectorType,
  onConnectorTypeChange,
  onClose,
}: AddConnectorFormOptions) {
  const setupDraftKey = `knowledge-base:${knowledgeBaseId}`
  const initialType =
    initialConnectorType &&
    CONNECTOR_META_REGISTRY[initialConnectorType] &&
    (!isSearchIndex || CONNECTOR_META_REGISTRY[initialConnectorType]?.search)
      ? initialConnectorType
      : null
  const { scope, canAdmin, memberAccessAvailable, mirroredAccessAvailable, hasMaxAccess } =
    useConnectorScope(workspaceId)
  const owner = resourceScopeFields(scope)
  const [draft] = useState(() => {
    const saved = useConnectorSetupStore.getState().getDraft(setupDraftKey)
    return saved && initialType ? saved : undefined
  })
  const [step, setStep] = useState<'select-type' | 'configure'>(() =>
    initialType ? 'configure' : 'select-type'
  )
  const [selectedType, setSelectedType] = useState<string | null>(initialType)
  const [syncInterval, setSyncInterval] = useState(
    isSearchIndex ? SIM_SEARCH_SYNC_INTERVAL_MINUTES : 1440
  )
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(
    draft?.credentialId ?? null
  )
  const [contentCredentialId, setContentCredentialId] = useState<string | null>(
    draft?.contentCredentialId ?? null
  )
  const [accessMode, setAccessMode] = useState<ConnectorAccessMode>(() =>
    initialConnectorAccessMode(
      initialType ? CONNECTOR_META_REGISTRY[initialType] : undefined,
      draft?.accessMode ??
        (isSearchIndex
          ? initialType && CONNECTOR_META_REGISTRY[initialType]?.auth.mode === 'apiKey'
            ? 'admin'
            : 'members'
          : 'workspace')
    )
  )
  const [disabledTagIds, setDisabledTagIds] = useState<ReadonlySet<string>>(
    () => new Set(draft?.disabledTagIds)
  )
  const [showMore, setShowMore] = useState(false)
  const gitlabPermissions = useGitLabPermissionForm()
  const [apiKey, setApiKey] = useState('')
  const [useApiKey, setUseApiKey] = useState(!isSearchIndex)
  const [searchTerm, setSearchTerm] = useState('')

  useOAuthReturnForKBConnectors(
    isSearchIndex ? knowledgeBaseId : undefined,
    setSelectedCredentialId,
    selectedType ?? undefined,
    scope
  )
  const createConnector = useCreateConnector()
  const availability = useConnectorAvailability()

  const connectorConfig = liveSearchSourceMeta(
    selectedType ? (CONNECTOR_META_REGISTRY[selectedType] ?? null) : null,
    isSearchIndex,
    { githubInstallation: false }
  )
  const docsUrl = isSearchIndex ? connectorConfig?.searchDocsUrl : undefined
  const searchLabels =
    isSearchIndex && selectedType ? getSearchConnectionLabels(selectedType, accessMode) : undefined
  const title = searchLabels?.title ?? `Configure ${connectorConfig?.name ?? ''}`
  const showGitLabPermissions = selectedType === 'gitlab' && accessMode === 'admin'
  const isMembersMode = accessMode === 'members'
  const apiKeyConfig = connectorConfig ? getConnectorApiKeyConfig(connectorConfig.auth) : undefined
  const isApiKeyMode =
    connectorConfig?.auth.mode === 'apiKey' || Boolean(apiKeyConfig && !isMembersMode && useApiKey)
  const { admin: allowAdmin, members: allowMembers } = connectorConfig
    ? getConnectorAccessAvailability(connectorConfig, availability.integrationAvailability, {
        memberAccessAvailable,
        mirroredAccessAvailable,
        oauthServiceAvailability: availability.oauthServiceAvailability,
        isIntegrationAvailabilityReady: availability.isReady,
      })
    : { admin: false, members: false }
  const needsSlackSetup = selectedType === 'slack' && isMembersMode
  const sourceAccounts = useSourceAccounts(canAdmin && needsSlackSetup ? scope : undefined).data
  const slackConfigured =
    sourceAccounts?.credentialGroup?.status === 'active' &&
    sourceAccounts.credentialGroup.options.some(
      (option) =>
        option.provider === 'slack' &&
        option.status === 'active' &&
        option.configurationStatus === 'ready'
    )
  const slackSetupRequired = needsSlackSetup && !slackConfigured
  const hiddenCapFieldIds = derivedAclCapFieldIds(connectorConfig, accessMode)
  const isApiKeyOptional =
    connectorConfig?.auth.mode === 'apiKey' && connectorConfig.auth.optional === true
  const providerId =
    connectorConfig?.auth.mode === 'oauth'
      ? (getProviderIdFromServiceId(connectorConfig.auth.provider) as OAuthProvider)
      : null

  const browsePersonalAccounts =
    isMembersMode && (selectedType === 'jira' || selectedType === 'confluence')
  const credentialsQuery = useOAuthCredentials(providerId ?? undefined, {
    enabled: Boolean(connectorConfig) && !isApiKeyMode,
    purpose: browsePersonalAccounts ? 'browsing' : undefined,
    ...owner,
  })
  useCredentialRefreshTriggers(credentialsQuery.refetch, providerId ?? '', scope)
  const rawCredentials = credentialsQuery.data ?? []
  const credentials = rawCredentials.filter(
    (credential) =>
      (browsePersonalAccounts && credential.type === 'managed_oauth') ||
      !connectorConfig ||
      isConnectorCredentialTypeAllowed(connectorConfig.auth, accessMode, credential.type)
  )
  const canConnectOAuth = Boolean(
    connectorConfig && isConnectorCredentialTypeAllowed(connectorConfig.auth, accessMode, 'oauth')
  )
  const requiresServiceAccount =
    accessMode === 'admin' && connectorConfig?.auth.mode === 'oauth' && !canConnectOAuth
  const serviceAccount = connectorServiceAccount({
    connectorConfig,
    providerId,
    offered: isSearchIndex || requiresServiceAccount,
    integrationAvailability: availability.integrationAvailability,
    docsUrl,
  })
  const credentialId =
    selectedCredentialId && credentials.some((credential) => credential.id === selectedCredentialId)
      ? selectedCredentialId
      : credentials.length === 1
        ? (credentials[0]?.id ?? null)
        : null

  const config = useConnectorConfigFields({
    connectorConfig,
    accessMode,
    initialSourceConfig: {
      ...startingSourceConfig(connectorConfig, isSearchIndex),
      ...draft?.sourceConfig,
    },
    initialCanonicalModes: draft?.canonicalModes,
    initialSelectionLabels: draft?.selectionLabels,
  })

  const indexingCredentialId = isApiKeyMode
    ? null
    : isMembersMode
      ? contentCredentialId
      : credentialId
  const indexingCredential = credentials.find(
    (credential) => credential.id === indexingCredentialId
  )
  const isFieldVisible = (field: ConnectorConfigField) =>
    config.isFieldVisible(field) &&
    (connectorConfig?.auth.mode !== 'oauth' ||
      connectorConfig.auth.serviceAccountSubjectFieldId !== field.id ||
      indexingCredential?.type === 'service_account')
  const showCredentialPicker =
    !isMembersMode ||
    Boolean(
      connectorConfig?.configFields.some(
        (field) => field.type === 'selector' && isFieldVisible(field)
      )
    )
  const isOptionalSetupField = (field: ConnectorConfigField) =>
    (isSearchIndex || connectorConfig?.supportedAccessModes?.length === 1) &&
    field.setupGroup === 'options' &&
    Boolean(connectorConfig && !isConnectorFieldRequired(field, connectorConfig, accessMode))
  const hasOptionalSetupFields = Boolean(
    connectorConfig?.configFields.some(
      (field) =>
        isOptionalSetupField(field) && isFieldVisible(field) && !hiddenCapFieldIds.has(field.id)
    )
  )

  function saveDraft() {
    useConnectorSetupStore.getState().saveDraft(setupDraftKey, {
      sourceConfig: config.sourceConfig,
      selectionLabels: config.selectionLabels,
      canonicalModes: config.canonicalModes,
      accessMode,
      credentialId,
      contentCredentialId,
      disabledTagIds: Array.from(disabledTagIds),
      savedAt: Date.now(),
    })
  }

  function clearDraft() {
    useConnectorSetupStore.getState().clearDraft(setupDraftKey)
  }

  function close() {
    clearDraft()
    gitlabPermissions.reset()
    setApiKey('')
    onClose()
  }

  function selectType(type: string) {
    clearDraft()
    gitlabPermissions.reset()
    const meta = CONNECTOR_META_REGISTRY[type]
    setSelectedType(type)
    config.setSourceConfig(startingSourceConfig(meta, isSearchIndex))
    setSelectedCredentialId(null)
    setContentCredentialId(null)
    setAccessMode(
      initialConnectorAccessMode(
        meta,
        isSearchIndex ? (meta?.auth.mode === 'apiKey' ? 'admin' : 'members') : 'workspace'
      )
    )
    setApiKey('')
    setUseApiKey(!isSearchIndex)
    setDisabledTagIds(new Set())
    setShowMore(false)
    config.setCanonicalModes({})
    setSearchTerm('')
    setStep('configure')
    onConnectorTypeChange(type)
  }

  function back() {
    clearDraft()
    setStep('select-type')
    onConnectorTypeChange('')
  }

  const hasRequiredCredential = isApiKeyMode
    ? isApiKeyOptional || Boolean(apiKey.trim())
    : isMembersMode || Boolean(credentialId)
  const hasSearchAccess =
    !isSearchIndex ||
    Boolean(
      connectorConfig?.search &&
        accessMode !== 'workspace' &&
        (!isMembersMode || allowMembers) &&
        (accessMode !== 'admin' || allowAdmin)
    )
  const canSubmit = Boolean(
    connectorConfig &&
      hasRequiredCredential &&
      (!showGitLabPermissions || gitlabPermissions.complete) &&
      hasSearchAccess &&
      (accessMode !== 'admin' || allowAdmin) &&
      (!isMembersMode || allowMembers) &&
      !slackSetupRequired &&
      connectorConfig.configFields.every(
        (field) =>
          !isConnectorFieldRequired(field, connectorConfig, accessMode) ||
          !isFieldVisible(field) ||
          hiddenCapFieldIds.has(field.id) ||
          config.isFieldPopulated(field)
      )
  )

  /** Creates the connector; a refusal rejects with the server's reason and keeps the draft. */
  async function submit(): Promise<ConnectorData | undefined> {
    if (!selectedType || !canSubmit) return undefined
    const resolved: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(config.resolveSourceConfig())) {
      if (hiddenCapFieldIds.has(key)) continue
      if (Array.isArray(value)) {
        if (value.length > 0) resolved[key] = value
      } else if (typeof value === 'string') {
        if (value) resolved[key] = value
      } else if (value !== undefined && value !== null) resolved[key] = value
    }
    if (disabledTagIds.size > 0) resolved.disabledTagIds = Array.from(disabledTagIds)
    if (Object.keys(config.canonicalModes).length > 0)
      resolved._canonicalModes = config.canonicalModes
    const connector = await createConnector.mutateAsync({
      knowledgeBaseId,
      connectorType: selectedType,
      ...(showGitLabPermissions ? { permissionConfig: gitlabPermissions.input } : {}),
      accessMode,
      ...(isApiKeyMode
        ? apiKey.trim()
          ? { apiKey }
          : {}
        : { credentialId: (isMembersMode ? contentCredentialId : credentialId) ?? undefined }),
      sourceConfig: resolved,
      syncIntervalMinutes: syncInterval,
    })
    clearDraft()
    gitlabPermissions.reset()
    setApiKey('')
    return connector
  }

  const term = searchTerm.toLowerCase().trim()
  const entries = isSearchIndex
    ? CONNECTOR_ENTRIES.filter(([, meta]) => meta.search)
    : CONNECTOR_ENTRIES
  const filteredEntries = term
    ? entries.filter(
        ([, meta]) =>
          meta.name.toLowerCase().includes(term) || meta.description.toLowerCase().includes(term)
      )
    : entries

  return {
    step,
    back,
    selectType,
    searchTerm,
    setSearchTerm,
    entries,
    filteredEntries,
    selectedType,
    connectorConfig,
    title,
    docsUrl,
    searchLabels,
    scope,
    canAdmin,
    hasMaxAccess,
    memberAccessAvailable,
    mirroredAccessAvailable,
    accessMode,
    setAccessMode,
    allowAdmin,
    allowMembers,
    isMembersMode,
    availability,
    slackSetupRequired,
    apiKeyConfig,
    apiKey,
    setApiKey,
    isApiKeyMode,
    setUseApiKey,
    providerId,
    credentials,
    rawCredentials,
    credentialsQuery,
    credentialId,
    setSelectedCredentialId,
    contentCredentialId,
    setContentCredentialId,
    canConnectOAuth,
    serviceAccount,
    showCredentialPicker,
    config,
    isFieldVisible,
    isOptionalSetupField,
    hasOptionalSetupFields,
    hiddenCapFieldIds,
    showGitLabPermissions,
    gitlabPermissions,
    disabledTagIds,
    setDisabledTagIds,
    showMore,
    setShowMore,
    syncInterval,
    setSyncInterval,
    creating: createConnector.isPending,
    canSubmit,
    submit,
    saveDraft,
    close,
  }
}
