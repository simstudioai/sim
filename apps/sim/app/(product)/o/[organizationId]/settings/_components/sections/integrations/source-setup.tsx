'use client'

import { Button } from '@sim/emcn/button'
import { Checkbox } from '@sim/emcn/checkbox'
import { Disclosure } from '@sim/emcn/disclosure'
import { SelectField } from '@sim/emcn/field'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { OAuthConnectModal } from '@/app/(product)/_components/oauth-connect-modal/oauth-connect-modal'
import { ServiceAccountModal } from '@/app/(product)/_components/service-account-modal/service-account-modal'
import {
  ActionRow,
  DetailHeader,
  FieldStack,
  FormFieldset,
  Muted,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { ApiKeyField } from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/api-key-field'
import { ConnectorAccess } from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/connector-access'
import { ConnectorConfigFields } from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/connector-config-fields'
import { ContentCredentialField } from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/content-credential-field'
import { GitHubConnectionField } from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/github-connection-field'
import {
  GitLabCsvUploads,
  GitLabTokenTabs,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/gitlab-fields'
import {
  type ConnectorData,
  getCanonicalScopesForProvider,
  type ResourceScope,
  useAddConnectorForm,
} from '@/platform/lib/data/search-sources'

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
    rawCredentials,
    searchLabels,
    serviceAccount,
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
        {(form.canConnectOAuth || serviceAccount) && (
          <ActionRow>
            {form.canConnectOAuth && (
              <Button size='compact' onClick={form.connectOAuth}>
                {`Connect ${connectorConfig.name} account`}
              </Button>
            )}
            {serviceAccount && (
              <Button size='compact' onClick={() => form.setServiceAccountField('content')}>
                {serviceAccount.label}
              </Button>
            )}
          </ActionRow>
        )}
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
                      {serviceAccount && (
                        <div>
                          <Button
                            size='compact'
                            onClick={() => form.setServiceAccountField('browsing')}
                          >
                            {serviceAccount.label}
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
      {form.serviceAccountField && serviceAccount && (
        <ServiceAccountModal
          open
          onOpenChange={(open) => {
            if (!open) form.setServiceAccountField(null)
          }}
          scope={scope}
          serviceAccountProviderId={serviceAccount.serviceAccountProviderId}
          serviceName={serviceAccount.serviceName}
          atlassianProduct={serviceAccount.atlassianProduct}
          atlassianSetupGuideUrl={serviceAccount.atlassianSetupGuideUrl}
          onCreated={(credentialId) => {
            if (form.serviceAccountField === 'content') form.setContentCredentialId(credentialId)
            else form.setSelectedCredentialId(credentialId)
            form.setServiceAccountField(null)
          }}
        />
      )}
      {form.showOAuthModal && connectorConfig.auth.mode === 'oauth' && form.connectorProviderId && (
        <OAuthConnectModal
          mode='connect'
          open
          onOpenChange={(open) => {
            if (!open) form.setShowOAuthModal(false)
          }}
          scope={scope}
          provider={form.connectorProviderId}
          providerId={form.connectorProviderId}
          serviceId={connectorConfig.auth.provider}
          docsUrl={form.docsUrl}
          requiredScopes={getCanonicalScopesForProvider(form.connectorProviderId)}
          returnTo={{
            origin: 'kb-connectors',
            knowledgeBaseId,
            connectorType,
            sourceAccess: access.accessMode === 'members' ? 'members' : undefined,
          }}
        />
      )}
    </SectionStack>
  )
}
