'use client'

import { type ReactNode, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import type { ConnectorData, ConnectorDetailData } from '@/lib/api/contracts/knowledge/connectors'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  ActionRow,
  DetailHeader,
  FieldStack,
  LoadingState,
  Muted,
  SectionStack,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { ConnectorSettingsFields } from '@/platform/app/(shell)/settings/_components/sections/integrations/connector-settings-fields'
import {
  ActionMenu,
  Button,
  Checkbox,
  Chip,
  ConfirmDialog,
  EmptyState,
  FailureNotice,
  InlineNotice,
  SaveActions,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import {
  CONNECTOR_META_REGISTRY,
  describeSearchSource,
  getConnectorSyncState,
  isApiClientError,
  isConnectorSyncingOrPending,
  organizationRoutes,
  useConnectorActions,
  useConnectorDetail,
  useConnectorSettingsForm,
  useOAuthReturnForKBConnectors,
  useSearchIndex,
  useSearchIntegrations,
} from '@/platform/lib/data/sources'

interface SourceDetailProps {
  connectorId: string
}

const ACCESS_FAILURE = [401, 403, 404]

function isAccessFailure(error: unknown) {
  return isApiClientError(error) && ACCESS_FAILURE.includes(error.status)
}

export function SourceDetail({ connectorId }: SourceDetailProps) {
  const { organization, viewer } = useOrganizationContext()
  const router = useRouter()
  const scope: ResourceScope = { kind: 'organization', organizationId: organization.id }
  const backHref = organizationRoutes(organization.id).settingsSection('integrations')
  const index = useSearchIndex(scope, { enabled: viewer.isAdmin })
  const knowledgeBaseId = viewer.isAdmin ? (index.data?.knowledgeBaseId ?? undefined) : undefined
  const detail = useConnectorDetail(knowledgeBaseId, connectorId)
  const shell = (title: string, children: ReactNode) => (
    <SectionStack>
      <DetailHeader backLabel='Sources' onBack={() => router.push(backHref)} title={title} />
      {children}
    </SectionStack>
  )

  if (!viewer.isAdmin)
    return shell('Connection', <EmptyState title='Only organization admins can manage sources.' />)
  const accessFailure = [index, detail].find(
    (query) => query.isError && isAccessFailure(query.error)
  )
  const failedQuery = accessFailure ?? (index.isError ? index : detail.isError ? detail : null)
  const hasCanonicalDetail = Boolean(
    detail.data &&
      !detail.isPlaceholderData &&
      detail.data.id === connectorId &&
      detail.data.knowledgeBaseId === knowledgeBaseId
  )
  if (failedQuery && (!hasCanonicalDetail || accessFailure))
    return shell(
      'Connection',
      isApiClientError(failedQuery.error) && failedQuery.error.status === 404 ? (
        <EmptyState title='This connection is no longer available.' />
      ) : (
        <FailureNotice
          message={getErrorMessage(failedQuery.error, 'Could not load connection')}
          retrying={failedQuery.isFetching}
          onRetry={() => void failedQuery.refetch()}
        />
      )
    )
  if (!index.isPending && !knowledgeBaseId)
    return shell('Connection', <EmptyState title='This connection is no longer available.' />)
  if (
    !detail.data ||
    detail.isPlaceholderData ||
    detail.data.id !== connectorId ||
    detail.data.knowledgeBaseId !== knowledgeBaseId
  )
    return shell('Connection', <LoadingState label='Loading connection' />)
  if (
    detail.data.accessMode === 'members' &&
    !(detail.data.connectorType === 'github' && detail.data.sourceConfig.githubRepositoryId)
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
      connector={detail.data}
      scope={scope}
      backHref={organizationRoutes(organization.id).searchProvider(detail.data.connectorType)}
      backText={CONNECTOR_META_REGISTRY[detail.data.connectorType]?.name ?? 'Integration'}
      queryError={
        failedQuery ? (
          <FailureNotice
            message={getErrorMessage(failedQuery.error, 'Could not refresh connection')}
            retrying={failedQuery.isFetching}
            onRetry={() => void failedQuery.refetch()}
          />
        ) : undefined
      }
    />
  )
}

interface SourceDetailContentProps {
  connector: ConnectorDetailData
  scope: ResourceScope
  backHref: string
  backText: string
  queryError?: ReactNode
}

function SourceDetailContent({
  connector,
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
  const { organization } = useOrganizationContext()
  const integrations = useSearchIntegrations(organization.id)
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
  const onRemoved = () =>
    router.replace(organizationRoutes(organization.id).settingsSection('integrations'))
  const integrationFailure = integrations.isError && (
    <FailureNotice
      message={getErrorMessage(integrations.error, 'Could not load integration status')}
      retrying={integrations.isFetching}
      onRetry={() => void integrations.refetch()}
    />
  )
  if (integrations.isError && isAccessFailure(integrations.error))
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
      scope={scope}
      title={title}
      description={description}
      queryError={
        <>
          {queryError}
          {integrationFailure ||
            (integrations.isPending && <Muted>Loading integration status</Muted>)}
          {integrations.data?.find((item) => item.connectorType === connector.connectorType)
            ?.approved === false && (
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
      {...props}
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
    syncing: isConnectorSyncingOrPending(connector),
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
          <SettingsRow
            label='Organization-managed GitLab'
            description='Admin tokens check current permissions. Other tokens use the CSV mappings below.'
          />
        )}
        <FieldStack>
          <ConnectorSettingsFields {...form.fieldsProps} />
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
        onConfirm={() => {
          removal.onConfirm()
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
