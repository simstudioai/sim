'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Checkbox } from '@sim/emcn/checkbox'
import { Disclosure } from '@sim/emcn/disclosure'
import { SelectField } from '@sim/emcn/field'
import { SecretField } from '@sim/emcn/field/value-fields'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { ServiceAccountModal } from '@/app/(product)/_components/service-account-modal/service-account-modal'
import {
  ConnectorAccessField,
  ContentCredentialField,
} from '@/app/(product)/_components/workspace/knowledge/connector-access-field/connector-access-field'
import {
  ConnectorDocumentFilterMenu,
  ConnectorDocuments,
} from '@/app/(product)/_components/workspace/knowledge/connector-documents/connector-documents'
import { ConnectorFields } from '@/app/(product)/_components/workspace/knowledge/connector-fields/connector-fields'
import { ConnectorHistory } from '@/app/(product)/_components/workspace/knowledge/connector-history/connector-history'
import styles from '@/app/(product)/_components/workspace/knowledge/connector-modal/connector-modal.module.css'
import {
  GitLabPermissionUploads,
  GitLabTokenChoice,
} from '@/app/(product)/_components/workspace/knowledge/gitlab-permissions/gitlab-permissions'
import {
  CONNECTOR_META_REGISTRY,
  CONNECTOR_SWITCH_NOTICE,
  type ConnectorConfigField,
  type ConnectorData,
  type ConnectorDocumentFilter,
  connectorSyncFrequencyHint,
  describeSearchSource,
  getConnectorSyncState,
  SYNC_INTERVALS,
  useConnectorActions,
  useConnectorList,
  useConnectorSettingsForm,
} from '@/platform/lib/data/knowledge/connectors'

type Tab = 'settings' | 'documents' | 'history'

const ADD_SERVICE_ACCOUNT = '__service_account__'

interface ConnectorModalProps {
  workspaceId: string
  knowledgeBaseId: string
  isSearchIndex: boolean
  connectorId: string
  canEdit: boolean
  onClose: () => void
}

/**
 * A connector's dialog: its settings, the documents it synced and its sync history, with Sync now,
 * Pause or Resume and Remove beside the tabs. It follows the connector as the list refreshes and
 * closes once the connector is gone.
 */
export function ConnectorModal({
  workspaceId,
  knowledgeBaseId,
  isSearchIndex,
  connectorId,
  canEdit,
  onClose,
}: ConnectorModalProps) {
  const connectors = useConnectorList(knowledgeBaseId).data
  const connector = connectors?.find((item) => item.id === connectorId)
  if (!connector) return null
  return (
    <ConnectorDialog
      key={connector.id}
      workspaceId={workspaceId}
      knowledgeBaseId={knowledgeBaseId}
      isSearchIndex={isSearchIndex}
      connector={connector}
      canEdit={canEdit}
      onClose={onClose}
    />
  )
}

interface ConnectorDialogProps extends Omit<ConnectorModalProps, 'connectorId'> {
  connector: ConnectorData
}

function ConnectorDialog({
  workspaceId,
  knowledgeBaseId,
  isSearchIndex,
  connector,
  canEdit,
  onClose,
}: ConnectorDialogProps) {
  const [tab, setTab] = useState<Tab>('settings')
  const [filter, setFilter] = useState<ConnectorDocumentFilter>('active')
  const [addingServiceAccount, setAddingServiceAccount] = useState(false)
  const form = useConnectorSettingsForm({
    workspaceId,
    knowledgeBaseId,
    isSearchIndex,
    connector,
    onSaved: () => {},
  })
  const actions = useConnectorActions({
    connector,
    knowledgeBaseId,
    canEdit,
    onRemoved: onClose,
  })
  const meta = form.connectorConfig ?? CONNECTOR_META_REGISTRY[connector.connectorType] ?? null
  const name = meta?.name ?? connector.connectorType
  const state = getConnectorSyncState(connector)
  const syncAction = actions.actions.find((action) => action.id === 'sync')
  const pauseAction = actions.actions.find((action) => action.id === 'pause')
  const removeAction = actions.actions.find((action) => action.id === 'delete')
  const busy = form.saving
  const syncFrequency = (
    <SelectField
      label='Sync frequency'
      value={String(form.syncInterval)}
      onValueChange={(value) => form.setSyncInterval(Number(value))}
      disabled={busy}
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
  const fields = (isFieldVisible: (field: ConnectorConfigField) => boolean) =>
    form.connectorConfig && (
      <ConnectorFields
        accessMode={form.accessMode}
        connectorConfig={form.connectorConfig}
        sourceConfig={form.config.sourceConfig}
        selectionLabels={form.config.selectionLabels}
        credentialId={form.selectorCredentialId}
        credentialType={form.selectorCredentialType}
        canonicalGroups={form.config.canonicalGroups}
        canonicalModes={form.config.canonicalModes}
        isFieldVisible={isFieldVisible}
        onFieldChange={form.config.handleFieldChange}
        onToggleCanonicalMode={form.config.toggleCanonicalMode}
        disabled={busy}
      />
    )
  const accessFooter = form.canReenableMemberSync ? (
    <div className={styles.apply}>
      <Button
        variant='primary'
        size='compact'
        disabled={!form.accessComplete || busy}
        onClick={() => void form.applyAccess()}
      >
        {form.switchingAccess ? 'Re-enabling…' : 'Re-enable per-member sync'}
      </Button>
      <p className={styles.note} data-type='T052'>
        Members and their documents are kept; the next sync restores their access.
      </p>
    </div>
  ) : form.accessDirty && (!form.isContentCredentialChange || form.syncsPerMember) ? (
    <div className={styles.apply}>
      <span className={styles.buttons}>
        <Button
          variant='primary'
          size='compact'
          disabled={!form.accessComplete || busy}
          onClick={() => void form.applyAccess()}
        >
          {form.switchingAccess
            ? 'Switching…'
            : form.isContentCredentialChange
              ? 'Change indexing account'
              : 'Apply connection method'}
        </Button>
        <Button variant='quiet' size='compact' disabled={busy} onClick={form.resetAccess}>
          {form.accessSetupHint ? 'Edit settings' : 'Cancel'}
        </Button>
      </span>
      <p className={styles.note} data-type='T052'>
        {form.accessSetupHint ??
          (form.isContentCredentialChange
            ? 'The next sync uses this account. Members keep their connected accounts and source permissions.'
            : CONNECTOR_SWITCH_NOTICE[form.accessMode])}
      </p>
    </div>
  ) : undefined

  const settings = (
    <div className={styles.panel}>
      {form.showGitLabPermissions && (
        <>
          <GitLabTokenChoice form={form.gitlabPermissions} disabled={busy || !form.canAdmin} />
          <SecretField
            label='Personal access token'
            placeholder='Leave blank to keep the saved token'
            value={form.gitlabPermissions.apiKey}
            onChange={form.gitlabPermissions.setApiKey}
            autoComplete='new-password'
            optional
            disabled={busy || !form.canAdmin}
          />
        </>
      )}
      {form.availability.error && (
        <FailureNotice
          message='Could not load connection availability.'
          retrying={form.availability.isFetching}
          onRetry={form.availability.refetch}
        />
      )}
      {form.syncsPerMember && form.connectorConfig?.supportsSeparateContentCredential && (
        <ContentCredentialField
          credentialId={form.contentCredentialId}
          onChange={form.setContentCredentialId}
          options={form.credentialOptions}
          disabled={busy || !form.canAdmin}
        />
      )}
      {form.connectorConfig && form.showAccessField && !form.hideFixedAccessMode && (
        <ConnectorAccessField
          workspaceId={workspaceId}
          connectorConfig={form.connectorConfig}
          accessMode={form.accessMode}
          onChange={form.setAccessMode}
          canAdmin={form.canAdmin}
          locked={isSearchIndex}
          availabilityReady={form.availability.isReady}
          allowMembers={form.allowMembers}
          allowAdmin={form.allowAdmin}
          allowWorkspace={!isSearchIndex}
          disabled={busy}
          footer={accessFooter}
        />
      )}
      {form.connectorConfig && form.needsWorkspaceCredential && form.canAdmin && (
        <SelectField
          label={
            isSearchIndex
              ? form.requiresServiceAccount
                ? 'Service account'
                : 'Account'
              : 'Indexing account'
          }
          value={form.workspaceCredentialId ?? connector.credentialId ?? undefined}
          placeholder='Select the account to sync as'
          onValueChange={(value) => {
            if (value === ADD_SERVICE_ACCOUNT) setAddingServiceAccount(true)
            else form.setWorkspaceCredentialId(value)
          }}
          options={[
            ...form.credentialOptions,
            ...(form.serviceAccount
              ? [{ value: ADD_SERVICE_ACCOUNT, label: form.serviceAccount.label }]
              : []),
          ]}
          disabled={busy}
          hint={
            !form.requiresServiceAccount &&
            !form.credentialsQuery.isLoading &&
            form.credentialOptions.length === 0
              ? `Connect a ${form.connectorConfig.name} account in Integrations, then return here to select it.`
              : undefined
          }
        />
      )}
      {form.connectorConfig &&
        form.syncsPerMember &&
        form.connectorConfig.configFields.some(
          (field) => field.type === 'selector' && form.config.isFieldVisible(field)
        ) && (
          <SelectField
            label='Account for browsing'
            value={form.browseCredentialId ?? undefined}
            placeholder={`Select your ${form.connectorConfig.name} account`}
            onValueChange={form.setBrowseCredentialId}
            options={form.rawCredentials.map((credential) => ({
              value: credential.id,
              label: credential.name || credential.provider,
            }))}
            disabled={busy}
            hint={
              isSearchIndex
                ? 'Members sync with their own accounts connected in Integrations.'
                : undefined
            }
          />
        )}
      {fields(
        (field) =>
          form.config.isFieldVisible(field) &&
          !form.hiddenCapFieldIds.has(field.id) &&
          !form.isOptionalSetupField(field)
      )}
      {form.showGitLabPermissions && (
        <>
          <GitLabPermissionUploads
            form={form.gitlabPermissions}
            disabled={busy || !form.canAdmin}
          />
          <Disclosure label='More options' open={form.showMore} onOpenChange={form.setShowMore}>
            <div className={styles.more}>
              {fields(
                (field) =>
                  form.config.isFieldVisible(field) &&
                  !form.hiddenCapFieldIds.has(field.id) &&
                  form.isOptionalSetupField(field)
              )}
              {!isSearchIndex && syncFrequency}
            </div>
          </Disclosure>
        </>
      )}
      {!isSearchIndex && !form.showGitLabPermissions && syncFrequency}
      {form.saveBlockedReason && <InlineNotice intent='warning' message={form.saveBlockedReason} />}
      {form.error && <InlineNotice intent='danger' message={form.error} />}
    </div>
  )

  return (
    <>
      <Modal
        open
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        title={name}
        description={
          meta ? describeSearchSource(meta, connector.sourceConfig) || undefined : undefined
        }
        accessibleName={`${name} connector`}
        cancelLabel={tab === 'settings' && canEdit ? 'Cancel' : 'Close'}
        confirmLabel={
          tab === 'settings' && canEdit ? (form.saving ? 'Saving…' : 'Save') : undefined
        }
        confirmDisabled={!form.canSave}
        pending={form.saving}
        footerStartAction={
          form.docsUrl && tab === 'settings'
            ? {
                label: 'Setup guide',
                variant: 'quiet',
                onClick: () => window.open(form.docsUrl, '_blank', 'noopener,noreferrer'),
              }
            : undefined
        }
        onConfirm={() => form.save()}
      >
        <ContentTabs
          label='Connector views'
          current={tab}
          onSelect={(id) => {
            if (id === 'settings' || id === 'documents' || id === 'history') setTab(id)
          }}
          actions={
            tab === 'documents' ? (
              <ConnectorDocumentFilterMenu
                knowledgeBaseId={knowledgeBaseId}
                connectorId={connector.id}
                filter={filter}
                onFilterChange={setFilter}
              />
            ) : canEdit ? (
              <>
                {syncAction && (
                  <Button
                    variant='quiet'
                    size='compact'
                    disabled={syncAction.disabled}
                    disabledReason={syncAction.tooltip}
                    onClick={syncAction.onSelect}
                  >
                    {syncAction.text}
                  </Button>
                )}
                {pauseAction && (
                  <Button
                    variant='quiet'
                    size='compact'
                    disabled={pauseAction.disabled}
                    disabledReason={pauseAction.tooltip}
                    onClick={pauseAction.onSelect}
                  >
                    {state.canResume ? 'Resume' : 'Pause'}
                  </Button>
                )}
                {removeAction && (
                  <Button
                    variant='quiet'
                    size='compact'
                    destructive
                    disabled={removeAction.disabled}
                    onClick={removeAction.onSelect}
                  >
                    Remove
                  </Button>
                )}
              </>
            ) : undefined
          }
          items={[
            { id: 'settings', label: 'Settings', content: settings },
            {
              id: 'documents',
              label: 'Documents',
              content: (
                <ConnectorDocuments
                  knowledgeBaseId={knowledgeBaseId}
                  connectorId={connector.id}
                  filter={filter}
                />
              ),
            },
            {
              id: 'history',
              label: 'Sync history',
              content: <ConnectorHistory knowledgeBaseId={knowledgeBaseId} connector={connector} />,
            },
          ]}
        />
        {(actions.error ?? actions.removal.error) && (
          <InlineNotice
            intent='danger'
            message={(actions.error ?? actions.removal.error)?.message ?? ''}
          />
        )}
      </Modal>
      <ConfirmDialog
        target={actions.removal.open ? connector : null}
        onClose={() => actions.removal.onOpenChange(false)}
        title='Remove connection'
        description={
          actions.removal.requiresDocumentDeletion
            ? 'This removes the connection, stops future syncs, and deletes its synced documents from Sim.'
            : 'This removes the connection and stops future syncs. Synced documents remain unless you delete them below.'
        }
        confirmLabel='Remove'
        pendingLabel='Removing…'
        onConfirm={() => actions.removal.onConfirm()}
      >
        {!actions.removal.requiresDocumentDeletion && (
          <Checkbox
            label='Also delete synced documents'
            checked={actions.removal.deleteDocuments}
            disabled={actions.removal.pending}
            onCheckedChange={actions.removal.setDeleteDocuments}
          />
        )}
      </ConfirmDialog>
      {addingServiceAccount && form.serviceAccount && (
        <ServiceAccountModal
          open
          onOpenChange={setAddingServiceAccount}
          scope={{ kind: 'workspace', workspaceId }}
          serviceAccountProviderId={form.serviceAccount.serviceAccountProviderId}
          serviceName={form.serviceAccount.serviceName}
          atlassianProduct={form.serviceAccount.atlassianProduct}
          atlassianSetupGuideUrl={form.serviceAccount.atlassianSetupGuideUrl}
          onCreated={(credentialId) => {
            form.setWorkspaceCredentialId(credentialId)
            setAddingServiceAccount(false)
          }}
        />
      )}
    </>
  )
}
