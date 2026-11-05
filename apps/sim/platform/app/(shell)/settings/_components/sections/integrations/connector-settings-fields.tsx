'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { resourceScopeFields } from '@/lib/core/resource-scope'
import { ConnectServiceAccountModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal'
import { BesideSurface } from '@/platform/app/(shell)/settings/_components/section-parts/beside-surface'
import {
  ActionRow,
  Muted,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import {
  ConnectorAccess,
  ConnectorConfigFields,
  ContentCredentialField,
  GitHubConnectionField,
  GitLabCsvUploads,
  GitLabTokenTabs,
} from '@/platform/app/(shell)/settings/_components/sections/integrations/connector-fields'
import {
  Button,
  Disclosure,
  FailureNotice,
  InlineNotice,
  SearchableSelect,
  SecretField,
} from '@/platform/design-system/components'
import {
  CONNECTOR_SWITCH_NOTICE,
  type ConnectorSettingsFieldsProps,
  useConnectorSettingsFields,
} from '@/platform/lib/data/sources'

/** The editable settings of an existing Search connection. Stored credentials are never returned. */
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
  const fields = useConnectorSettingsFields({
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
  const {
    configFieldsProps,
    connectorConfig,
    credentialOptions,
    credentialsLoading,
    githubSetup,
    hiddenCapFieldIds,
    installations,
    isContentCredentialChange,
    isGitHubInstallationSource,
    isOptionalSetupField,
    requiresServiceAccount,
    serviceAccountTarget,
    syncsPerMember,
  } = fields
  const canAddServiceAccount = serviceAccountTarget && !serviceAccountTarget.hidden && allowAdmin
  return (
    <>
      {gitlabPermissions && (
        <>
          <GitLabTokenTabs form={gitlabPermissions} disabled={isSaving || !canAdmin} />
          <SecretField
            label='Personal Access Token'
            value={gitlabPermissions.apiKey}
            onChange={gitlabPermissions.setApiKey}
            placeholder='Leave blank to keep the saved token'
            disabled={isSaving || !canAdmin}
          />
        </>
      )}
      {availability.error && (
        <FailureNotice
          title='Connection availability'
          message={getErrorMessage(availability.error, 'Could not load connection availability')}
          retrying={availability.isFetching}
          onRetry={() => void availability.refetch()}
        />
      )}
      {isGitHubInstallationSource && (
        <GitHubConnectionField
          installations={installations}
          credentialId={contentCredentialId}
          isLoading={credentialsLoading}
          isFetching={fields.credentialsFetching}
          error={fields.credentialsError}
          disabled={isSaving || !canAdmin}
          onRetry={() => void fields.refetchCredentials()}
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
            <ActionRow>
              <Button
                variant='primary'
                size='compact'
                onClick={onApplyAccess}
                disabled={!accessComplete || !contentCredentialId || isSaving || !canAdmin}
              >
                {isSwitchingAccess
                  ? 'Updating…'
                  : canReenableMemberSync
                    ? 'Re-enable sync'
                    : 'Change connection'}
              </Button>
              {accessDirty && (
                <Button size='compact' onClick={onResetAccess} disabled={isSaving}>
                  Cancel
                </Button>
              )}
            </ActionRow>
          )}
        </GitHubConnectionField>
      )}
      {!isGitHubInstallationSource &&
        syncsPerMember &&
        connectorConfig?.supportsSeparateContentCredential && (
          <ContentCredentialField
            credentialId={contentCredentialId}
            onChange={onContentCredentialChange}
            options={credentialOptions}
            loading={credentialsLoading}
            disabled={isSaving || !canAdmin}
          />
        )}
      {connectorConfig &&
        showAccessField &&
        !isGitHubInstallationSource &&
        !fields.hideFixedAccessMode && (
          <ConnectorAccess
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
                <>
                  <div>
                    <Button
                      variant='primary'
                      size='compact'
                      onClick={onApplyAccess}
                      disabled={!accessComplete || isSaving}
                    >
                      {isSwitchingAccess ? 'Re-enabling…' : 'Re-enable per-member sync'}
                    </Button>
                  </div>
                  <Muted>
                    Members and their documents are kept; the next sync restores their access.
                  </Muted>
                </>
              ) : accessDirty && (!isContentCredentialChange || syncsPerMember) ? (
                <>
                  <ActionRow>
                    <Button
                      variant='primary'
                      size='compact'
                      onClick={onApplyAccess}
                      disabled={!accessComplete || isSaving}
                    >
                      {isSwitchingAccess
                        ? 'Switching…'
                        : isContentCredentialChange
                          ? 'Change indexing account'
                          : 'Apply connection method'}
                    </Button>
                    <Button size='compact' onClick={onResetAccess} disabled={isSaving}>
                      {accessSetupHint ? 'Edit settings' : 'Cancel'}
                    </Button>
                  </ActionRow>
                  <Muted>
                    {accessSetupHint ??
                      (isContentCredentialChange
                        ? 'The next sync uses this account. Members keep their connected accounts and source permissions.'
                        : CONNECTOR_SWITCH_NOTICE[access.accessMode])}
                  </Muted>
                </>
              ) : undefined
            }
          />
        )}
      {connectorConfig && needsWorkspaceCredential && canAdmin && (
        <>
          <SearchableSelect
            label={
              isSearchIndex
                ? requiresServiceAccount
                  ? 'Service account'
                  : 'Account'
                : 'Indexing account'
            }
            searchLabel='Search accounts…'
            placeholder='Select the account to sync as'
            options={credentialOptions}
            value={workspaceCredentialId ?? credentialId}
            onValueChange={(value) => {
              if (value) onWorkspaceCredentialChange(value)
            }}
            createLabel={canAddServiceAccount ? serviceAccountTarget.label : undefined}
            onCreate={
              canAddServiceAccount ? () => fields.setShowServiceAccountModal(true) : undefined
            }
            disabled={isSaving || credentialsLoading}
            hint={
              !requiresServiceAccount && !credentialsLoading && credentialOptions.length === 0
                ? `Connect a ${connectorConfig.name} account in Integrations, then return here to select it.`
                : undefined
            }
          />
        </>
      )}
      {fields.showServiceAccountModal && serviceAccountTarget && canAdmin && (
        <BesideSurface>
          <ConnectServiceAccountModal
            atlassianProduct={connectorConfig?.id === 'confluence' ? 'confluence' : undefined}
            atlassianSetupGuideUrl={
              isSearchIndex && connectorConfig?.id === 'confluence' && connectorConfig.searchDocsUrl
                ? `${connectorConfig.searchDocsUrl}#using-a-service-account`
                : undefined
            }
            open
            onOpenChange={fields.setShowServiceAccountModal}
            {...resourceScopeFields(scope)}
            serviceAccountProviderId={serviceAccountTarget.serviceAccountProviderId}
            serviceName={serviceAccountTarget.serviceName}
            serviceIcon={serviceAccountTarget.serviceIcon}
            onCreated={onWorkspaceCredentialChange}
          />
        </BesideSurface>
      )}
      {connectorConfig &&
        !isGitHubInstallationSource &&
        syncsPerMember &&
        connectorConfig.configFields.some(
          (field) => field.type === 'selector' && isFieldVisible(field)
        ) && (
          <SearchableSelect
            label='Account for browsing'
            searchLabel='Search accounts…'
            placeholder={`Select your ${connectorConfig.name} account`}
            hint={
              isSearchIndex
                ? 'Members sync with their own accounts connected in Integrations.'
                : undefined
            }
            options={fields.rawCredentials.map((credential) => ({
              value: credential.id,
              label: credential.name || credential.provider,
            }))}
            value={fields.browseCredentialId}
            onValueChange={fields.setBrowseCredentialId}
            disabled={isSaving || credentialsLoading}
          />
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
        <GitLabCsvUploads form={gitlabPermissions} disabled={isSaving || !canAdmin} />
      )}
      {gitlabPermissions && configFieldsProps && (
        <Disclosure
          label='More options'
          open={fields.showMoreOptions}
          onOpenChange={fields.setShowMoreOptions}
        >
          <ConnectorConfigFields
            {...configFieldsProps}
            isFieldVisible={(field) =>
              isFieldVisible(field) &&
              !hiddenCapFieldIds.has(field.id) &&
              isOptionalSetupField(field)
            }
          />
        </Disclosure>
      )}
      <p role='status' data-visually-hidden>
        {saveBlockedReason}
      </p>
      {error && <InlineNotice intent='danger' message={error} />}
    </>
  )
}
