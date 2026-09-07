'use client'

import { useMemo, useState } from 'react'
import {
  ButtonGroup,
  ButtonGroupItem,
  Chip,
  ChipCombobox,
  ChipLink,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipModalTabs,
  type ComboboxOption,
  Skeleton,
  Tooltip,
} from '@sim/emcn'
import { Plus, RefreshCw, SquareArrowUpRight } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import type { ConnectorAccessMode } from '@/lib/api/contracts/knowledge/connectors'
import { type ResourceScope, resourceScopeFields } from '@/lib/core/resource-scope'
import { isContentEngineAccessMode } from '@/lib/knowledge/connectors/access-modes'
import {
  getProviderIdFromServiceId,
  getServiceAccountProviderForProviderId,
  type OAuthProvider,
} from '@/lib/oauth'
import { getConnectorAccessAvailability } from '@/lib/sim-search/connectors'
import {
  ConnectServiceAccountModal,
  useServiceAccountConnectTarget,
} from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal'
import {
  derivedAclCapFieldIds,
  isConnectorFieldRequired,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access'
import {
  ConnectorAccessField,
  type ConnectorAccessSelection,
  ConnectorContentCredentialField,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access-field'
import { ConnectorConfigFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-config-fields'
import {
  BROWSE_WITH_HINT,
  connectorSyncFrequencyHint,
  SYNC_INTERVALS,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/consts'
import { MaxBadge } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/max-badge'
import type {
  ConfigFieldMap,
  ConfigFieldValue,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { useConnectorConfigFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { useConnectorScope } from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-scope'
import { SettingsQueryErrorState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { withBrandIcon } from '@/blocks/brand-icon'
import { isConnectorCredentialTypeAllowed } from '@/connectors/auth'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import type { ConnectorConfigField, ConnectorMeta } from '@/connectors/types'
import type { ConnectorData } from '@/hooks/queries/kb/connectors'
import {
  useConnectorDocuments,
  useExcludeConnectorDocument,
  useRestoreConnectorDocument,
  useUpdateConnector,
  useUpdateConnectorAccess,
} from '@/hooks/queries/kb/connectors'
import { useOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'
import { usePermissionConfig } from '@/hooks/use-permission-config'

const logger = createLogger('EditConnectorModal')

const SWITCH_NOTICE: Record<ConnectorAccessMode, string> = {
  workspace: 'Every workspace member can read every synced document once the next sync completes.',
  members:
    'Teammates are invited to connect their accounts. Documents become available after their next sync. Item limits are removed.',
  admin:
    'Documents become available after the next sync updates their source permissions. Item limits are removed.',
}

/** Keys injected by the sync engine or modal state — not user-editable */
const INTERNAL_CONFIG_KEYS = new Set(['tagSlotMapping', 'disabledTagIds', '_canonicalModes'])

const CANONICAL_MODES_KEY = '_canonicalModes'

/** The access a connector row currently has, as the Access field edits it. */
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
 * Deep equality for sourceConfig values (string, string[], or undefined/null).
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

interface EditConnectorModalProps {
  scope?: ResourceScope
  open: boolean
  onOpenChange: (open: boolean) => void
  knowledgeBaseId: string
  isSearchIndex?: boolean
  connector: ConnectorData
}

export function EditConnectorModal({
  open,
  onOpenChange,
  knowledgeBaseId,
  isSearchIndex = false,
  connector,
  scope: explicitScope,
}: EditConnectorModalProps) {
  const connectorConfig = CONNECTOR_META_REGISTRY[connector.connectorType] ?? null

  const [activeTab, setActiveTab] = useState('settings')
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

  const {
    sourceConfig,
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

  const hasChanges = useMemo(() => {
    if (syncInterval !== connector.syncIntervalMinutes) return true
    if (didCanonicalModesChange(canonicalModes, persistedCanonicalModes)) return true
    const resolved = resolveSourceConfig()
    for (const [key, value] of Object.entries(resolved)) {
      if (!valuesEqual(connector.sourceConfig[key], value)) return true
    }
    return false
  }, [
    resolveSourceConfig,
    syncInterval,
    connector.syncIntervalMinutes,
    connector.sourceConfig,
    canonicalModes,
    persistedCanonicalModes,
  ])

  const handleSave = () => {
    if (!searchSettingsAllowed || !settingsComplete || accessDirty) return
    setError(null)

    const updates: { sourceConfig?: Record<string, unknown>; syncIntervalMinutes?: number } = {}

    if (syncInterval !== connector.syncIntervalMinutes) {
      updates.syncIntervalMinutes = syncInterval
    }

    const resolved = resolveSourceConfig()
    const changedEntries: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(resolved)) {
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
      updates.sourceConfig = next
    }

    if (Object.keys(updates).length === 0) {
      onOpenChange(false)
      return
    }

    updateConnector(
      { knowledgeBaseId, connectorId: connector.id, updates },
      {
        onSuccess: () => onOpenChange(false),
        onError: (err) => {
          logger.error('Failed to update connector', { error: err.message })
          setError(err.message)
        },
      }
    )
  }

  /**
   * The mode switch is its own admin operation: it rewrites document access
   * and queues a run of the other engine, so it is applied on its own rather
   * than folded into a settings save that would race the run it starts.
   */
  const handleApplyAccess = () => {
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
        /** The connector prop is a snapshot; closing hands the refreshed row to the next open. */
        onSuccess: () => onOpenChange(false),
        onError: (err) => {
          logger.error('Failed to switch connector access', { error: err.message })
          setError(err.message)
        },
      }
    )
  }

  const displayName = connectorConfig?.name ?? connector.connectorType
  const Icon = connectorConfig?.icon

  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle={`Edit ${displayName}`}
      size='md'
      dismissDisabled={isSaving}
    >
      <ChipModalHeader icon={Icon ? withBrandIcon(Icon) : null} onClose={() => onOpenChange(false)}>
        Edit {displayName}
      </ChipModalHeader>

      <ChipModalBody>
        {integrationAvailabilityError && (
          <ChipModalField type='custom' title='Connection availability'>
            <SettingsQueryErrorState
              error={integrationAvailabilityError}
              isRetrying={isIntegrationAvailabilityFetching}
              fallback='Could not load connection availability'
              onRetry={() => void refetchIntegrationAvailability()}
              variant='inline'
            />
          </ChipModalField>
        )}
        <ChipModalTabs
          tabs={[
            { value: 'settings', label: 'Settings' },
            { value: 'documents', label: 'Documents' },
          ]}
          value={activeTab}
          onChange={setActiveTab}
          className='mx-2'
        />

        {activeTab === 'settings' ? (
          <SettingsTab
            isSearchIndex={isSearchIndex}
            connectorConfig={connectorConfig}
            sourceConfig={sourceConfig}
            credentialId={connector.credentialId}
            canonicalGroups={canonicalGroups}
            canonicalModes={canonicalModes}
            onToggleCanonicalMode={toggleCanonicalMode}
            onFieldChange={handleFieldChange}
            isFieldVisible={(field) => isFieldVisible(field) && !hiddenCapFieldIds.has(field.id)}
            syncInterval={syncInterval}
            setSyncInterval={setSyncInterval}
            hasMaxAccess={hasMaxAccess}
            isSaving={isSaving}
            error={error ?? searchSetupError}
            access={access}
            onAccessChange={setAccess}
            canAdmin={canAdmin}
            showAccessField={showAccessField}
            allowMembers={allowMembers}
            allowAdmin={allowAdmin}
            allowWorkspace={!isSearchIndex}
            canReenableMemberSync={canReenableMemberSync}
            accessDirty={accessDirty}
            accessModeChanged={accessModeChanged}
            accessComplete={accessComplete}
            accessSetupHint={accessSetupHint}
            isSwitchingAccess={isSwitchingAccess}
            onApplyAccess={handleApplyAccess}
            onResetAccess={() => {
              setAccess(currentAccess(connector))
              setWorkspaceCredentialId(null)
              setContentCredentialId(
                connector.accessMode === 'members' ? connector.credentialId : null
              )
            }}
            contentCredentialId={contentCredentialId}
            onContentCredentialChange={setContentCredentialId}
            scope={scope}
            needsWorkspaceCredential={needsWorkspaceCredential}
            workspaceCredentialId={workspaceCredentialId}
            onWorkspaceCredentialChange={setWorkspaceCredentialId}
          />
        ) : (
          <DocumentsTab knowledgeBaseId={knowledgeBaseId} connectorId={connector.id} />
        )}
      </ChipModalBody>

      {activeTab === 'settings' && (
        <ChipModalFooter
          onCancel={() => onOpenChange(false)}
          secondaryActions={
            docsUrl
              ? [
                  {
                    label: 'Setup guide',
                    onClick: () => window.open(docsUrl, '_blank', 'noopener,noreferrer'),
                  },
                ]
              : undefined
          }
          primaryAction={{
            label: isSaving ? 'Saving…' : 'Save',
            onClick: handleSave,
            /** An open access change is applied by its own control, never folded into Save. */
            disabled:
              !hasChanges || accessDirty || isSaving || !searchSettingsAllowed || !settingsComplete,
          }}
        />
      )}
    </ChipModal>
  )
}

interface SettingsTabProps {
  isSearchIndex: boolean
  connectorConfig: ConnectorMeta | null
  /** The mode the connector is saved in, which the draft `access` may differ from. */
  sourceConfig: ConfigFieldMap
  credentialId: string | null
  canonicalGroups: Map<string, ConnectorConfigField[]>
  canonicalModes: Record<string, 'basic' | 'advanced'>
  onToggleCanonicalMode: (canonicalId: string) => void
  onFieldChange: (fieldId: string, value: ConfigFieldValue) => void
  isFieldVisible: (field: ConnectorConfigField) => boolean
  syncInterval: number
  setSyncInterval: (v: number) => void
  hasMaxAccess: boolean
  isSaving: boolean
  error: string | null
  access: ConnectorAccessSelection
  onAccessChange: (access: ConnectorAccessSelection) => void
  canAdmin: boolean
  showAccessField: boolean
  allowMembers: boolean
  allowAdmin: boolean
  allowWorkspace: boolean
  canReenableMemberSync: boolean
  accessDirty: boolean
  accessModeChanged: boolean
  accessComplete: boolean
  accessSetupHint?: string
  isSwitchingAccess: boolean
  onApplyAccess: () => void
  onResetAccess: () => void
  scope: ResourceScope
  needsWorkspaceCredential: boolean
  workspaceCredentialId: string | null
  contentCredentialId: string | null
  onContentCredentialChange: (credentialId: string | null) => void
  onWorkspaceCredentialChange: (credentialId: string) => void
}

function SettingsTab({
  isSearchIndex,
  connectorConfig,
  sourceConfig,
  credentialId,
  canonicalGroups,
  canonicalModes,
  onToggleCanonicalMode,
  onFieldChange,
  isFieldVisible,
  syncInterval,
  setSyncInterval,
  hasMaxAccess,
  isSaving,
  error,
  access,
  onAccessChange,
  canAdmin,
  showAccessField,
  allowMembers,
  allowAdmin,
  allowWorkspace,
  canReenableMemberSync,
  accessDirty,
  accessModeChanged,
  accessComplete,
  accessSetupHint,
  isSwitchingAccess,
  onApplyAccess,
  onResetAccess,
  scope,
  needsWorkspaceCredential,
  workspaceCredentialId,
  contentCredentialId,
  onContentCredentialChange,
  onWorkspaceCredentialChange,
}: SettingsTabProps) {
  const providerId =
    connectorConfig?.auth.mode === 'oauth'
      ? (getProviderIdFromServiceId(connectorConfig.auth.provider) as OAuthProvider)
      : null
  const syncsPerMember = access.accessMode === 'members'
  const requiresServiceAccount = Boolean(
    connectorConfig &&
      !isConnectorCredentialTypeAllowed(connectorConfig.auth, access.accessMode, 'oauth')
  )
  const serviceAccountProviderId = providerId
    ? getServiceAccountProviderForProviderId(providerId)
    : undefined
  const serviceAccountTarget = useServiceAccountConnectTarget({
    serviceAccountProviderId:
      requiresServiceAccount &&
      (serviceAccountProviderId === 'google-service-account' ||
        serviceAccountProviderId === 'atlassian-service-account')
        ? serviceAccountProviderId
        : undefined,
    serviceName: connectorConfig?.name,
    serviceIcon: connectorConfig?.icon,
  })
  const [showServiceAccountModal, setShowServiceAccountModal] = useState(false)
  const isContentCredentialChange = accessDirty && !accessModeChanged
  const { data: rawCredentials = [], isLoading: credentialsLoading } = useOAuthCredentials(
    providerId ?? undefined,
    {
      enabled: (needsWorkspaceCredential || syncsPerMember) && Boolean(providerId),
      ...resourceScopeFields(scope),
    }
  )
  const [browseCredentialId, setBrowseCredentialId] = useState<string | null>(null)
  /** A per-member connector has no credential of its own; the admin's account browses the source. */
  const selectorCredentialId = syncsPerMember ? browseCredentialId : credentialId
  const credentialOptions = useMemo<ComboboxOption[]>(
    () =>
      rawCredentials
        .filter(
          (credential) =>
            !connectorConfig ||
            isConnectorCredentialTypeAllowed(
              connectorConfig.auth,
              access.accessMode,
              credential.type
            )
        )
        .map((credential) => ({
          label: credential.name || credential.provider,
          value: credential.id,
        })),
    [rawCredentials, connectorConfig, access.accessMode]
  )

  return (
    <>
      {syncsPerMember && connectorConfig?.supportsSeparateContentCredential && (
        <ConnectorContentCredentialField
          credentialId={contentCredentialId}
          onChange={onContentCredentialChange}
          options={credentialOptions}
          isLoading={credentialsLoading}
          disabled={isSaving || !canAdmin}
        />
      )}
      {connectorConfig && showAccessField && (
        <ConnectorAccessField
          scope={scope}
          connectorConfig={connectorConfig}
          value={access}
          onChange={onAccessChange}
          canAdmin={canAdmin}
          allowMembers={allowMembers}
          allowAdmin={allowAdmin}
          allowWorkspace={allowWorkspace}
          disabled={isSaving}
          footer={
            canReenableMemberSync ? (
              <div className='flex flex-col gap-2'>
                <div>
                  <Chip
                    variant='primary'
                    onClick={onApplyAccess}
                    disabled={!accessComplete || isSaving}
                  >
                    {isSwitchingAccess ? 'Re-enabling…' : 'Re-enable per-member sync'}
                  </Chip>
                </div>
                <p className='text-[var(--text-muted)] text-caption leading-snug'>
                  Members and their documents are kept; the next sync restores their access.
                </p>
              </div>
            ) : accessDirty ? (
              <div className='flex flex-col gap-2'>
                <div className='flex items-center gap-2'>
                  <Chip
                    variant='primary'
                    onClick={onApplyAccess}
                    disabled={!accessComplete || isSaving}
                  >
                    {isSwitchingAccess
                      ? 'Switching…'
                      : isContentCredentialChange
                        ? 'Change indexing account'
                        : 'Apply connection method'}
                  </Chip>
                  <Chip onClick={onResetAccess} disabled={isSaving}>
                    {accessSetupHint ? 'Edit settings' : 'Cancel'}
                  </Chip>
                </div>
                <p className='text-[var(--text-muted)] text-caption leading-snug'>
                  {accessSetupHint ??
                    (isContentCredentialChange
                      ? syncsPerMember
                        ? 'The next sync uses this indexing account. Members keep their connected accounts and source permissions.'
                        : 'The next sync uses this account and refreshes source permissions.'
                      : SWITCH_NOTICE[access.accessMode])}
                </p>
              </div>
            ) : undefined
          }
        />
      )}

      {connectorConfig && needsWorkspaceCredential && canAdmin && (
        <ChipModalField
          type='custom'
          title={
            isConnectorCredentialTypeAllowed(connectorConfig.auth, access.accessMode, 'oauth')
              ? 'Indexing account'
              : 'Service account'
          }
          hint={
            !requiresServiceAccount && !credentialsLoading && credentialOptions.length === 0
              ? `Connect a ${connectorConfig.name} account in Integrations, then return here to select it.`
              : undefined
          }
        >
          <ChipCombobox
            options={[
              ...credentialOptions,
              ...(serviceAccountTarget && !serviceAccountTarget.hidden && allowAdmin
                ? [
                    {
                      label: serviceAccountTarget.label,
                      value: '__service_account__',
                      icon: Plus,
                      onSelect: () => setShowServiceAccountModal(true),
                    },
                  ]
                : []),
            ]}
            value={workspaceCredentialId ?? credentialId ?? undefined}
            onChange={onWorkspaceCredentialChange}
            placeholder='Select the account to sync as'
            isLoading={credentialsLoading}
            disabled={isSaving}
          />
        </ChipModalField>
      )}

      {showServiceAccountModal && serviceAccountTarget && canAdmin && (
        <ConnectServiceAccountModal
          open
          onOpenChange={setShowServiceAccountModal}
          {...resourceScopeFields(scope)}
          serviceAccountProviderId={serviceAccountTarget.serviceAccountProviderId}
          serviceName={serviceAccountTarget.serviceName}
          serviceIcon={serviceAccountTarget.serviceIcon}
          onCreated={onWorkspaceCredentialChange}
        />
      )}

      {connectorConfig &&
        syncsPerMember &&
        connectorConfig.configFields.some(
          (field) => field.type === 'selector' && isFieldVisible(field)
        ) && (
          <ChipModalField type='custom' title='Browse with' hint={BROWSE_WITH_HINT}>
            <ChipCombobox
              options={credentialOptions}
              value={browseCredentialId ?? undefined}
              onChange={setBrowseCredentialId}
              placeholder={`Select your ${connectorConfig.name} account`}
              isLoading={credentialsLoading}
              disabled={isSaving}
            />
          </ChipModalField>
        )}

      {connectorConfig && (
        <ConnectorConfigFields
          scope={scope}
          accessMode={access.accessMode}
          connectorConfig={connectorConfig}
          sourceConfig={sourceConfig}
          credentialId={selectorCredentialId}
          canonicalGroups={canonicalGroups}
          canonicalModes={canonicalModes}
          isFieldVisible={isFieldVisible}
          onFieldChange={onFieldChange}
          onToggleCanonicalMode={onToggleCanonicalMode}
          disabled={isSaving}
        />
      )}

      {!isSearchIndex && (
        <ChipModalField
          type='custom'
          title='Sync Frequency'
          hint={connectorSyncFrequencyHint(
            access.accessMode,
            syncInterval,
            Boolean(contentCredentialId)
          )}
        >
          <ButtonGroup
            value={String(syncInterval)}
            onValueChange={(val) => setSyncInterval(Number(val))}
          >
            {SYNC_INTERVALS.map((interval) => (
              <ButtonGroupItem
                key={interval.value}
                value={String(interval.value)}
                disabled={interval.requiresMax && !hasMaxAccess}
              >
                {interval.label}
                {interval.requiresMax && !hasMaxAccess && <MaxBadge />}
              </ButtonGroupItem>
            ))}
          </ButtonGroup>
        </ChipModalField>
      )}

      <ChipModalError>{error}</ChipModalError>
    </>
  )
}

interface DocumentsTabProps {
  knowledgeBaseId: string
  connectorId: string
}

function DocumentsTab({ knowledgeBaseId, connectorId }: DocumentsTabProps) {
  const [filter, setFilter] = useState<'active' | 'excluded'>('active')

  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useConnectorDocuments(
    knowledgeBaseId,
    connectorId,
    {
      includeExcluded: true,
    }
  )

  const { mutate: excludeDoc, isPending: isExcluding } = useExcludeConnectorDocument()
  const { mutate: restoreDoc, isPending: isRestoring } = useRestoreConnectorDocument()

  const documents = useMemo(() => {
    const loadedDocuments = data?.pages.flatMap((page) => page.documents) ?? []
    return loadedDocuments.filter((document) =>
      filter === 'excluded' ? document.userExcluded : !document.userExcluded
    )
  }, [data?.pages, filter])

  const counts = data?.pages[0]?.counts ?? { active: 0, excluded: 0 }
  const visibleDocumentCount = filter === 'excluded' ? counts.excluded : counts.active
  const hasMoreVisibleDocuments = Boolean(hasNextPage && documents.length < visibleDocumentCount)

  if (isLoading) {
    return (
      <div className='flex flex-col gap-2 px-2'>
        <Skeleton className='h-7 w-[180px] rounded-md' />
        <Skeleton className='h-[30px] w-full rounded-lg' />
        <Skeleton className='h-[30px] w-full rounded-lg' />
        <Skeleton className='h-[30px] w-full rounded-lg' />
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3 px-2'>
      <ButtonGroup value={filter} onValueChange={(val) => setFilter(val as 'active' | 'excluded')}>
        <ButtonGroupItem value='active'>Active ({counts.active})</ButtonGroupItem>
        <ButtonGroupItem value='excluded'>Excluded ({counts.excluded})</ButtonGroupItem>
      </ButtonGroup>

      <div className='max-h-[320px] min-h-0 overflow-y-auto [scrollbar-gutter:stable]'>
        {visibleDocumentCount === 0 ? (
          <p className='rounded-lg bg-[var(--surface-3)] px-3 py-8 text-center text-[var(--text-muted)] text-small'>
            {filter === 'excluded' ? 'No excluded documents' : 'No documents yet'}
          </p>
        ) : (
          <div className='flex flex-col gap-0.5 pr-1'>
            {documents.map((doc) => (
              <div
                key={doc.id}
                className='flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors hover-hover:bg-[var(--surface-active)]'
              >
                <div className='flex min-w-0 items-center gap-1.5'>
                  <span className='truncate text-[var(--text-primary)] text-small'>
                    {doc.filename}
                  </span>
                  {doc.sourceUrl && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <ChipLink
                          href={doc.sourceUrl}
                          target='_blank'
                          rel='noopener noreferrer'
                          leftIcon={SquareArrowUpRight}
                          aria-label='Open source document'
                        />
                      </Tooltip.Trigger>
                      <Tooltip.Content>Open source document</Tooltip.Content>
                    </Tooltip.Root>
                  )}
                </div>
                <Chip
                  leftIcon={doc.userExcluded ? RefreshCw : undefined}
                  className='shrink-0'
                  disabled={doc.userExcluded ? isRestoring : isExcluding}
                  onClick={() =>
                    doc.userExcluded
                      ? restoreDoc({ knowledgeBaseId, connectorId, documentIds: [doc.id] })
                      : excludeDoc({ knowledgeBaseId, connectorId, documentIds: [doc.id] })
                  }
                >
                  {doc.userExcluded ? 'Restore' : 'Exclude'}
                </Chip>
              </div>
            ))}
            {hasMoreVisibleDocuments && (
              <Chip fullWidth disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
                {isFetchingNextPage ? 'Loading…' : 'Load more documents'}
              </Chip>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
