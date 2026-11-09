'use client'

import { useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Checkbox } from '@sim/emcn/checkbox'
import { Disclosure } from '@sim/emcn/disclosure'
import { SelectField } from '@sim/emcn/field'
import { DetailsField } from '@sim/emcn/field/details-field'
import { Icon } from '@sim/emcn/icon'
import { Modal } from '@sim/emcn/modal'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { SearchField } from '@sim/emcn/search-field'
import { FailureNotice } from '@sim/emcn/status'
import { OAuthConnectModal } from '@/app/(product)/workspace/[workspaceId]/_components/oauth-connect-modal/oauth-connect-modal'
import { ServiceAccountModal } from '@/app/(product)/workspace/[workspaceId]/_components/service-account-modal/service-account-modal'
import styles from '@/app/(product)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/_components/add-connector-modal/add-connector-modal.module.css'
import { ConnectorApiKeyField } from '@/app/(product)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/_components/add-connector-modal/connector-api-key-field'
import {
  ConnectorAccessField,
  ContentCredentialField,
  type CredentialPickerAction,
} from '@/app/(product)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/_components/connector-access-field/connector-access-field'
import { ConnectorFields } from '@/app/(product)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/_components/connector-fields/connector-fields'
import {
  GitLabPermissionUploads,
  GitLabTokenChoice,
} from '@/app/(product)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/_components/gitlab-permissions/gitlab-permissions'
import { connectorMark } from '@/app/(product)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/_components/knowledge-base/model'
import {
  type ConnectorConfigField,
  connectorSyncFrequencyHint,
  getCanonicalScopesForProvider,
  SYNC_INTERVALS,
  useAddConnectorForm,
} from '@/platform/lib/data/knowledge/connectors'

const CONNECT_NEW = '__connect_new__'
const ADD_SERVICE_ACCOUNT = '__service_account__'

interface AddConnectorModalProps {
  workspaceId: string
  knowledgeBaseId: string
  isSearchIndex: boolean
  initialConnectorType?: string
  onConnectorTypeChange: (connectorType: string) => void
  onClose: () => void
}

/**
 * New connector: choose a source from every connector the registry offers, then set how it connects,
 * which account it uses, what it syncs and how often. Connecting a new account goes through the
 * provider and returns here with the draft as it was.
 */
export function AddConnectorModal({
  workspaceId,
  knowledgeBaseId,
  isSearchIndex,
  initialConnectorType,
  onConnectorTypeChange,
  onClose,
}: AddConnectorModalProps) {
  const form = useAddConnectorForm({
    workspaceId,
    knowledgeBaseId,
    isSearchIndex,
    initialConnectorType,
    onConnectorTypeChange,
    onClose,
  })
  const [connecting, setConnecting] = useState(false)
  /** Which picker a new service account fills once created. */
  const [serviceAccountFor, setServiceAccountFor] = useState<'content' | 'account' | null>(null)
  const sourceList = useScrollEdges<HTMLUListElement>('vertical')
  const meta = form.connectorConfig

  if (form.step === 'select-type' || !meta) {
    return (
      <Modal
        open
        onOpenChange={(open) => {
          if (!open) form.close()
        }}
        title='Add source'
      >
        <SearchField
          label='Search sources'
          placeholder='Search sources'
          value={form.searchTerm}
          onValueChange={form.setSearchTerm}
        />
        {form.filteredEntries.length > 0 ? (
          <ul ref={sourceList} className={styles.sources} aria-label='Sources'>
            {form.filteredEntries.map(([type, source]) => (
              <ActivityRow
                key={type}
                leading={<Icon providerId={connectorMark(type)} />}
                title={source.name}
                detail={source.description}
                onOpen={() => form.selectType(type)}
              />
            ))}
          </ul>
        ) : (
          <p className={styles.empty} data-type='T060'>
            {form.entries.length === 0
              ? 'No connectors are available.'
              : `No sources match “${form.searchTerm.trim()}”.`}
          </p>
        )}
      </Modal>
    )
  }

  const members = form.isMembersMode
  const options = form.credentials.map((credential) => ({
    value: credential.id,
    label: credential.name || credential.provider,
  }))
  const connectLabel =
    form.credentials.length > 0
      ? `Connect another ${meta.name} account`
      : `Connect ${meta.name} account`
  const connectNew = () => {
    form.saveDraft()
    setConnecting(true)
  }
  const contentActions: CredentialPickerAction[] = [
    ...(form.canConnectOAuth
      ? [{ value: CONNECT_NEW, label: `Connect ${meta.name} account`, onSelect: connectNew }]
      : []),
    ...(form.serviceAccount
      ? [
          {
            value: ADD_SERVICE_ACCOUNT,
            label: form.serviceAccount.label,
            onSelect: () => setServiceAccountFor('content'),
          },
        ]
      : []),
  ]
  const contentCredentialField =
    members && meta.supportsSeparateContentCredential ? (
      <ContentCredentialField
        credentialId={form.contentCredentialId}
        onChange={form.setContentCredentialId}
        options={options}
        actions={contentActions}
        disabled={form.creating}
      />
    ) : null
  const tagDefinitions = meta.tagDefinitions ?? []
  const hasMore =
    form.hasOptionalSetupFields || Boolean(contentCredentialField) || tagDefinitions.length > 0
  const fields = (isFieldVisible: (field: ConnectorConfigField) => boolean) => (
    <ConnectorFields
      accessMode={form.accessMode}
      connectorConfig={meta}
      sourceConfig={form.config.sourceConfig}
      selectionLabels={form.config.selectionLabels}
      credentialId={form.credentialId}
      credentialType={form.credentials.find((item) => item.id === form.credentialId)?.type}
      canonicalGroups={form.config.canonicalGroups}
      canonicalModes={form.config.canonicalModes}
      isFieldVisible={isFieldVisible}
      onFieldChange={form.config.handleFieldChange}
      onToggleCanonicalMode={form.config.toggleCanonicalMode}
      disabled={form.creating}
    />
  )
  const confirmLabel = form.creating
    ? members
      ? 'Creating…'
      : 'Connecting…'
    : members
      ? 'Create & Invite'
      : isSearchIndex
        ? 'Save connection'
        : 'Connect & Sync'
  const syncFrequency = !isSearchIndex && (!form.hasOptionalSetupFields || form.showMore) && (
    <SelectField
      label='Sync frequency'
      value={String(form.syncInterval)}
      onValueChange={(value) => form.setSyncInterval(Number(value))}
      hint={
        form.showGitLabPermissions && form.gitlabPermissions.mode === 'csv'
          ? undefined
          : connectorSyncFrequencyHint(
              form.accessMode,
              form.syncInterval,
              Boolean(form.contentCredentialId)
            )
      }
      options={SYNC_INTERVALS.map((interval) => ({
        value: String(interval.value),
        label:
          interval.requiresMax && !form.hasMaxAccess ? `${interval.label} (Max)` : interval.label,
        disabled: interval.requiresMax && !form.hasMaxAccess,
        disabledReason:
          interval.requiresMax && !form.hasMaxAccess
            ? 'Live sync is available on the Max plan.'
            : undefined,
      }))}
    />
  )

  return (
    <>
      <Modal
        open={!connecting}
        onOpenChange={(open) => {
          if (!open) form.close()
        }}
        title={form.title}
        onBack={form.back}
        confirmLabel={form.slackSetupRequired ? undefined : confirmLabel}
        confirmDisabled={!form.canSubmit}
        pending={form.creating}
        footerStartAction={
          form.docsUrl
            ? {
                label: 'Setup guide',
                variant: 'quiet',
                onClick: () => window.open(form.docsUrl, '_blank', 'noopener,noreferrer'),
              }
            : undefined
        }
        onConfirm={() => form.submit()}
      >
        {form.showGitLabPermissions && (
          <GitLabTokenChoice form={form.gitlabPermissions} disabled={form.creating} />
        )}
        {form.availability.error && (
          <FailureNotice
            message='Could not load connection availability.'
            retrying={form.availability.isFetching}
            onRetry={form.availability.refetch}
          />
        )}
        {(form.memberAccessAvailable ||
          form.mirroredAccessAvailable ||
          form.slackSetupRequired) && (
          <ConnectorAccessField
            workspaceId={workspaceId}
            connectorConfig={meta}
            accessMode={form.accessMode}
            onChange={form.setAccessMode}
            canAdmin={form.canAdmin}
            allowMembers={form.allowMembers}
            allowAdmin={form.allowAdmin}
            allowWorkspace={!isSearchIndex}
            disabled={form.creating}
            onSetupNavigate={form.saveDraft}
          />
        )}
        {!form.slackSetupRequired && (
          <>
            {meta.auth.mode === 'oauth' && form.apiKeyConfig && !members && (
              <SelectField
                label='Authentication'
                value={form.isApiKeyMode ? 'apiKey' : 'oauth'}
                disabled={form.creating}
                onValueChange={(value) => {
                  form.setUseApiKey(value === 'apiKey')
                  form.setApiKey('')
                  form.setSelectedCredentialId(null)
                }}
                options={[
                  { value: 'apiKey', label: form.apiKeyConfig.label || 'API key' },
                  { value: 'oauth', label: 'Connected account' },
                ]}
              />
            )}
            {form.isApiKeyMode ? (
              <ConnectorApiKeyField
                workspaceId={workspaceId}
                label={form.apiKeyConfig?.label || 'API key'}
                placeholder={form.apiKeyConfig?.placeholder || 'Enter API key'}
                value={form.apiKey}
                onChange={form.setApiKey}
                optional={meta.auth.mode === 'apiKey' && meta.auth.optional === true}
                required={!(meta.auth.mode === 'apiKey' && meta.auth.optional === true)}
                disabled={form.creating}
              />
            ) : form.showCredentialPicker ? (
              form.credentialsQuery.error && form.rawCredentials.length === 0 ? (
                <FailureNotice
                  message='Could not load accounts.'
                  retrying={form.credentialsQuery.isFetching}
                  onRetry={() => void form.credentialsQuery.refetch()}
                />
              ) : (
                <SelectField
                  label={
                    members
                      ? 'Account for browsing'
                      : form.canConnectOAuth
                        ? 'Account'
                        : 'Service account'
                  }
                  value={form.credentialId ?? undefined}
                  placeholder={
                    form.canConnectOAuth
                      ? `Select ${meta.name} account`
                      : 'Select a service account'
                  }
                  disabled={form.creating || !form.availability.isReady}
                  hint={
                    !form.canConnectOAuth && options.length === 0
                      ? `Connect a ${meta.name} service account in Integrations, then return here to select it.`
                      : undefined
                  }
                  onValueChange={(value) => {
                    if (value === CONNECT_NEW) connectNew()
                    else if (value === ADD_SERVICE_ACCOUNT) setServiceAccountFor('account')
                    else form.setSelectedCredentialId(value)
                  }}
                  options={[
                    ...options,
                    ...(form.canConnectOAuth ? [{ value: CONNECT_NEW, label: connectLabel }] : []),
                    ...(form.serviceAccount
                      ? [{ value: ADD_SERVICE_ACCOUNT, label: form.serviceAccount.label }]
                      : []),
                  ]}
                />
              )
            ) : null}
            {!isSearchIndex && contentCredentialField}
            {fields(
              (field) =>
                form.isFieldVisible(field) &&
                !form.hiddenCapFieldIds.has(field.id) &&
                !form.isOptionalSetupField(field)
            )}
            {form.showGitLabPermissions && (
              <GitLabPermissionUploads form={form.gitlabPermissions} disabled={form.creating} />
            )}
            {hasMore ? (
              <Disclosure
                label={
                  isSearchIndex || form.hasOptionalSetupFields
                    ? 'More options'
                    : 'Document details (optional)'
                }
                open={form.showMore}
                onOpenChange={form.setShowMore}
              >
                <div className={styles.more}>
                  {isSearchIndex && contentCredentialField}
                  {form.hasOptionalSetupFields &&
                    fields(
                      (field) =>
                        form.isFieldVisible(field) &&
                        !form.hiddenCapFieldIds.has(field.id) &&
                        form.isOptionalSetupField(field)
                    )}
                  {tagDefinitions.length > 0 && (
                    <DetailsField label='Metadata tags'>
                      <div className={styles.tags}>
                        {tagDefinitions.map((tag) => (
                          <Checkbox
                            key={tag.id}
                            label={tag.displayName}
                            disabled={form.creating}
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
                      </div>
                    </DetailsField>
                  )}
                  {form.hasOptionalSetupFields && syncFrequency}
                </div>
              </Disclosure>
            ) : null}
            {!form.hasOptionalSetupFields && syncFrequency}
          </>
        )}
      </Modal>
      {connecting && form.providerId && (
        <OAuthConnectModal
          open
          onOpenChange={(open) => {
            if (!open) setConnecting(false)
          }}
          mode='connect'
          workspaceId={workspaceId}
          providerId={form.providerId}
          serviceName={meta.name}
          docsUrl={form.docsUrl}
          requiredScopes={getCanonicalScopesForProvider(form.providerId)}
          returnTo={{
            origin: 'kb-connectors',
            knowledgeBaseId,
            connectorType: form.selectedType ?? undefined,
            sourceAccess: members ? 'members' : undefined,
          }}
          onBeforeRedirect={form.saveDraft}
        />
      )}
      {serviceAccountFor && form.serviceAccount && (
        <ServiceAccountModal
          open
          onOpenChange={(open) => {
            if (!open) setServiceAccountFor(null)
          }}
          workspaceId={workspaceId}
          serviceAccountProviderId={form.serviceAccount.serviceAccountProviderId}
          serviceName={form.serviceAccount.serviceName}
          atlassianProduct={form.serviceAccount.atlassianProduct}
          atlassianSetupGuideUrl={form.serviceAccount.atlassianSetupGuideUrl}
          onCreated={(credentialId) => {
            if (serviceAccountFor === 'content') form.setContentCredentialId(credentialId)
            else form.setSelectedCredentialId(credentialId)
            setServiceAccountFor(null)
          }}
        />
      )}
    </>
  )
}
