'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { isEqual } from 'es-toolkit'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { isContentEngineAccessMode } from '@/lib/knowledge/connectors/access-modes'
import { getConnectorAccessAvailability } from '@/lib/sim-search/connectors'
import { readSourceSelectionLabels, SOURCE_LABELS_KEY } from '@/lib/sim-search/source-identity'
import {
  derivedAclCapFieldIds,
  isConnectorFieldRequired,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access'
import type { ConnectorAccessSelection } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access-field'
import type { ConnectorSettingsFieldsProps } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/connector-settings-fields'
import {
  type ConfigFieldMap,
  useConnectorConfigFields,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { useConnectorScope } from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-scope'
import { isConnectorCredentialTypeAllowed } from '@/connectors/auth'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import {
  type ConnectorData,
  useUpdateConnector,
  useUpdateConnectorAccess,
} from '@/hooks/queries/kb/connectors'
import { usePermissionConfig } from '@/hooks/use-permission-config'

const logger = createLogger('ConnectorSettingsForm')

/** Keys injected by the sync engine or modal state — not user-editable */
const INTERNAL_CONFIG_KEYS = new Set([
  'tagSlotMapping',
  'disabledTagIds',
  '_canonicalModes',
  SOURCE_LABELS_KEY,
])

const CANONICAL_MODES_KEY = '_canonicalModes'

function currentAccess(connector: ConnectorData): ConnectorAccessSelection {
  if (connector.accessMode === 'members') return { accessMode: 'members' }
  if (connector.accessMode === 'admin') return { accessMode: 'admin' }
  return { accessMode: 'workspace' }
}

function readPersistedCanonicalModes(
  sourceConfig: Record<string, unknown>
): Record<string, 'basic' | 'advanced'> {
  const raw = sourceConfig[CANONICAL_MODES_KEY]
  if (!raw || typeof raw !== 'object') return {}
  const result: Record<string, 'basic' | 'advanced'> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === 'basic' || value === 'advanced') result[key] = value
  }
  return result
}

/**
 * Equality for sourceConfig values, including serialized source-label metadata.
 *
 * Empty string, empty array, and nullish are treated as equivalent to absence.
 * When either side is an array (multi-value field), both sides are normalized
 * to string[] via CSV-split-and-trim so a persisted legacy scalar `"ENG"`
 * compares equal to an in-memory `["ENG"]` and a persisted CSV `"ENG,PROJ"`
 * compares equal to `["ENG","PROJ"]`. Without this, opening edit on a
 * pre-multi-select connector would falsely show unsaved changes.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  const isEmpty = (v: unknown): boolean => {
    if (v == null) return true
    if (Array.isArray(v)) return v.length === 0
    if (typeof v === 'string') return v.trim() === ''
    return false
  }
  if (isEmpty(a) && isEmpty(b)) return true

  const toArray = (v: unknown): string[] | null => {
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
    if (typeof v === 'string') {
      return v.split(',').flatMap((s) => {
        const t = s.trim()
        return t ? [t] : []
      })
    }
    return null
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    const arrA = toArray(a) ?? []
    const arrB = toArray(b) ?? []
    if (arrA.length !== arrB.length) return false
    /**
     * Order-insensitive: the multi-select UI does not guarantee insertion order
     * matches the server-returned order, so `["PROD","ENG"]` and `["ENG","PROD"]`
     * should be treated as equal to avoid a false unsaved-changes state.
     */
    const setA = new Set(arrA)
    return arrB.every((v) => setA.has(v))
  }
  if (typeof a === 'object' || typeof b === 'object') return isEqual(a, b)
  return a === b
}

function didCanonicalModesChange(
  current: Record<string, 'basic' | 'advanced'>,
  persisted: Record<string, 'basic' | 'advanced'>
): boolean {
  const keys = new Set([...Object.keys(persisted), ...Object.keys(current)])
  for (const key of keys) {
    if ((current[key] ?? 'basic') !== (persisted[key] ?? 'basic')) return true
  }
  return false
}

interface UseConnectorSettingsFormOptions {
  scope?: ResourceScope
  knowledgeBaseId: string
  isSearchIndex?: boolean
  connector: ConnectorData
  onSaved: (connector: ConnectorData) => void
}

/** Editable connector settings shared by the source page and knowledge-base modal. */
export function useConnectorSettingsForm({
  scope: explicitScope,
  knowledgeBaseId,
  isSearchIndex = false,
  connector,
  onSaved,
}: UseConnectorSettingsFormOptions) {
  const connectorConfig = CONNECTOR_META_REGISTRY[connector.connectorType] ?? null

  const [syncInterval, setSyncInterval] = useState(connector.syncIntervalMinutes)
  const [access, setAccess] = useState<ConnectorAccessSelection>(() => currentAccess(connector))
  const [workspaceCredentialId, setWorkspaceCredentialId] = useState<string | null>(null)
  const [contentCredentialId, setContentCredentialId] = useState<string | null>(
    connector.accessMode === 'members' ? connector.credentialId : null
  )
  const [error, setError] = useState<string | null>(null)

  /**
   * Seeds from the stored canonical config. For canonical-pair fields (selector +
   * manual input), both field IDs get the same value so toggling preserves it.
   * Captured once on mount; editing state is owned by the hook afterward.
   */
  const [initialSourceConfig] = useState<ConfigFieldMap>(() => {
    const config: ConfigFieldMap = {}
    if (!connectorConfig) {
      for (const [key, value] of Object.entries(connector.sourceConfig)) {
        if (INTERNAL_CONFIG_KEYS.has(key)) continue
        if (Array.isArray(value)) {
          config[key] = value.filter((v): v is string => typeof v === 'string')
        } else {
          config[key] = String(value ?? '')
        }
      }
      return config
    }
    for (const field of connectorConfig.configFields) {
      const canonicalId = field.canonicalParamId ?? field.id
      if (INTERNAL_CONFIG_KEYS.has(canonicalId)) continue
      const rawValue = connector.sourceConfig[canonicalId]
      if (rawValue === undefined) continue
      if (field.multi) {
        if (Array.isArray(rawValue)) {
          config[field.id] = rawValue.filter((v): v is string => typeof v === 'string')
        } else if (typeof rawValue === 'string') {
          config[field.id] = rawValue.split(',').flatMap((s) => {
            const t = s.trim()
            return t ? [t] : []
          })
        } else {
          config[field.id] = []
        }
      } else {
        config[field.id] = String(rawValue ?? '')
      }
    }
    return config
  })

  const [initialCanonicalModes] = useState<Record<string, 'basic' | 'advanced'>>(() =>
    readPersistedCanonicalModes(connector.sourceConfig)
  )
  const [initialSelectionLabels] = useState(() =>
    connectorConfig ? readSourceSelectionLabels(connectorConfig, connector.sourceConfig) : {}
  )

  const {
    sourceConfig,
    selectionLabels,
    canonicalModes,
    canonicalGroups,
    isFieldVisible,
    isFieldPopulated,
    handleFieldChange,
    toggleCanonicalMode,
    resolveSourceConfig,
  } = useConnectorConfigFields({
    connectorConfig,
    accessMode: access.accessMode,
    initialSourceConfig,
    initialCanonicalModes,
    initialSelectionLabels,
  })

  const { scope, canAdmin, memberAccessAvailable, mirroredAccessAvailable, hasMaxAccess } =
    useConnectorScope(explicitScope)
  const { mutate: updateConnector, isPending: isSavingSettings } = useUpdateConnector()
  const { mutate: updateAccess, isPending: isSwitchingAccess } = useUpdateConnectorAccess()
  const isSaving = isSavingSettings || isSwitchingAccess
  const {
    integrationAvailability,
    oauthServiceAvailability,
    isIntegrationAvailabilityReady,
    isIntegrationAvailabilityFetching,
    integrationAvailabilityError,
    refetchIntegrationAvailability,
  } = usePermissionConfig()
  const { admin: allowAdmin, members: allowMembers } = connectorConfig
    ? getConnectorAccessAvailability(connectorConfig, integrationAvailability, {
        memberAccessAvailable,
        mirroredAccessAvailable,
        oauthServiceAvailability,
        isIntegrationAvailabilityReady,
      })
    : { admin: false, members: false }
  const persistedAccess = currentAccess(connector)
  const docsUrl = isSearchIndex ? connectorConfig?.searchDocsUrl : undefined
  const searchSourceSupported = !isSearchIndex || connectorConfig?.search === true
  const searchAccessAllowed = !isSearchIndex || access.accessMode !== 'workspace'
  const searchSettingsAllowed =
    searchSourceSupported && (!isSearchIndex || persistedAccess.accessMode !== 'workspace')
  const searchSetupError = !searchSourceSupported
    ? 'This source is not supported in Search. Use a separate knowledge base.'
    : !searchAccessAllowed
      ? 'Choose Member accounts or Admin or service account for Search.'
      : null
  /** Keep existing permission-scoped settings visible after their feature is disabled. */
  const showAccessField =
    memberAccessAvailable || mirroredAccessAvailable || persistedAccess.accessMode !== 'workspace'

  const accessModeChanged = persistedAccess.accessMode !== access.accessMode
  const accessDirty =
    accessModeChanged ||
    (isContentEngineAccessMode(access.accessMode) &&
      workspaceCredentialId !== null &&
      workspaceCredentialId !== connector.credentialId) ||
    (access.accessMode === 'members' &&
      contentCredentialId !== (connector.accessMode === 'members' ? connector.credentialId : null))
  /** Exposes credential selection for mode changes and administrator credential recovery. */
  const needsWorkspaceCredential =
    connectorConfig?.auth.mode === 'oauth' &&
    isContentEngineAccessMode(access.accessMode) &&
    (persistedAccess.accessMode === 'members' ||
      !isConnectorCredentialTypeAllowed(connectorConfig.auth, access.accessMode, 'oauth'))
  const missingAdminField =
    accessDirty && access.accessMode === 'admin'
      ? connectorConfig?.configFields.find((field) => {
          const value = connector.sourceConfig[field.id]
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
    (access.accessMode === 'workspace' ||
      (access.accessMode === 'members' ? allowMembers : allowAdmin)) &&
    (!accessDirty || !needsWorkspaceCredential || Boolean(workspaceCredentialId))
  /** A disabled member sync is re-enabled by applying the current binding again. */
  const canReenableMemberSync =
    !accessDirty && connector.accessMode === 'members' && connector.memberSyncStatus === 'disabled'
  const hiddenCapFieldIds = derivedAclCapFieldIds(connectorConfig, access.accessMode)
  const settingsComplete = connectorConfig?.configFields.every(
    (field) =>
      !isConnectorFieldRequired(field, connectorConfig, persistedAccess.accessMode) ||
      !isFieldVisible(field) ||
      hiddenCapFieldIds.has(field.id) ||
      isFieldPopulated(field)
  )

  const persistedCanonicalModes = useMemo(
    () => readPersistedCanonicalModes(connector.sourceConfig),
    [connector.sourceConfig]
  )

  const hasChanges =
    syncInterval !== connector.syncIntervalMinutes ||
    didCanonicalModesChange(canonicalModes, persistedCanonicalModes) ||
    Object.entries(resolveSourceConfig()).some(
      ([key, value]) =>
        !hiddenCapFieldIds.has(key) && !valuesEqual(connector.sourceConfig[key], value)
    )

  const handleSave = useCallback(() => {
    if (!searchSettingsAllowed || !settingsComplete || accessDirty) return
    setError(null)

    const updates: { sourceConfig?: Record<string, unknown>; syncIntervalMinutes?: number } = {}

    if (syncInterval !== connector.syncIntervalMinutes) {
      updates.syncIntervalMinutes = syncInterval
    }

    const resolved = resolveSourceConfig()
    const changedEntries: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(resolved)) {
      if (hiddenCapFieldIds.has(key)) continue
      if (!valuesEqual(connector.sourceConfig[key], value)) changedEntries[key] = value
    }

    const modesChanged = didCanonicalModesChange(canonicalModes, persistedCanonicalModes)

    if (Object.keys(changedEntries).length > 0 || modesChanged) {
      const next: Record<string, unknown> = { ...connector.sourceConfig, ...changedEntries }
      if (Object.keys(canonicalModes).length > 0) {
        next[CANONICAL_MODES_KEY] = canonicalModes
      } else {
        delete next[CANONICAL_MODES_KEY]
      }
      if (next[SOURCE_LABELS_KEY] === null) delete next[SOURCE_LABELS_KEY]
      updates.sourceConfig = next
    }

    if (Object.keys(updates).length === 0) {
      onSaved(connector)
      return
    }

    updateConnector(
      { knowledgeBaseId, connectorId: connector.id, updates },
      {
        onSuccess: onSaved,
        onError: (err) => {
          logger.error('Failed to update connector', { error: err.message })
          setError(err.message)
        },
      }
    )
  }, [
    searchSettingsAllowed,
    settingsComplete,
    accessDirty,
    syncInterval,
    connector,
    resolveSourceConfig,
    canonicalModes,
    persistedCanonicalModes,
    hiddenCapFieldIds,
    onSaved,
    updateConnector,
    knowledgeBaseId,
  ])

  /**
   * The mode switch is its own admin operation: it rewrites document access
   * and queues a run of the other engine, so it is applied on its own rather
   * than folded into a settings save that would race the run it starts.
   */
  const handleApplyAccess = useCallback(() => {
    if (!accessComplete) return
    setError(null)
    updateAccess(
      {
        knowledgeBaseId,
        connectorId: connector.id,
        access:
          access.accessMode === 'members'
            ? {
                accessMode: 'members',
                credentialId: contentCredentialId,
              }
            : {
                accessMode: access.accessMode,
                credentialId: workspaceCredentialId ?? connector.credentialId ?? undefined,
              },
      },
      {
        onSuccess: onSaved,
        onError: (err) => {
          logger.error('Failed to switch connector access', { error: err.message })
          setError(err.message)
        },
      }
    )
  }, [
    accessComplete,
    updateAccess,
    knowledgeBaseId,
    connector,
    access.accessMode,
    contentCredentialId,
    workspaceCredentialId,
    onSaved,
  ])

  const handleResetAccess = useCallback(() => {
    setAccess(currentAccess(connector))
    setWorkspaceCredentialId(null)
    setContentCredentialId(connector.accessMode === 'members' ? connector.credentialId : null)
  }, [connector])

  const fieldsProps: ConnectorSettingsFieldsProps = {
    availability: {
      error: integrationAvailabilityError,
      isFetching: isIntegrationAvailabilityFetching,
      refetch: refetchIntegrationAvailability,
    },
    isSearchIndex,
    connectorConfig,
    sourceConfig,
    selectionLabels,
    credentialId: connector.credentialId,
    canonicalGroups,
    canonicalModes,
    onToggleCanonicalMode: toggleCanonicalMode,
    onFieldChange: handleFieldChange,
    isFieldVisible: (field) => isFieldVisible(field) && !hiddenCapFieldIds.has(field.id),
    syncInterval,
    setSyncInterval,
    hasMaxAccess,
    isSaving,
    error: error ?? searchSetupError,
    access,
    onAccessChange: setAccess,
    canAdmin,
    showAccessField,
    allowMembers,
    allowAdmin,
    allowWorkspace: !isSearchIndex,
    canReenableMemberSync,
    accessDirty,
    accessModeChanged,
    accessComplete,
    accessSetupHint,
    isSwitchingAccess,
    onApplyAccess: handleApplyAccess,
    onResetAccess: handleResetAccess,
    contentCredentialId,
    onContentCredentialChange: setContentCredentialId,
    scope,
    needsWorkspaceCredential,
    workspaceCredentialId,
    onWorkspaceCredentialChange: setWorkspaceCredentialId,
  }

  return {
    displayName: connectorConfig?.name ?? connector.connectorType,
    icon: connectorConfig?.icon,
    docsUrl,
    dirty: hasChanges || accessDirty,
    saving: isSaving,
    canSave:
      hasChanges && !accessDirty && !isSaving && searchSettingsAllowed && Boolean(settingsComplete),
    save: handleSave,
    fieldsProps,
  }
}
