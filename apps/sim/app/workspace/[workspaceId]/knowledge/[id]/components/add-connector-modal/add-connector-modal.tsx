'use client'

import { useId } from 'react'
import {
  Checkbox,
  Chip,
  ChipCombobox,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipSelect,
  type ComboboxOption,
  OverflowText,
} from '@sim/emcn'
import { ArrowLeft, ChevronDown, ChevronRight, Plus, Search } from '@sim/emcn/icons'
import { getCanonicalScopesForProvider } from '@/lib/oauth'
import { ConnectOAuthModal } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal'
import { ConnectServiceAccountModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { ConnectorApiKeyInput } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/add-connector-modal/connector-api-key-input'
import {
  type AddConnectorFormOptions,
  CONNECTOR_ENTRIES,
  useAddConnectorForm,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/add-connector-modal/use-add-connector-form'
import {
  ConnectorAccessField,
  ConnectorContentCredentialField,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access-field'
import { ConnectorConfigFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-config-fields'
import {
  connectorSyncFrequencyHint,
  SYNC_INTERVALS,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/consts'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { withBrandIcon } from '@/blocks/brand-icon'
import { GitHubInstallationConnectionField } from '@/connectors/github/installation-connection-field'
import {
  GitLabPermissionTabs,
  GitLabPermissionUploads,
} from '@/connectors/gitlab/permission-config/fields'
import type { ConnectorMeta } from '@/connectors/types'
import { useConnectorSetupStore } from '@/stores/connector-setup/store'

interface AddConnectorModalProps extends AddConnectorFormOptions {
  open: boolean
}

export function AddConnectorModal({ open, ...options }: AddConnectorModalProps) {
  const metadataId = useId()
  const {
    isSearchIndex = false,
    knowledgeBaseId,
    lockConnectorType = false,
    lockedAccessMode,
    onConnectorTypeChange,
    setupDraftKey,
  } = options
  const {
    access,
    allowAdmin,
    allowMembers,
    apiKeyConfig,
    apiKeyValue,
    canAdmin,
    canConnectOAuth,
    connectableServiceAccount,
    canSetUpGitHubInstallation,
    canSubmit,
    closeSetup,
    configFieldsProps,
    connectOAuth,
    connectorConfig,
    connectorProviderId,
    contentCredentialId,
    credentials,
    credentialsError,
    credentialsFetching,
    credentialsLoading,
    disabledTagIds,
    docsUrl,
    effectiveCredentialId,
    error,
    filteredEntries,
    githubSetup,
    gitlabPermissions,
    handleSelectType,
    handleSubmit,
    hasMaxAccess,
    hasOptionalSetupFields,
    hiddenCapFieldIds,
    installationCredentialId,
    installations,
    integrationAvailabilityError,
    isApiKeyMode,
    isCreating,
    isFieldVisible,
    isIntegrationAvailabilityFetching,
    isIntegrationAvailabilityLoading,
    isIntegrationAvailabilityReady,
    isMembersMode,
    isOptionalSetupField,
    liveSearch,
    memberAccessAvailable,
    mirroredAccessAvailable,
    modalTitle,
    owner,
    rawCredentials,
    refetchCredentials,
    refetchIntegrationAvailability,
    saveSetup,
    scope,
    searchLabels,
    searchTerm,
    selectedType,
    serviceAccountField,
    setAccess,
    setApiKeyValue,
    setContentCredentialId,
    setDisabledTagIds,
    setSearchTerm,
    setSelectedCredentialId,
    setServiceAccountField,
    setShowMetadata,
    setShowOAuthModal,
    setStep,
    setSyncInterval,
    setUseApiKey,
    setupGuideActions,
    showCredentialPicker,
    showGitLabPermissions,
    showMetadata,
    showOAuthModal,
    slackSetupRequired,
    step,
    syncInterval,
    handleFieldChange,
  } = useAddConnectorForm(options)

  const contentCredentialField =
    !canSetUpGitHubInstallation &&
    isMembersMode &&
    connectorConfig?.supportsSeparateContentCredential ? (
      <>
        <ConnectorContentCredentialField
          credentialId={contentCredentialId}
          onChange={setContentCredentialId}
          options={[
            ...credentials.map((credential) => ({
              value: credential.id,
              label: credential.name || credential.provider,
            })),
            ...(canConnectOAuth
              ? [
                  {
                    value: '__connect_new__',
                    label: `Connect ${connectorConfig.name} account`,
                    icon: Plus,
                    onSelect: connectOAuth,
                  },
                ]
              : []),
            ...(connectableServiceAccount
              ? [
                  {
                    value: '__service_account__',
                    label: connectableServiceAccount.label,
                    icon: Plus,
                    onSelect: () => setServiceAccountField('content'),
                  },
                ]
              : []),
          ]}
          isLoading={credentialsLoading}
          disabled={isCreating}
        />
        {!showCredentialPicker && credentialsError && rawCredentials.length === 0 && (
          <SettingsQueryErrorState
            error={credentialsError}
            fallback='Could not load accounts'
            isRetrying={credentialsFetching}
            onRetry={() => void refetchCredentials()}
            variant='inline'
          />
        )}
      </>
    ) : null

  return (
    <>
      <ChipModal
        open={open}
        onOpenChange={closeSetup}
        srTitle={step === 'select-type' ? 'Add source' : modalTitle}
        size='md'
        dismissDisabled={isCreating}
      >
        <ChipModalHeader onClose={() => closeSetup(false)}>
          {step === 'configure' ? (
            <span className='flex items-center gap-2'>
              {!lockConnectorType && !lockedAccessMode && (
                <Chip
                  leftIcon={ArrowLeft}
                  aria-label='Choose another source'
                  onClick={() => {
                    if (setupDraftKey) useConnectorSetupStore.getState().clearDraft(setupDraftKey)
                    setStep('select-type')
                    onConnectorTypeChange?.('')
                  }}
                />
              )}
              {modalTitle}
            </span>
          ) : (
            'Add source'
          )}
        </ChipModalHeader>

        <ChipModalBody
          className={
            step === 'select-type'
              ? 'max-h-[520px] pb-0'
              : slackSetupRequired
                ? undefined
                : 'max-h-[560px]'
          }
        >
          {step === 'select-type' ? (
            <div className='flex min-h-0 flex-col px-2'>
              <ChipInput
                icon={Search}
                placeholder='Search sources...'
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <div className='max-h-[390px] min-h-0 overflow-y-auto [scrollbar-gutter:stable]'>
                <div className='flex flex-col gap-0.5 pt-2.5 pr-1 pb-4.5'>
                  {filteredEntries.map(([type, config]) => (
                    <ConnectorTypeCard
                      key={type}
                      type={type}
                      config={config}
                      onClick={() => handleSelectType(type)}
                    />
                  ))}
                  {filteredEntries.length === 0 && (
                    <SettingsEmptyState variant='inline'>
                      {CONNECTOR_ENTRIES.length === 0
                        ? 'No connectors available.'
                        : `No sources found matching "${searchTerm}"`}
                    </SettingsEmptyState>
                  )}
                </div>
              </div>
            </div>
          ) : connectorConfig ? (
            <>
              {showGitLabPermissions && (
                <GitLabPermissionTabs form={gitlabPermissions} disabled={isCreating} />
              )}
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
              {!canSetUpGitHubInstallation &&
                (!lockedAccessMode || slackSetupRequired) &&
                (memberAccessAvailable || mirroredAccessAvailable || slackSetupRequired) && (
                  <ConnectorAccessField
                    scope={scope}
                    connectorConfig={connectorConfig}
                    value={access}
                    onChange={setAccess}
                    canAdmin={canAdmin}
                    allowMembers={allowMembers}
                    allowAdmin={allowAdmin}
                    allowWorkspace={!isSearchIndex}
                    disabled={isCreating}
                    searchSetupSource={
                      isSearchIndex && selectedType === 'slack' ? 'slack' : undefined
                    }
                    slackSetupOnly={Boolean(lockedAccessMode) && slackSetupRequired}
                    onSetupNavigate={saveSetup}
                  />
                )}

              {!slackSetupRequired && (
                <>
                  {connectorConfig.auth.mode === 'oauth' && apiKeyConfig && !isMembersMode && (
                    <ChipModalField type='custom' title='Authentication'>
                      <ChipCombobox
                        disabled={isCreating}
                        value={isApiKeyMode ? 'apiKey' : 'oauth'}
                        options={[
                          { label: apiKeyConfig.label || 'API key', value: 'apiKey' },
                          { label: 'Connected account', value: 'oauth' },
                        ]}
                        onChange={(value) => {
                          setUseApiKey(value === 'apiKey')
                          setApiKeyValue('')
                          setSelectedCredentialId(null)
                        }}
                      />
                    </ChipModalField>
                  )}
                  {isApiKeyMode ? (
                    <ChipModalField type='custom' title={apiKeyConfig?.label || 'API Key'}>
                      <ConnectorApiKeyInput
                        value={apiKeyValue}
                        onChange={setApiKeyValue}
                        workspaceId={owner.workspaceId}
                        placeholder={apiKeyConfig?.placeholder || 'Enter API key'}
                      />
                    </ChipModalField>
                  ) : showCredentialPicker ? (
                    <ChipModalField
                      type='custom'
                      title={
                        isMembersMode
                          ? 'Account for browsing'
                          : canConnectOAuth
                            ? 'Account'
                            : 'Service account'
                      }
                    >
                      {credentialsError && rawCredentials.length === 0 ? (
                        <SettingsQueryErrorState
                          error={credentialsError}
                          fallback='Could not load accounts'
                          isRetrying={credentialsFetching}
                          onRetry={() => void refetchCredentials()}
                          variant='inline'
                        />
                      ) : (
                        <ChipCombobox
                          options={[
                            ...credentials.map(
                              (cred): ComboboxOption => ({
                                label: cred.name || cred.provider,
                                value: cred.id,
                                icon: withBrandIcon(connectorConfig.icon),
                              })
                            ),
                            ...(canConnectOAuth
                              ? [
                                  {
                                    label:
                                      credentials.length > 0
                                        ? `Connect another ${connectorConfig.name} account`
                                        : `Connect ${connectorConfig.name} account`,
                                    value: '__connect_new__',
                                    icon: Plus,
                                    onSelect: connectOAuth,
                                  },
                                ]
                              : []),
                            ...(connectableServiceAccount
                              ? [
                                  {
                                    label: connectableServiceAccount.label,
                                    value: '__service_account__',
                                    icon: Plus,
                                    onSelect: () => setServiceAccountField('browsing'),
                                  },
                                ]
                              : []),
                          ]}
                          value={effectiveCredentialId ?? undefined}
                          onChange={(value) => setSelectedCredentialId(value)}
                          onOpenChange={(isOpen) => {
                            if (isOpen) void refetchCredentials()
                          }}
                          placeholder={
                            canConnectOAuth
                              ? `Select ${connectorConfig.name} account`
                              : 'Select a service account'
                          }
                          isLoading={credentialsLoading || isIntegrationAvailabilityLoading}
                          disabled={isCreating || !isIntegrationAvailabilityReady}
                        />
                      )}
                    </ChipModalField>
                  ) : null}

                  {canSetUpGitHubInstallation && (
                    <GitHubInstallationConnectionField
                      installations={installations}
                      credentialId={installationCredentialId}
                      error={credentialsError}
                      isLoading={credentialsLoading}
                      isFetching={credentialsFetching}
                      onRetry={() => void refetchCredentials()}
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
                          handleFieldChange('repository', '')
                        setContentCredentialId(credentialId)
                      }}
                      disabled={isCreating}
                    />
                  )}
                  {!isSearchIndex && contentCredentialField}

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
                  {showGitLabPermissions && (
                    <GitLabPermissionUploads form={gitlabPermissions} disabled={isCreating} />
                  )}

                  {(hasOptionalSetupFields ||
                    contentCredentialField ||
                    Boolean(connectorConfig.tagDefinitions?.length)) && (
                    <>
                      <div className='px-2'>
                        <Chip
                          type='button'
                          leftIcon={showMetadata ? ChevronDown : ChevronRight}
                          aria-expanded={showMetadata}
                          onClick={() => setShowMetadata((visible) => !visible)}
                        >
                          {isSearchIndex || hasOptionalSetupFields
                            ? 'More options'
                            : 'Document details (optional)'}
                        </Chip>
                      </div>
                      {showMetadata && (
                        <>
                          {isSearchIndex && !canSetUpGitHubInstallation && contentCredentialField}
                          {configFieldsProps && hasOptionalSetupFields && (
                            <ConnectorConfigFields
                              {...configFieldsProps}
                              isFieldVisible={(field) =>
                                isFieldVisible(field) &&
                                !hiddenCapFieldIds.has(field.id) &&
                                isOptionalSetupField(field)
                              }
                            />
                          )}
                          {Boolean(connectorConfig.tagDefinitions?.length) && (
                            <ChipModalField type='custom' title='Metadata tags'>
                              <div className='flex flex-col gap-2'>
                                {connectorConfig.tagDefinitions?.map((tagDef) => (
                                  <label
                                    key={tagDef.id}
                                    htmlFor={`${metadataId}-${tagDef.id}`}
                                    className='flex cursor-pointer items-center gap-2 text-small'
                                  >
                                    <Checkbox
                                      id={`${metadataId}-${tagDef.id}`}
                                      disabled={isCreating}
                                      checked={!disabledTagIds.has(tagDef.id)}
                                      onCheckedChange={(checked) => {
                                        setDisabledTagIds((prev) => {
                                          const next = new Set(prev)
                                          if (checked) {
                                            next.delete(tagDef.id)
                                          } else {
                                            next.add(tagDef.id)
                                          }
                                          return next
                                        })
                                      }}
                                    />
                                    <OverflowText
                                      label={tagDef.displayName}
                                      className='flex-1 text-[var(--text-body)]'
                                    />
                                  </label>
                                ))}
                              </div>
                            </ChipModalField>
                          )}
                        </>
                      )}
                    </>
                  )}

                  {!isSearchIndex && (!hasOptionalSetupFields || showMetadata) && (
                    <ChipModalField
                      type='custom'
                      title='Sync Frequency'
                      hint={
                        showGitLabPermissions && gitlabPermissions.mode === 'csv'
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
                            interval.requiresMax && !hasMaxAccess
                              ? `${interval.label} (Max)`
                              : interval.label,
                          disabled: interval.requiresMax && !hasMaxAccess,
                        }))}
                      />
                    </ChipModalField>
                  )}

                  <ChipModalError>
                    {error ??
                      (lockedAccessMode &&
                      isIntegrationAvailabilityReady &&
                      !integrationAvailabilityError &&
                      !(lockedAccessMode === 'admin' ? allowAdmin : allowMembers)
                        ? `This connection method is not available in this ${scope.kind}.`
                        : null)}
                  </ChipModalError>
                </>
              )}
            </>
          ) : null}
        </ChipModalBody>

        {step === 'configure' &&
          (slackSetupRequired ? (
            <ChipModalFooter
              onCancel={() => closeSetup(false)}
              secondaryActions={setupGuideActions}
              defaultAction='none'
            />
          ) : (
            <ChipModalFooter
              onCancel={() => closeSetup(false)}
              secondaryActions={setupGuideActions}
              primaryAction={{
                label: isCreating
                  ? isMembersMode
                    ? 'Creating…'
                    : 'Connecting…'
                  : isMembersMode
                    ? scope.kind === 'organization'
                      ? (searchLabels?.add ?? 'Add connection')
                      : 'Create & Invite'
                    : liveSearch
                      ? 'Save connection'
                      : 'Connect & Sync',
                onClick: handleSubmit,
                disabled: !canSubmit || isCreating || githubSetup.pending,
              }}
            />
          ))}
      </ChipModal>
      {serviceAccountField && connectableServiceAccount && (
        <ConnectServiceAccountModal
          open
          onOpenChange={(open) => {
            if (!open) setServiceAccountField(null)
          }}
          {...owner}
          serviceAccountProviderId={connectableServiceAccount.serviceAccountProviderId}
          serviceName={connectableServiceAccount.serviceName}
          serviceIcon={connectableServiceAccount.serviceIcon}
          atlassianProduct={selectedType === 'confluence' ? 'confluence' : undefined}
          atlassianSetupGuideUrl={
            selectedType === 'confluence' && docsUrl
              ? `${docsUrl}#using-a-service-account`
              : undefined
          }
          onCreated={
            serviceAccountField === 'content' ? setContentCredentialId : setSelectedCredentialId
          }
        />
      )}
      {showOAuthModal &&
        connectorConfig &&
        connectorConfig.auth.mode === 'oauth' &&
        connectorProviderId && (
          <ConnectOAuthModal
            mode='connect'
            origin='kb-connectors'
            open={showOAuthModal}
            onOpenChange={(open) => {
              if (!open) {
                setShowOAuthModal(false)
              }
            }}
            provider={connectorProviderId}
            serviceId={connectorConfig.auth.provider}
            providerId={connectorProviderId}
            docsUrl={docsUrl}
            requiredScopes={getCanonicalScopesForProvider(connectorProviderId)}
            {...owner}
            knowledgeBaseId={knowledgeBaseId}
            connectorType={selectedType ?? undefined}
            sourceAccess={access.accessMode === 'members' ? 'members' : undefined}
          />
        )}
    </>
  )
}

interface ConnectorTypeCardProps {
  type: string
  config: ConnectorMeta
  onClick: () => void
}

function ConnectorTypeCard({ type, config, onClick }: ConnectorTypeCardProps) {
  return (
    <SettingsResourceRow
      iconVariant='custom'
      icon={<IntegrationTile blockType={type} icon={config.icon} />}
      title={config.name}
      description={config.description}
      onClick={onClick}
      clickLabel={config.name}
      navigable
    />
  )
}
