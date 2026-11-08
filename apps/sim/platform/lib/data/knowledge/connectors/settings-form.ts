'use client'

import { useMemo, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { isEqual } from 'es-toolkit'
import type {
  ConnectorAccessMode,
  UpdateConnectorBody,
} from '@/lib/api/contracts/knowledge/connectors'
import { resourceScopeFields } from '@/lib/core/resource-scope'
import { isContentEngineAccessMode } from '@/lib/knowledge/connectors/access-modes'
import { getProviderIdFromServiceId, type OAuthProvider } from '@/lib/oauth'
import { getConnectorAccessAvailability } from '@/lib/sim-search/connectors'
import { liveSearchSourceMeta } from '@/lib/sim-search/live/source-settings'
import { readSourceSelectionLabels, SOURCE_LABELS_KEY } from '@/lib/sim-search/source-identity'
import {
  derivedAclCapFieldIds,
  isConnectorFieldRequired,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access'
import {
  type ConfigFieldMap,
  useConnectorConfigFields,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { isConnectorCredentialTypeAllowed } from '@/connectors/auth'
import { useGitLabPermissionForm } from '@/connectors/gitlab/permission-config/use-permission-form'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import type { ConnectorConfigField } from '@/connectors/types'
import {
  type ConnectorData,
  isConnectorSyncingOrPending,
  useUpdateConnector,
  useUpdateConnectorAccess,
} from '@/hooks/queries/kb/connectors'
import { useOAuthCredentials } from '@/hooks/queries/oauth/credentials'
import { useCredentialRefreshTriggers } from '@/hooks/use-credential-refresh-triggers'
import {
  useConnectorAvailability,
  useConnectorScope,
} from '@/platform/lib/data/knowledge/connectors/scope'
import { connectorServiceAccount } from '@/platform/lib/data/knowledge/connectors/service-account'

/** Keys the sync engine or the form itself writes; nobody edits them as settings. */
const INTERNAL_CONFIG_KEYS = new Set([
  'tagSlotMapping',
  'disabledTagIds',
  '_canonicalModes',
  SOURCE_LABELS_KEY,
])
const CANONICAL_MODES_KEY = '_canonicalModes'

/** What a connection-method change does to document access, said before it is applied. */
export const CONNECTOR_SWITCH_NOTICE: Record<ConnectorAccessMode, string> = {
  workspace: 'Every workspace member can read every synced document once the next sync completes.',
  members:
    'Teammates are invited to connect their accounts. Documents become available after their next sync. Item limits are removed.',
  admin:
    'Documents become available after the next sync updates their source permissions. Item limits are removed.',
}

function storedAccessMode(connector: ConnectorData): ConnectorAccessMode {
  return connector.accessMode === 'members' || connector.accessMode === 'admin'
    ? connector.accessMode
    : 'workspace'
}

function readCanonicalModes(sourceConfig: Record<string, unknown>) {
  const raw = sourceConfig[CANONICAL_MODES_KEY]
  const modes: Record<string, 'basic' | 'advanced'> = {}
  if (!raw || typeof raw !== 'object') return modes
  for (const [key, value] of Object.entries(raw)) {
    if (value === 'basic' || value === 'advanced') modes[key] = value
  }
  return modes
}

function splitList(value: string) {
  return value.split(',').flatMap((part) => {
    const trimmed = part.trim()
    return trimmed ? [trimmed] : []
  })
}

/**
 * Equality for stored and edited values. Empty strings, empty lists and nothing are the same; a
 * list compares to a stored comma-separated string by its items, in any order, so opening a
 * connector saved before multi-select never shows unsaved changes.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  const empty = (value: unknown) =>
    value == null ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'string' && value.trim() === '')
  if (empty(a) && empty(b)) return true
  const list = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : typeof value === 'string'
        ? splitList(value)
        : []
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = list(a)
    const right = list(b)
    if (left.length !== right.length) return false
    const seen = new Set(left)
    return right.every((item) => seen.has(item))
  }
  if (typeof a === 'object' || typeof b === 'object') return isEqual(a, b)
  return a === b
}

function modesChanged(
  current: Record<string, 'basic' | 'advanced'>,
  stored: Record<string, 'basic' | 'advanced'>
) {
  for (const key of new Set([...Object.keys(stored), ...Object.keys(current)])) {
    if ((current[key] ?? 'basic') !== (stored[key] ?? 'basic')) return true
  }
  return false
}

interface ConnectorSettingsFormOptions {
  workspaceId: string
  knowledgeBaseId: string
  isSearchIndex: boolean
  connector: ConnectorData
  onSaved: () => void
}

/**
 * An existing connector's editable settings, as the legacy edit dialog keeps them: its configuration,
 * sync frequency and, for an administrator, its connection method and indexing account, which apply
 * on their own because they rewrite document access and start a sync.
 */
export function useConnectorSettingsForm({
  workspaceId,
  knowledgeBaseId,
  isSearchIndex,
  connector,
  onSaved,
}: ConnectorSettingsFormOptions) {
  const syncing = isConnectorSyncingOrPending(connector)
  const connectorConfig = liveSearchSourceMeta(
    CONNECTOR_META_REGISTRY[connector.connectorType] ?? null,
    isSearchIndex,
    { githubInstallation: false }
  )
  const [syncInterval, setSyncInterval] = useState(connector.syncIntervalMinutes)
  const [accessMode, setAccessMode] = useState<ConnectorAccessMode>(() =>
    storedAccessMode(connector)
  )
  const [workspaceCredentialId, setWorkspaceCredentialId] = useState<string | null>(null)
  const [contentCredentialId, setContentCredentialId] = useState<string | null>(
    connector.accessMode === 'members' ? connector.credentialId : null
  )
  const [browseCredentialId, setBrowseCredentialId] = useState<string | null>(null)
  const [showMore, setShowMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const gitlabPermissions = useGitLabPermissionForm(
    connector.permissionConfig ?? {
      provider: 'gitlab',
      mode: 'administrator',
      revision: 0,
      userMapping: null,
      projectPermissions: null,
    }
  )
  const showGitLabPermissions =
    connector.connectorType === 'gitlab' && connector.accessMode === 'admin'

  /** Seeded once from the stored config: both halves of a selector/manual pair share its value. */
  const [initialSourceConfig] = useState<ConfigFieldMap>(() => {
    const seeded: ConfigFieldMap = {}
    if (!connectorConfig) {
      for (const [key, value] of Object.entries(connector.sourceConfig)) {
        if (INTERNAL_CONFIG_KEYS.has(key)) continue
        seeded[key] = Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : String(value ?? '')
      }
      return seeded
    }
    for (const field of connectorConfig.configFields) {
      const canonicalId = field.canonicalParamId ?? field.id
      if (INTERNAL_CONFIG_KEYS.has(canonicalId)) continue
      const raw = connector.sourceConfig[canonicalId]
      if (raw === undefined) continue
      if (field.multi)
        seeded[field.id] = Array.isArray(raw)
          ? raw.filter((item): item is string => typeof item === 'string')
          : typeof raw === 'string'
            ? splitList(raw)
            : []
      else seeded[field.id] = String(raw ?? '')
    }
    return seeded
  })
  const [initialCanonicalModes] = useState(() => readCanonicalModes(connector.sourceConfig))
  const [initialSelectionLabels] = useState(() =>
    connectorConfig ? readSourceSelectionLabels(connectorConfig, connector.sourceConfig) : {}
  )
  const config = useConnectorConfigFields({
    connectorConfig,
    accessMode,
    initialSourceConfig,
    initialCanonicalModes,
    initialSelectionLabels,
  })

  const { scope, canAdmin, memberAccessAvailable, mirroredAccessAvailable, hasMaxAccess } =
    useConnectorScope(workspaceId)
  const updateConnector = useUpdateConnector()
  const updateAccess = useUpdateConnectorAccess()
  const saving = updateConnector.isPending || updateAccess.isPending
  const availability = useConnectorAvailability()
  const { admin: allowAdmin, members: allowMembers } = connectorConfig
    ? getConnectorAccessAvailability(connectorConfig, availability.integrationAvailability, {
        memberAccessAvailable,
        mirroredAccessAvailable,
        oauthServiceAvailability: availability.oauthServiceAvailability,
        isIntegrationAvailabilityReady: availability.isReady,
      })
    : { admin: false, members: false }
  const storedMode = storedAccessMode(connector)
  const docsUrl = isSearchIndex ? connectorConfig?.searchDocsUrl : undefined
  const searchSourceSupported = !isSearchIndex || connectorConfig?.search === true
  const searchAccessAllowed = !isSearchIndex || accessMode !== 'workspace'
  const searchSettingsAllowed =
    searchSourceSupported && (!isSearchIndex || storedMode !== 'workspace')
  const searchSetupError = !searchSourceSupported
    ? 'This source is not supported in Search. Use a separate knowledge base.'
    : !searchAccessAllowed
      ? 'Choose Member accounts or Admin or service account for Search.'
      : null
  /** Permission-scoped settings stay visible after their feature is turned off. */
  const showAccessField =
    memberAccessAvailable || mirroredAccessAvailable || storedMode !== 'workspace'

  const accessModeChanged = storedMode !== accessMode
  const accessDirty =
    accessModeChanged ||
    (isContentEngineAccessMode(accessMode) &&
      workspaceCredentialId !== null &&
      workspaceCredentialId !== connector.credentialId) ||
    (accessMode === 'members' &&
      contentCredentialId !== (connector.accessMode === 'members' ? connector.credentialId : null))
  const accountChanged = accessDirty && !accessModeChanged && isContentEngineAccessMode(accessMode)
  const isContentCredentialChange = accessDirty && !accessModeChanged
  /** Credential selection, for a mode change and for an administrator recovering a credential. */
  const needsWorkspaceCredential =
    connectorConfig?.auth.mode === 'oauth' &&
    isContentEngineAccessMode(accessMode) &&
    (storedMode === 'members' ||
      !isConnectorCredentialTypeAllowed(connectorConfig.auth, accessMode, 'oauth'))
  const missingAdminField =
    accessDirty && accessMode === 'admin' && connectorConfig
      ? connectorConfig.configFields.find((field) => {
          const stored = accessModeChanged ? connector.sourceConfig : config.resolveSourceConfig()
          const value = stored[field.canonicalParamId ?? field.id]
          return (
            !field.required &&
            isConnectorFieldRequired(field, connectorConfig, 'admin') &&
            (typeof value !== 'string' || !value.trim())
          )
        })
      : undefined
  const accessSetupHint = missingAdminField
    ? `Set ${missingAdminField.title} and save your settings before changing the connection method.`
    : undefined
  const accessComplete =
    searchSourceSupported &&
    searchAccessAllowed &&
    !missingAdminField &&
    (accessMode === 'workspace' || (accessMode === 'members' ? allowMembers : allowAdmin)) &&
    (!accessDirty || !needsWorkspaceCredential || Boolean(workspaceCredentialId))
  /** A disabled member sync is re-enabled by applying the current binding again. */
  const canReenableMemberSync =
    !isSearchIndex &&
    !accessDirty &&
    connector.accessMode === 'members' &&
    connector.memberSyncStatus === 'disabled'
  const hiddenCapFieldIds = derivedAclCapFieldIds(connectorConfig, accessMode)
  const settingsComplete = Boolean(
    connectorConfig?.configFields.every(
      (field) =>
        !isConnectorFieldRequired(field, connectorConfig, storedMode) ||
        !config.isFieldVisible(field) ||
        hiddenCapFieldIds.has(field.id) ||
        config.isFieldPopulated(field)
    )
  )
  const storedCanonicalModes = useMemo(
    () => readCanonicalModes(connector.sourceConfig),
    [connector.sourceConfig]
  )
  const resolved = config.resolveSourceConfig()
  const hasChanges =
    (showGitLabPermissions && gitlabPermissions.dirty) ||
    syncInterval !== connector.syncIntervalMinutes ||
    modesChanged(config.canonicalModes, storedCanonicalModes) ||
    Object.entries(resolved).some(
      ([key, value]) =>
        !hiddenCapFieldIds.has(key) && !valuesEqual(connector.sourceConfig[key], value)
    )

  const providerId =
    connectorConfig?.auth.mode === 'oauth'
      ? (getProviderIdFromServiceId(connectorConfig.auth.provider) as OAuthProvider)
      : null
  const syncsPerMember = accessMode === 'members'
  const requiresServiceAccount = Boolean(
    connectorConfig && !isConnectorCredentialTypeAllowed(connectorConfig.auth, accessMode, 'oauth')
  )
  const serviceAccount =
    canAdmin && allowAdmin
      ? connectorServiceAccount({
          connectorConfig,
          providerId,
          offered: isSearchIndex || requiresServiceAccount,
          docsUrl,
        })
      : null
  const credentialsQuery = useOAuthCredentials(providerId ?? undefined, {
    enabled: (needsWorkspaceCredential || syncsPerMember) && Boolean(providerId),
    purpose: syncsPerMember ? 'browsing' : undefined,
    ...resourceScopeFields(scope),
  })
  useCredentialRefreshTriggers(credentialsQuery.refetch, providerId ?? '', scope)
  const rawCredentials = credentialsQuery.data ?? []
  const selectorCredentialId = syncsPerMember
    ? browseCredentialId
    : (workspaceCredentialId ?? connector.credentialId)
  const selectorCredential = rawCredentials.find((item) => item.id === selectorCredentialId)
  const credentialOptions = rawCredentials
    .filter(
      (credential) =>
        !connectorConfig ||
        isConnectorCredentialTypeAllowed(connectorConfig.auth, accessMode, credential.type)
    )
    .map((credential) => ({ label: credential.name || credential.provider, value: credential.id }))
  const hideFixedAccessMode = isSearchIndex && needsWorkspaceCredential && canAdmin && allowAdmin
  const isOptionalSetupField = (field: ConnectorConfigField) =>
    Boolean(
      showGitLabPermissions &&
        connectorConfig &&
        field.setupGroup === 'options' &&
        !isConnectorFieldRequired(field, connectorConfig, accessMode)
    )

  const blockedBySync = syncing && (hasChanges || accountChanged)
  const saveBlockedReason = blockedBySync
    ? 'Wait for the current sync to finish before saving.'
    : undefined
  const canSave =
    (hasChanges || accountChanged) &&
    (!accessDirty || (accountChanged && accessComplete)) &&
    !syncing &&
    !saving &&
    searchSettingsAllowed &&
    settingsComplete &&
    (!showGitLabPermissions || gitlabPermissions.complete)

  /**
   * Saves the settings. A refusal rejects with the server's reason, which the dialog shows while
   * keeping the edits; `error` stays for the connection-method change, which has no dialog of its own.
   */
  async function save() {
    if (!canSave) return
    setError(null)
    const updates: UpdateConnectorBody = {}
    if (showGitLabPermissions && gitlabPermissions.dirty) {
      updates.permissionConfig = gitlabPermissions.input
      if (gitlabPermissions.apiKey.trim()) updates.apiKey = gitlabPermissions.apiKey
    }
    if (syncInterval !== connector.syncIntervalMinutes) updates.syncIntervalMinutes = syncInterval
    const changed: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(resolved)) {
      if (hiddenCapFieldIds.has(key)) continue
      if (!valuesEqual(connector.sourceConfig[key], value)) changed[key] = value
    }
    if (
      Object.keys(changed).length > 0 ||
      modesChanged(config.canonicalModes, storedCanonicalModes)
    ) {
      const next: Record<string, unknown> = { ...connector.sourceConfig, ...changed }
      if (Object.keys(config.canonicalModes).length > 0)
        next[CANONICAL_MODES_KEY] = config.canonicalModes
      else delete next[CANONICAL_MODES_KEY]
      if (next[SOURCE_LABELS_KEY] === null) delete next[SOURCE_LABELS_KEY]
      updates.sourceConfig = next
    }
    if (accountChanged) {
      await updateAccess.mutateAsync({
        knowledgeBaseId,
        connectorId: connector.id,
        access: {
          accessMode,
          credentialId: workspaceCredentialId ?? connector.credentialId,
          sourceConfig: updates.sourceConfig,
          syncIntervalMinutes: updates.syncIntervalMinutes,
        },
      })
    } else if (Object.keys(updates).length > 0) {
      const updated = await updateConnector.mutateAsync({
        knowledgeBaseId,
        connectorId: connector.id,
        updates,
      })
      gitlabPermissions.reset(updated.permissionConfig)
    }
    onSaved()
  }

  /** Applies a connection-method change, or re-enables a disabled member sync. */
  async function applyAccess() {
    if (!accessComplete) return
    setError(null)
    try {
      await updateAccess.mutateAsync({
        knowledgeBaseId,
        connectorId: connector.id,
        access:
          accessMode === 'members'
            ? { accessMode: 'members', credentialId: contentCredentialId }
            : {
                accessMode,
                credentialId: workspaceCredentialId ?? connector.credentialId ?? undefined,
              },
      })
      onSaved()
    } catch (failure) {
      setError(getErrorMessage(failure, 'The connection could not be changed.'))
    }
  }

  function resetAccess() {
    setAccessMode(storedAccessMode(connector))
    setWorkspaceCredentialId(null)
    setContentCredentialId(connector.accessMode === 'members' ? connector.credentialId : null)
  }

  return {
    connectorConfig,
    docsUrl,
    scope,
    canAdmin,
    hasMaxAccess,
    config,
    hiddenCapFieldIds,
    isOptionalSetupField,
    showMore,
    setShowMore,
    syncInterval,
    setSyncInterval,
    accessMode,
    setAccessMode,
    showAccessField,
    hideFixedAccessMode,
    allowAdmin,
    allowMembers,
    availability,
    accessDirty,
    accessModeChanged,
    accessComplete,
    accessSetupHint,
    isContentCredentialChange,
    canReenableMemberSync,
    switchingAccess: updateAccess.isPending,
    applyAccess,
    resetAccess,
    syncsPerMember,
    requiresServiceAccount,
    serviceAccount,
    needsWorkspaceCredential,
    workspaceCredentialId,
    setWorkspaceCredentialId,
    contentCredentialId,
    setContentCredentialId,
    browseCredentialId,
    setBrowseCredentialId,
    selectorCredentialId: selectorCredential?.id ?? null,
    selectorCredentialType: selectorCredential?.type,
    credentialOptions,
    rawCredentials,
    credentialsQuery,
    showGitLabPermissions,
    gitlabPermissions,
    error: error ?? searchSetupError,
    saving,
    saveBlockedReason,
    canSave,
    save,
  }
}
