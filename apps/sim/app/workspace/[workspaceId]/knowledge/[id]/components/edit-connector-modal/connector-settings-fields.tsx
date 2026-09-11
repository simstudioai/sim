'use client'

import { useMemo, useState } from 'react'
import {
  Chip,
  ChipCombobox,
  ChipModalError,
  ChipModalField,
  ChipSelect,
  type ComboboxOption,
} from '@sim/emcn'
import { ChevronDown, ChevronRight, Plus } from '@sim/emcn/icons'
import type { ConnectorAccessMode } from '@/lib/api/contracts/knowledge/connectors'
import { type ResourceScope, resourceScopeFields } from '@/lib/core/resource-scope'
import {
  getProviderIdFromServiceId,
  getServiceAccountProviderForProviderId,
  type OAuthProvider,
} from '@/lib/oauth'
import { GITHUB_INSTALLATION_PROVIDER_ID } from '@/lib/oauth/github-installation-types'
import type { SourceSelectionLabel, SourceSelectionLabels } from '@/lib/sim-search/source-identity'
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
  connectorSyncFrequencyHint,
  SYNC_INTERVALS,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/consts'
import type {
  ConfigFieldMap,
  ConfigFieldValue,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { GitHubInstallationModal } from '@/app/workspace/[workspaceId]/search/components/github-installation-modal'
import { SettingsQueryErrorState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { isConnectorCredentialTypeAllowed } from '@/connectors/auth'
import { GitHubInstallationConnectionField } from '@/connectors/github/installation-connection-field'
import {
  GitLabPermissionTabs,
  GitLabPermissionUploads,
} from '@/connectors/gitlab/permission-config/fields'
import type { GitLabPermissionForm } from '@/connectors/gitlab/permission-config/use-permission-form'
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
  const isGitHubInstallationSource =
    usesGitHubInstallation &&
    isSearchIndex &&
    scope.kind === 'organization' &&
    connectorConfig?.id === 'github' &&
    syncsPerMember
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
  const [showGitHubInstallationModal, setShowGitHubInstallationModal] = useState(false)
  const [showMoreOptions, setShowMoreOptions] = useState(false)
  const isContentCredentialChange = accessDirty && !accessModeChanged
  const {
    data: rawCredentials = [],
    isLoading: credentialsLoading,
    isFetching: credentialsFetching,
    error: credentialsError,
    refetch: refetchCredentials,
  } = useOAuthCredentials(providerId ?? undefined, {
    enabled: (needsWorkspaceCredential || syncsPerMember) && Boolean(providerId),
    purpose: syncsPerMember ? 'browsing' : undefined,
    ...resourceScopeFields(scope),
  })
  useCredentialRefreshTriggers(refetchCredentials, providerId ?? '', scope)
  const [browseCredentialId, setBrowseCredentialId] = useState<string | null>(null)
  const selectorCredentialId = syncsPerMember ? browseCredentialId : credentialId
  const selectorCredential = rawCredentials.find((item) => item.id === selectorCredentialId)
  const installations = rawCredentials.filter(
    (credential) => credential.provider === GITHUB_INSTALLATION_PROVIDER_ID
  )
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

  const hiddenCapFieldIds = derivedAclCapFieldIds(connectorConfig, access.accessMode)
  const isOptionalSetupField = (field: ConnectorConfigField) =>
    Boolean(gitlabPermissions && connectorConfig) &&
    field.setupGroup === 'options' &&
    !isConnectorFieldRequired(field, connectorConfig!, access.accessMode)
  const configFieldsProps = connectorConfig
    ? {
        scope,
        accessMode: access.accessMode,
        connectorConfig,
        sourceConfig,
        selectionLabels,
        credentialId: selectorCredential?.id ?? null,
        credentialType: selectorCredential?.type,
        canonicalGroups,
        canonicalModes,
        onFieldChange,
        onToggleCanonicalMode,
        disabled: isSaving,
      }
    : null

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
          onConnect={() => setShowGitHubInstallationModal(true)}
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
      {connectorConfig && showAccessField && !isGitHubInstallationSource && (
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
                        ? isSearchIndex
                          ? requiresServiceAccount
                            ? 'Change service account'
                            : 'Change account'
                          : 'Change indexing account'
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
                        ? 'The next sync uses this account. Members keep their connected accounts and source permissions.'
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
                ? 'Used to browse available content. Each person connects separately from Integrations to sync their Search content.'
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

      <ChipModalError>{error}</ChipModalError>
      {showGitHubInstallationModal &&
        isGitHubInstallationSource &&
        scope.kind === 'organization' &&
        canAdmin && (
          <GitHubInstallationModal
            organizationId={scope.organizationId}
            onClose={() => setShowGitHubInstallationModal(false)}
            onConnected={(credentialId) => {
              onContentCredentialChange(credentialId)
              setShowGitHubInstallationModal(false)
            }}
          />
        )}
    </>
  )
}
