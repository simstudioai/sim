'use client'

import { type ReactNode, useState } from 'react'
import { Button, Chip } from '@sim/emcn/button'
import { Checkbox } from '@sim/emcn/checkbox'
import { EmptyState } from '@sim/emcn/empty-state'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { SaveActions } from '@sim/emcn/settings-section/save-actions'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import {
  ActionRow,
  DetailHeader,
  FieldStack,
  Muted,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { ConnectorSettingsFields } from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/connector-settings-fields'
import {
  CONNECTOR_META_REGISTRY,
  describeSearchSource,
  getConnectorSyncState,
  useConnectorActions,
  useOAuthReturnForKBConnectors,
} from '@/platform/lib/data/knowledge/connectors'
import { useOrganization } from '@/platform/lib/data/organization'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import {
  type ConnectorData,
  type ConnectorDetailData,
  type ResourceScope,
  useConnectorSettingsForm,
  useSettingsUnsavedGuard,
  useSourceConnection,
  useSourceIntegrationStatus,
} from '@/platform/lib/data/search-sources'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

interface SourceDetailProps {
  connectorId: string
}

export function SourceDetail({ connectorId }: SourceDetailProps) {
  const { organization, viewer } = useOrganization()
  const surface = useSurfaceScope()
  const router = useRouter()
  const scope: ResourceScope = { kind: 'organization', organizationId: organization.id }
  const backHref = surfaceHref(surface, '/settings/integrations')
  const { knowledgeBaseId, indexPending, connector, syncing, failure } = useSourceConnection(
    scope,
    connectorId,
    viewer.isAdmin
  )
  const shell = (title: string, children: ReactNode) => (
    <SectionStack>
      <DetailHeader backLabel='Sources' onBack={() => router.push(backHref)} title={title} />
      {children}
    </SectionStack>
  )

  if (!viewer.isAdmin)
    return shell('Connection', <EmptyState title='Only organization admins can manage sources.' />)
  if (failure?.blocking)
    return shell(
      'Connection',
      failure.gone ? (
        <EmptyState title='This connection is no longer available.' />
      ) : (
        <FailureNotice
          message={getErrorMessage(failure.error, 'Could not load connection')}
          retrying={failure.retrying}
          onRetry={failure.retry}
        />
      )
    )
  if (!indexPending && !knowledgeBaseId)
    return shell('Connection', <EmptyState title='This connection is no longer available.' />)
  if (!connector) return shell('Connection', null)
  if (
    connector.accessMode === 'members' &&
    !(connector.connectorType === 'github' && connector.sourceConfig.githubRepositoryId)
  )
    return shell(
      'Member accounts',
      <>
        <Muted>
          Members search all content their connected accounts can access. Manage this integration’s
          account mode in Sources.
        </Muted>
        <ActionRow>
          <Chip href={backHref}>Manage sources</Chip>
        </ActionRow>
      </>
    )
  return (
    <SourceDetailContent
      key={`${organization.id}:${connectorId}`}
      connector={connector}
      syncing={syncing}
      scope={scope}
      backHref={surfaceHref(
        surface,
        `/settings/integrations/providers/${encodeURIComponent(connector.connectorType)}`
      )}
      backText={CONNECTOR_META_REGISTRY[connector.connectorType]?.name ?? 'Integration'}
      queryError={
        failure ? (
          <FailureNotice
            message={getErrorMessage(failure.error, 'Could not refresh connection')}
            retrying={failure.retrying}
            onRetry={failure.retry}
          />
        ) : undefined
      }
    />
  )
}

interface SourceDetailContentProps {
  connector: ConnectorDetailData
  syncing: boolean
  scope: ResourceScope
  backHref: string
  backText: string
  queryError?: ReactNode
}

function SourceDetailContent({
  connector,
  syncing,
  scope,
  backHref,
  backText,
  queryError,
}: SourceDetailContentProps) {
  useOAuthReturnForKBConnectors(
    connector.knowledgeBaseId,
    undefined,
    connector.connectorType,
    scope,
    connector.id
  )
  const { organization } = useOrganization()
  const surface = useSurfaceScope()
  const integration = useSourceIntegrationStatus(organization.id, connector.connectorType)
  const router = useRouter()
  const meta = CONNECTOR_META_REGISTRY[connector.connectorType]
  const title = meta
    ? describeSearchSource(meta, connector.sourceConfig) || meta.name
    : 'Connection'
  const { effectiveStatus } = getConnectorSyncState(connector)
  const status =
    effectiveStatus === 'paused'
      ? 'Search paused'
      : effectiveStatus === 'disabled'
        ? 'Search disabled'
        : undefined
  const description =
    [title === meta?.name ? undefined : meta?.name, status].filter(Boolean).join(' · ') || undefined
  const onBack = () => router.push(backHref)
  const onRemoved = () => router.replace(surfaceHref(surface, '/settings/integrations'))
  const integrationFailure = integration.failure && (
    <FailureNotice
      message={integration.failure.message}
      retrying={integration.failure.retrying}
      onRetry={integration.failure.retry}
    />
  )
  if (integration.accessDenied)
    return (
      <SectionStack>
        <DetailHeader backLabel={backText} onBack={onBack} title='Connection' />
        {integrationFailure}
      </SectionStack>
    )
  return (
    <SourceSettingsEditor
      key={connector.id}
      connector={connector}
      syncing={syncing}
      scope={scope}
      title={title}
      description={description}
      queryError={
        <>
          {queryError}
          {integrationFailure}
          {integration.deactivated && (
            <InlineNotice
              intent='warning'
              title={`${meta?.name ?? 'This integration'} is deactivated`}
              message='Its content is unavailable in Search, Assistant, and MCP.'
            />
          )}
        </>
      }
      backText={backText}
      onBack={onBack}
      onRemoved={onRemoved}
    />
  )
}

interface SourceSettingsEditorProps {
  connector: ConnectorData
  syncing: boolean
  scope: ResourceScope
  title: string
  description?: string
  queryError?: ReactNode
  backText: string
  onBack: () => void
  onRemoved: () => void
}

function SourceSettingsEditor(props: SourceSettingsEditorProps) {
  const [draft, setDraft] = useState({ connector: props.connector, revision: 0 })
  const reset = (connector: ConnectorData) =>
    setDraft((previous) => ({ connector, revision: previous.revision + 1 }))
  return (
    <SourceSettingsForm
      key={draft.revision}
      connector={props.connector}
      syncing={props.syncing}
      scope={props.scope}
      title={props.title}
      description={props.description}
      queryError={props.queryError}
      backText={props.backText}
      onBack={props.onBack}
      onRemoved={props.onRemoved}
      baseline={draft.connector}
      onSaved={reset}
      onDiscard={() => reset(props.connector)}
    />
  )
}

interface SourceSettingsFormProps extends SourceSettingsEditorProps {
  baseline: ConnectorData
  onSaved: (connector: ConnectorData) => void
  onDiscard: () => void
}

function SourceSettingsForm({
  connector,
  syncing,
  baseline,
  scope,
  title,
  description,
  queryError,
  backText,
  onBack,
  onRemoved,
  onSaved,
  onDiscard,
}: SourceSettingsFormProps) {
  const form = useConnectorSettingsForm({
    connector: baseline,
    syncing,
    scope,
    knowledgeBaseId: connector.knowledgeBaseId,
    isSearchIndex: true,
    onSaved,
  })
  const guard = useSettingsUnsavedGuard({
    isDirty: form.dirty,
    navigationBlocked: form.saving,
    onDiscard,
  })
  const lifecycle = useConnectorActions({
    connector,
    knowledgeBaseId: connector.knowledgeBaseId,
    canEdit: true,
    disabled: form.dirty || form.saving,
    primarySync: false,
    onRemoved,
  })
  const { removal } = lifecycle
  const menu = lifecycle.actions
    .filter((action) => action.id !== 'sync')
    .map((action) => ({
      id: action.id ?? action.text,
      label: `${
        action.id === 'pause'
          ? connector.status === 'paused'
            ? 'Resume search'
            : 'Pause search'
          : action.text
      }${action.disabled && action.tooltip ? ` (${action.tooltip})` : ''}`,
      disabled: action.disabled,
      destructive: action.id === 'delete',
      separatorBefore: action.id === 'delete',
      onSelect: action.onSelect,
    }))
  return (
    <SectionStack>
      <DetailHeader
        backLabel={backText}
        onBack={() => guard.guardBack(onBack)}
        title={title}
        description={description}
      >
        {form.docsUrl && (
          <Button
            variant='quiet'
            size='compact'
            render={
              <a href={form.docsUrl} target='_blank' rel='noopener noreferrer'>
                Docs
              </a>
            }
          >
            Docs
          </Button>
        )}
        <ActionMenu label='Connection actions' icon='I108' actions={menu} />
      </DetailHeader>
      {lifecycle.error && <InlineNotice intent='danger' message={lifecycle.error.message} />}
      {queryError}
      <SettingsSection title='Connection'>
        {connector.connectorType === 'gitlab' && (
          <SettingsRow label='Organization-managed GitLab' />
        )}
        <FieldStack>
          <ConnectorSettingsFields fields={form.fieldsProps} />
        </FieldStack>
      </SettingsSection>
      <SaveActions
        dirty={form.dirty}
        saving={form.saving}
        blocked={!form.canSave}
        blockedReason={form.saveBlockedReason}
        onSave={form.save}
        onDiscard={onDiscard}
      />
      <ConfirmDialog
        target={removal.open}
        onClose={() => removal.onOpenChange(false)}
        title='Remove connection'
        description={
          removal.requiresDocumentDeletion
            ? 'This removes the connection, stops future syncs, and deletes its synced documents from Sim.'
            : 'This removes the connection and stops future syncs. Synced documents remain unless you delete them below.'
        }
        confirmLabel='Remove'
        pendingLabel='Removing…'
        confirmDisabled={removal.disabled}
        pending={removal.pending}
        onConfirm={async () => {
          await removal.onConfirm()
          return false
        }}
      >
        {!removal.requiresDocumentDeletion && (
          <Checkbox
            label='Also delete synced documents'
            checked={removal.deleteDocuments}
            disabled={removal.pending}
            onCheckedChange={(checked) => removal.setDeleteDocuments(checked)}
          />
        )}
        {removal.error && <InlineNotice intent='danger' message={removal.error.message} />}
      </ConfirmDialog>
    </SectionStack>
  )
}
