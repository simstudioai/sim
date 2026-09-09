'use client'

import { useMemo, useState } from 'react'
import {
  ButtonGroup,
  ButtonGroupItem,
  Chip,
  ChipCombobox,
  ChipModalError,
  ChipModalField,
  type ComboboxOption,
} from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import type { ConnectorAccessMode } from '@/lib/api/contracts/knowledge/connectors'
import { type ResourceScope, resourceScopeFields } from '@/lib/core/resource-scope'
import {
  getProviderIdFromServiceId,
  getServiceAccountProviderForProviderId,
  type OAuthProvider,
} from '@/lib/oauth'
import type { SourceSelectionLabel, SourceSelectionLabels } from '@/lib/sim-search/source-identity'
import {
  ConnectServiceAccountModal,
  useServiceAccountConnectTarget,
} from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal'
import {
  ConnectorAccessField,
  type ConnectorAccessSelection,
  ConnectorContentCredentialField,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access-field'
import { ConnectorConfigFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-config-fields'
import {
  connectorSyncFrequencyHint,
  SYNC_INTERVALS,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/consts'
import { MaxBadge } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/max-badge'
import type {
  ConfigFieldMap,
  ConfigFieldValue,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { SettingsQueryErrorState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { isConnectorCredentialTypeAllowed } from '@/connectors/auth'
import type { ConnectorConfigField, ConnectorMeta } from '@/connectors/types'
import { useOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'
import { useCredentialRefreshTriggers } from '@/hooks/use-credential-refresh-triggers'

const SWITCH_NOTICE: Record<ConnectorAccessMode, string> = {
  workspace: 'Every workspace member can read every synced document once the next sync completes.',
  members:
    'Teammates are invited to connect their accounts. Documents become available after their next sync. Item limits are removed.',
  admin:
    'Documents become available after the next sync updates their source permissions. Item limits are removed.',
}

export interface ConnectorSettingsFieldsProps {
  availability: {
    error: Error | null
    isFetching: boolean
    refetch: () => unknown
  }
  isSearchIndex: boolean
  connectorConfig: ConnectorMeta | null
  selectionLabels: SourceSelectionLabels
  sourceConfig: ConfigFieldMap
  credentialId: string | null
  canonicalGroups: Map<string, ConnectorConfigField[]>
  canonicalModes: Record<string, 'basic' | 'advanced'>
  onToggleCanonicalMode: (canonicalId: string) => void
  onFieldChange: (
    fieldId: string,
    value: ConfigFieldValue,
    selectedOptions?: SourceSelectionLabel[]
  ) => void
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

export function ConnectorSettingsFields({
  availability,
  isSearchIndex,
  connectorConfig,
  sourceConfig,
  selectionLabels,
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
}: ConnectorSettingsFieldsProps) {
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
      (isSearchIndex || requiresServiceAccount) &&
      (serviceAccountProviderId === 'google-service-account' ||
        serviceAccountProviderId === 'atlassian-service-account')
        ? serviceAccountProviderId
        : undefined,
    serviceName: connectorConfig?.name,
    serviceIcon: connectorConfig?.icon,
  })
  const [showServiceAccountModal, setShowServiceAccountModal] = useState(false)
  const isContentCredentialChange = accessDirty && !accessModeChanged
  const {
    data: rawCredentials = [],
    isLoading: credentialsLoading,
    refetch: refetchCredentials,
  } = useOAuthCredentials(providerId ?? undefined, {
    enabled: (needsWorkspaceCredential || syncsPerMember) && Boolean(providerId),
    ...resourceScopeFields(scope),
  })
  useCredentialRefreshTriggers(refetchCredentials, providerId ?? '', scope)
  const [browseCredentialId, setBrowseCredentialId] = useState<string | null>(null)
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
      {availability.error && (
        <ChipModalField type='custom' title='Connection availability'>
          <SettingsQueryErrorState
            error={availability.error}
            isRetrying={availability.isFetching}
            fallback='Could not load connection availability'
            onRetry={() => void availability.refetch()}
            variant='inline'
          />
        </ChipModalField>
      )}
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
          atlassianProduct={connectorConfig?.id === 'confluence' ? 'confluence' : undefined}
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
          <ChipModalField type='custom' title='Account for browsing'>
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
          selectionLabels={selectionLabels}
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
