'use client'

import { getErrorMessage } from '@sim/utils/errors'
import type { ConnectorData } from '@/lib/api/contracts/knowledge/connectors'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { getCanonicalScopesForProvider } from '@/lib/oauth'
import { ConnectOAuthModal } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal'
import { ConnectServiceAccountModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal'
import { useAddConnectorForm } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/add-connector-modal/use-add-connector-form'
import {
  Button,
  Checkbox,
  Disclosure,
  FailureNotice,
  InlineNotice,
  SearchableSelect,
  SelectField,
} from '@/platform/design-system/components'
import { SettingsSection } from '@/platform/design-system/components/settings-section/settings-section'
import { BesideSurface } from '@/platform/embedded/app/(shell)/settings/_components/section-parts/beside-surface'
import {
  ActionRow,
  DetailHeader,
  FieldStack,
  FormFieldset,
  Muted,
  SectionStack,
} from '@/platform/embedded/app/(shell)/settings/_components/section-parts/section-parts'
import { ApiKeyField } from '@/platform/embedded/app/(shell)/settings/_components/sections/integrations/api-key-field'
import { ConnectorAccess } from '@/platform/embedded/app/(shell)/settings/_components/sections/integrations/connector-access'
import { ConnectorConfigFields } from '@/platform/embedded/app/(shell)/settings/_components/sections/integrations/connector-config-fields'
import { ContentCredentialField } from '@/platform/embedded/app/(shell)/settings/_components/sections/integrations/content-credential-field'
import { GitHubConnectionField } from '@/platform/embedded/app/(shell)/settings/_components/sections/integrations/github-connection-field'
import {
  GitLabCsvUploads,
  GitLabTokenTabs,
} from '@/platform/embedded/app/(shell)/settings/_components/sections/integrations/gitlab-fields'

interface SourceSetupFormProps {
  scope: Extract<ResourceScope, { kind: 'organization' }>
  knowledgeBaseId: string
  connectorType: string
  accessMode: 'members' | 'admin'
  draftKey: string
  backLabel: string
  onClose: () => void
  onCreated: (connectorType: string, connector: ConnectorData) => void
}

/** A new Search connection, on a page so its credential dialogs have nothing to fight for focus. */
export function SourceSetupForm({
  scope,
  knowledgeBaseId,
  connectorType,
  accessMode,
  draftKey,
  backLabel,
  onClose,
  onCreated,
}: SourceSetupFormProps) {
  const form = useAddConnectorForm({
    onOpenChange: (open) => {
      if (!open) onClose()
    },
    knowledgeBaseId,
    scope,
    isSearchIndex: true,
    initialConnectorType: connectorType,
    initialAccessMode: accessMode,
    lockConnectorType: true,
    lockedAccessMode: accessMode,
    setupDraftKey: draftKey,
    onCreated,
  })
  const {
    access,
    apiKeyConfig,
    connectorConfig,
    configFieldsProps,
    connectableServiceAccount,
    credentials,
    credentialsError,
    credentialsFetching,
    credentialsLoading,
    githubSetup,
    gitlabPermissions,
    hiddenCapFieldIds,
    installationCredentialId,
    installations,
    isApiKeyMode,
    isCreating,
    isFieldVisible,
    isIntegrationAvailabilityReady,
    isMembersMode,
    isOptionalSetupField,
    owner,
    rawCredentials,
    searchLabels,
    showGitLabPermissions,
    slackSetupRequired,
  } = form
  if (!connectorConfig) return null
  const accountOptions = credentials.map((credential) => ({
    value: credential.id,
    label: credential.name || credential.provider,
  }))
  const connectNew = form.canConnectOAuth
    ? credentials.length > 0
      ? `Connect another ${connectorConfig.name} account`
      : `Connect ${connectorConfig.name} account`
    : undefined
  const failedAccounts = credentialsError && rawCredentials.length === 0
  const retryAccounts = (
    <FailureNotice
      message={getErrorMessage(credentialsError, 'Could not load accounts')}
      retrying={credentialsFetching}
      onRetry={() => void form.refetchCredentials()}
    />
  )
  const contentCredentialField =
    !form.canSetUpGitHubInstallation &&
    isMembersMode &&
    connectorConfig.supportsSeparateContentCredential ? (
      <>
        <ContentCredentialField
          credentialId={form.contentCredentialId}
          onChange={form.setContentCredentialId}
          options={accountOptions}
          loading={credentialsLoading}
          disabled={isCreating}
        />
        <ActionRow>
          {form.canConnectOAuth && (
            <Button size='compact' onClick={form.connectOAuth}>
              {`Connect ${connectorConfig.name} account`}
            </Button>
          )}
          {connectableServiceAccount && (
            <Button size='compact' onClick={() => form.setServiceAccountField('content')}>
              {connectableServiceAccount.label}
            </Button>
          )}
        </ActionRow>
        {!form.showCredentialPicker && failedAccounts && retryAccounts}
      </>
    ) : null
  const hasOptions =
    form.hasOptionalSetupFields ||
    contentCredentialField ||
    Boolean(connectorConfig.tagDefinitions?.length)
  const lockedUnavailable =
    isIntegrationAvailabilityReady &&
    !form.integrationAvailabilityError &&
    !(accessMode === 'admin' ? form.allowAdmin : form.allowMembers)
  const submitLabel = isCreating
    ? isMembersMode
      ? 'Creating…'
      : 'Connecting…'
    : isMembersMode
      ? (searchLabels?.add ?? 'Add connection')
      : 'Save connection'
  return (
    <SectionStack>
      <DetailHeader
        backLabel={backLabel}
        onBack={() => form.closeSetup(false)}
        title={form.modalTitle}
      >
        {form.docsUrl && (
          <Button
            variant='quiet'
            size='compact'
            render={
              <a href={form.docsUrl} target='_blank' rel='noopener noreferrer'>
                Setup guide
              </a>
            }
          >
            Setup guide
          </Button>
        )}
      </DetailHeader>
      <FormFieldset disabled={isCreating}>
        <SettingsSection title='Connection'>
          <FieldStack>
            {showGitLabPermissions && (
              <GitLabTokenTabs form={gitlabPermissions} disabled={isCreating} />
            )}
            {form.integrationAvailabilityError && (
              <FailureNotice
                message={getErrorMessage(
                  form.integrationAvailabilityError,
                  'Could not load connection availability'
                )}
                retrying={form.isIntegrationAvailabilityFetching}
                onRetry={() => void form.refetchIntegrationAvailability()}
              />
            )}
            {!form.canSetUpGitHubInstallation &&
              slackSetupRequired &&
              (form.memberAccessAvailable ||
                form.mirroredAccessAvailable ||
                slackSetupRequired) && (
                <ConnectorAccess
                  scope={scope}
                  connectorConfig={connectorConfig}
                  value={access}
                  onChange={form.setAccess}
                  canAdmin={form.canAdmin}
                  allowMembers={form.allowMembers}
                  allowAdmin={form.allowAdmin}
                  allowWorkspace={false}
                  disabled={isCreating}
                  searchSetupSource={connectorType === 'slack' ? 'slack' : undefined}
                  slackSetupOnly
                  onSetupNavigate={form.saveSetup}
                />
              )}
            {!slackSetupRequired && (
              <>
                {connectorConfig.auth.mode === 'oauth' && apiKeyConfig && !isMembersMode && (
                  <SelectField
                    label='Authentication'
                    disabled={isCreating}
                    value={isApiKeyMode ? 'apiKey' : 'oauth'}
                    options={[
                      { label: apiKeyConfig.label || 'API key', value: 'apiKey' },
                      { label: 'Connected account', value: 'oauth' },
                    ]}
                    onValueChange={(value) => {
                      form.setUseApiKey(value === 'apiKey')
                      form.setApiKeyValue('')
                      form.setSelectedCredentialId(null)
                    }}
                  />
                )}
                {isApiKeyMode ? (
                  <ApiKeyField
                    label={apiKeyConfig?.label || 'API Key'}
                    value={form.apiKeyValue}
                    onChange={form.setApiKeyValue}
                    workspaceId={owner.workspaceId}
                    placeholder={apiKeyConfig?.placeholder || 'Enter API key'}
                    disabled={isCreating}
                  />
                ) : form.showCredentialPicker ? (
                  failedAccounts ? (
                    retryAccounts
                  ) : (
                    <>
                      <SearchableSelect
                        label={
                          isMembersMode
                            ? 'Account for browsing'
                            : form.canConnectOAuth
                              ? 'Account'
                              : 'Service account'
                        }
                        searchLabel='Search accounts…'
                        placeholder={
                          form.canConnectOAuth
                            ? `Select ${connectorConfig.name} account`
                            : 'Select a service account'
                        }
                        options={accountOptions}
                        value={form.effectiveCredentialId}
                        onValueChange={form.setSelectedCredentialId}
                        onOpenChange={(open) => {
                          if (open) void form.refetchCredentials()
                        }}
                        createLabel={connectNew}
                        onCreate={connectNew ? form.connectOAuth : undefined}
                        disabled={
                          isCreating || !isIntegrationAvailabilityReady || credentialsLoading
                        }
                      />
                      {connectableServiceAccount && (
                        <div>
                          <Button
                            size='compact'
                            onClick={() => form.setServiceAccountField('browsing')}
                          >
                            {connectableServiceAccount.label}
                          </Button>
                        </div>
                      )}
                    </>
                  )
                ) : null}
                {form.canSetUpGitHubInstallation && (
                  <GitHubConnectionField
                    installations={installations}
                    credentialId={installationCredentialId}
                    error={credentialsError}
                    isLoading={credentialsLoading}
                    isFetching={credentialsFetching}
                    onRetry={() => void form.refetchCredentials()}
                    onConnect={() =>
                      void githubSetup.connect(installations.length ? 'install' : undefined)
                    }
                    connecting={githubSetup.pending}
                    connectionError={githubSetup.error}
                    onCancel={githubSetup.cancel}
                    onCheckConnection={() => void githubSetup.checkConnection()}
                    isChecking={githubSetup.isChecking}
                    onChange={(credentialId) => {
                      if (credentialId !== installationCredentialId)
                        form.handleFieldChange('repository', '')
                      form.setContentCredentialId(credentialId)
                    }}
                    disabled={isCreating}
                  />
                )}
                {configFieldsProps && (
                  <ConnectorConfigFields
                    config={configFieldsProps}
                    isFieldVisible={(field) =>
                      isFieldVisible(field) &&
                      !hiddenCapFieldIds.has(field.id) &&
                      !isOptionalSetupField(field)
                    }
                  />
                )}
                {showGitLabPermissions && (
                  <GitLabCsvUploads form={gitlabPermissions} disabled={isCreating} />
                )}
                {hasOptions && (
                  <Disclosure chevron label='More options'>
                    <FieldStack>
                      {!form.canSetUpGitHubInstallation && contentCredentialField}
                      {configFieldsProps && form.hasOptionalSetupFields && (
                        <ConnectorConfigFields
                          config={configFieldsProps}
                          isFieldVisible={(field) =>
                            isFieldVisible(field) &&
                            !hiddenCapFieldIds.has(field.id) &&
                            isOptionalSetupField(field)
                          }
                        />
                      )}
                      {connectorConfig.tagDefinitions?.map((tag) => (
                        <Checkbox
                          key={tag.id}
                          label={tag.displayName}
                          disabled={isCreating}
                          checked={!form.disabledTagIds.has(tag.id)}
                          onCheckedChange={(checked) =>
                            form.setDisabledTagIds((previous) => {
                              const next = new Set(previous)
                              if (checked) next.delete(tag.id)
                              else next.add(tag.id)
                              return next
                            })
                          }
                        />
                      ))}
                    </FieldStack>
                  </Disclosure>
                )}
                {(form.error || lockedUnavailable) && (
                  <InlineNotice
                    intent='danger'
                    message={
                      form.error ?? `This connection method is not available in this ${scope.kind}.`
                    }
                  />
                )}
              </>
            )}
          </FieldStack>
        </SettingsSection>
        {!slackSetupRequired && (
          <ActionRow>
            <Button
              variant='primary'
              disabled={!form.canSubmit || isCreating || githubSetup.pending}
              onClick={form.handleSubmit}
            >
              {submitLabel}
            </Button>
            {!form.canSubmit && <Muted>Complete the required fields to continue.</Muted>}
          </ActionRow>
        )}
      </FormFieldset>
      {form.serviceAccountField && connectableServiceAccount && (
        <BesideSurface>
          <ConnectServiceAccountModal
            open
            onOpenChange={(open) => {
              if (!open) form.setServiceAccountField(null)
            }}
            workspaceId={owner.workspaceId}
            organizationId={owner.organizationId}
            serviceAccountProviderId={connectableServiceAccount.serviceAccountProviderId}
            serviceName={connectableServiceAccount.serviceName}
            serviceIcon={connectableServiceAccount.serviceIcon}
            atlassianProduct={connectorType === 'confluence' ? 'confluence' : undefined}
            atlassianSetupGuideUrl={
              connectorType === 'confluence' && form.docsUrl
                ? `${form.docsUrl}#using-a-service-account`
                : undefined
            }
            onCreated={
              form.serviceAccountField === 'content'
                ? form.setContentCredentialId
                : form.setSelectedCredentialId
            }
          />
        </BesideSurface>
      )}
      {form.showOAuthModal && connectorConfig.auth.mode === 'oauth' && form.connectorProviderId && (
        <BesideSurface>
          <ConnectOAuthModal
            mode='connect'
            origin='kb-connectors'
            open
            onOpenChange={(open) => {
              if (!open) form.setShowOAuthModal(false)
            }}
            provider={form.connectorProviderId}
            serviceId={connectorConfig.auth.provider}
            providerId={form.connectorProviderId}
            docsUrl={form.docsUrl}
            requiredScopes={getCanonicalScopesForProvider(form.connectorProviderId)}
            workspaceId={owner.workspaceId}
            organizationId={owner.organizationId}
            knowledgeBaseId={knowledgeBaseId}
            connectorType={connectorType}
            sourceAccess={access.accessMode === 'members' ? 'members' : undefined}
          />
        </BesideSurface>
      )}
    </SectionStack>
  )
}
