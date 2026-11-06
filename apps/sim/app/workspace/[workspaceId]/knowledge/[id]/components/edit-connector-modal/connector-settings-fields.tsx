'use client'

import { Chip, ChipCombobox, ChipModalError, ChipModalField, ChipSelect } from '@sim/emcn'
import { ChevronDown, ChevronRight, Plus } from '@sim/emcn/icons'
import { type ResourceScope, resourceScopeFields } from '@/lib/core/resource-scope'
import type { SourceSelectionLabel, SourceSelectionLabels } from '@/lib/sim-search/source-identity'
import { ConnectServiceAccountModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal'
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
import {
  CONNECTOR_SWITCH_NOTICE,
  useConnectorSettingsFields,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/use-connector-settings-fields'
import type {
  ConfigFieldMap,
  ConfigFieldValue,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { SettingsQueryErrorState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { GitHubInstallationConnectionField } from '@/connectors/github/installation-connection-field'
import {
  GitLabPermissionTabs,
  GitLabPermissionUploads,
} from '@/connectors/gitlab/permission-config/fields'
import type { GitLabPermissionForm } from '@/connectors/gitlab/permission-config/use-permission-form'
import type { ConnectorConfigField, ConnectorMeta } from '@/connectors/types'

export interface ConnectorSettingsFieldsProps {
  gitlabPermissions?: GitLabPermissionForm
  availability: {
    error: Error | null
    isFetching: boolean
    isReady: boolean
    refetch: () => unknown
  }
  isSearchIndex: boolean
  usesGitHubInstallation?: boolean
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
  saveBlockedReason?: string
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
  gitlabPermissions,
  availability,
  isSearchIndex,
  usesGitHubInstallation = false,
  connectorConfig: originalConfig,
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
  saveBlockedReason,
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
  const {
    browseCredentialId,
    configFieldsProps,
    connectorConfig,
    credentialOptions,
    credentialsError,
    credentialsFetching,
    credentialsLoading,
    githubSetup,
    hiddenCapFieldIds,
    hideFixedAccessMode,
    installations,
    isContentCredentialChange,
    isGitHubInstallationSource,
    isOptionalSetupField,
    rawCredentials,
    refetchCredentials,
    requiresServiceAccount,
    serviceAccountTarget,
    setBrowseCredentialId,
    setShowMoreOptions,
    setShowServiceAccountModal,
    showMoreOptions,
    showServiceAccountModal,
    syncsPerMember,
  } = useConnectorSettingsFields({
    gitlabPermissions,
    isSearchIndex,
    usesGitHubInstallation,
    connectorConfig: originalConfig,
    sourceConfig,
    selectionLabels,
    credentialId,
    canonicalGroups,
    canonicalModes,
    onToggleCanonicalMode,
    onFieldChange,
    isSaving,
    access,
    canAdmin,
    allowAdmin,
    accessDirty,
    accessModeChanged,
    scope,
    needsWorkspaceCredential,
    workspaceCredentialId,
    contentCredentialId,
    onContentCredentialChange,
  })

  return (
    <>
      {gitlabPermissions && (
        <>
          <GitLabPermissionTabs form={gitlabPermissions} disabled={isSaving || !canAdmin} />
          <ChipModalField
            type='input'
            title='Personal Access Token'
            value={gitlabPermissions.apiKey}
            onChange={gitlabPermissions.setApiKey}
            inputType='password'
            placeholder='Leave blank to keep the saved token'
            disabled={isSaving || !canAdmin}
          />
        </>
      )}
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
      {isGitHubInstallationSource && (
        <GitHubInstallationConnectionField
          installations={installations}
          credentialId={contentCredentialId}
          isLoading={credentialsLoading}
          isFetching={credentialsFetching}
          error={credentialsError}
          disabled={isSaving || !canAdmin}
          onRetry={() => void refetchCredentials()}
          onConnect={() => void githubSetup.connect(installations.length ? 'install' : undefined)}
          connecting={githubSetup.pending}
          connectionError={githubSetup.error}
          hint={
            accessDirty
              ? 'Keeps the current repository. To add another repository, add a new source.'
              : undefined
          }
          onCancel={githubSetup.cancel}
          onCheckConnection={() => void githubSetup.checkConnection()}
          isChecking={githubSetup.isChecking}
          onChange={onContentCredentialChange}
        >
          {(accessDirty || canReenableMemberSync) && (
            <div className='flex items-center gap-2'>
              <Chip
                variant='primary'
                onClick={onApplyAccess}
                disabled={!accessComplete || !contentCredentialId || isSaving || !canAdmin}
              >
                {isSwitchingAccess
                  ? 'Updating…'
                  : canReenableMemberSync
                    ? 'Re-enable sync'
                    : 'Change connection'}
              </Chip>
              {accessDirty && (
                <Chip onClick={onResetAccess} disabled={isSaving}>
                  Cancel
                </Chip>
              )}
            </div>
          )}
        </GitHubInstallationConnectionField>
      )}
      {!isGitHubInstallationSource &&
        syncsPerMember &&
        connectorConfig?.supportsSeparateContentCredential && (
          <ConnectorContentCredentialField
            credentialId={contentCredentialId}
            onChange={onContentCredentialChange}
            options={credentialOptions}
            isLoading={credentialsLoading}
            disabled={isSaving || !canAdmin}
          />
        )}
      {connectorConfig &&
        showAccessField &&
        !isGitHubInstallationSource &&
        !hideFixedAccessMode && (
          <ConnectorAccessField
            scope={scope}
            connectorConfig={connectorConfig}
            value={access}
            onChange={onAccessChange}
            canAdmin={canAdmin}
            lockAccessMode={isSearchIndex}
            isAvailabilityReady={availability.isReady}
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
              ) : accessDirty && (!isContentCredentialChange || syncsPerMember) ? (
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
                        ? 'The next sync uses this account. Members keep their connected accounts and source permissions.'
                        : CONNECTOR_SWITCH_NOTICE[access.accessMode])}
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
            isSearchIndex
              ? requiresServiceAccount
                ? 'Service account'
                : 'Account'
              : 'Indexing account'
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
          atlassianSetupGuideUrl={
            isSearchIndex && connectorConfig?.id === 'confluence' && connectorConfig.searchDocsUrl
              ? `${connectorConfig.searchDocsUrl}#using-a-service-account`
              : undefined
          }
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
        !isGitHubInstallationSource &&
        syncsPerMember &&
        connectorConfig.configFields.some(
          (field) => field.type === 'selector' && isFieldVisible(field)
        ) && (
          <ChipModalField
            type='custom'
            title='Account for browsing'
            hint={
              isSearchIndex
                ? 'Members sync with their own accounts connected in Integrations.'
                : undefined
            }
          >
            <ChipCombobox
              options={rawCredentials.map((credential) => ({
                label: credential.name || credential.provider,
                value: credential.id,
              }))}
              value={browseCredentialId ?? undefined}
              onChange={setBrowseCredentialId}
              placeholder={`Select your ${connectorConfig.name} account`}
              isLoading={credentialsLoading}
              disabled={isSaving}
            />
          </ChipModalField>
        )}

      {configFieldsProps && (
        <ConnectorConfigFields
          {...configFieldsProps}
          isFieldVisible={(field) =>
            isFieldVisible(field) &&
            !hiddenCapFieldIds.has(field.id) &&
            !isOptionalSetupField(field)
          }
        />
      )}

      {gitlabPermissions && (
        <GitLabPermissionUploads form={gitlabPermissions} disabled={isSaving || !canAdmin} />
      )}

      {gitlabPermissions && (
        <>
          <div className='px-2'>
            <Chip
              type='button'
              leftIcon={showMoreOptions ? ChevronDown : ChevronRight}
              aria-expanded={showMoreOptions}
              onClick={() => setShowMoreOptions((visible) => !visible)}
            >
              More options
            </Chip>
          </div>
          {showMoreOptions && configFieldsProps && (
            <ConnectorConfigFields
              {...configFieldsProps}
              isFieldVisible={(field) =>
                isFieldVisible(field) &&
                !hiddenCapFieldIds.has(field.id) &&
                isOptionalSetupField(field)
              }
            />
          )}
        </>
      )}

      {!isSearchIndex && (!gitlabPermissions || showMoreOptions) && (
        <ChipModalField
          type='custom'
          title='Sync Frequency'
          hint={
            gitlabPermissions?.mode === 'csv'
              ? undefined
              : connectorSyncFrequencyHint(
                  access.accessMode,
                  syncInterval,
                  Boolean(contentCredentialId)
                )
          }
        >
          <ChipSelect
            fullWidth
            dropdownWidth='trigger'
            aria-label='Sync frequency'
            value={String(syncInterval)}
            onChange={(value) => setSyncInterval(Number(value))}
            options={SYNC_INTERVALS.map((interval) => ({
              value: String(interval.value),
              label:
                interval.requiresMax && !hasMaxAccess ? `${interval.label} (Max)` : interval.label,
              disabled: interval.requiresMax && !hasMaxAccess,
            }))}
          />
        </ChipModalField>
      )}

      <p role='status' className='sr-only'>
        {saveBlockedReason}
      </p>
      <ChipModalError>{error}</ChipModalError>
    </>
  )
}
