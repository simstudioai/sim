'use client'

import { type ReactNode, useState } from 'react'
import { ChipModalTabs } from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { saveDiscardActions } from '@/components/settings/save-discard-actions'
import type { SettingsAction, SettingsBackAction } from '@/components/settings/settings-header'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { useSettingsUnsavedGuard } from '@/components/settings/use-settings-unsaved-guard'
import { isApiClientError } from '@/lib/api/client/errors'
import type { ConnectorData, ConnectorDetailData } from '@/lib/api/contracts/knowledge/connectors'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { organizationRoutes } from '@/lib/navigation/paths'
import { describeSearchSource } from '@/lib/sim-search/source-identity'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  type SourceView,
  sourceDocumentFilterParam,
  sourceViewParam,
} from '@/app/o/[organizationId]/settings/integrations/sources/[connectorId]/search-params'
import { UnsavedChangesModal } from '@/app/workspace/[workspaceId]/components/credential-detail/components/unsaved-changes-modal'
import { ConnectorDocuments } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-documents/connector-documents'
import {
  ConnectorRecovery,
  ConnectorSyncHistory,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section'
import { ConnectorActionFeedback } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/connector-actions'
import { getConnectorSyncState } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/connector-sync-state'
import { useConnectorActions } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/use-connector-actions'
import { ConnectorSettingsFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/connector-settings-fields'
import { useConnectorSettingsForm } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/use-connector-settings-form'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import {
  isConnectorSyncingOrPending,
  useConnectorDetail,
  useSearchIndex,
} from '@/hooks/queries/kb/connectors'
import { useSearchIntegrations } from '@/hooks/queries/search-integrations'
import { useDebounce } from '@/hooks/use-debounce'
import { useOAuthReturnForKBConnectors } from '@/hooks/use-oauth-return'

const SOURCE_VIEWS = [
  { value: 'documents', label: 'Documents' },
  { value: 'settings', label: 'Settings' },
  { value: 'history', label: 'Sync history' },
] as const

interface OrganizationSourceDetailProps {
  connectorId: string
}

export function OrganizationSourceDetail({ connectorId }: OrganizationSourceDetailProps) {
  const { organization, viewer } = useOrganizationContext()
  const router = useRouter()
  const scope: ResourceScope = { kind: 'organization', organizationId: organization.id }
  const backHref = organizationRoutes(organization.id).settingsSection('integrations')
  const index = useSearchIndex(scope, { enabled: viewer.isAdmin })
  const knowledgeBaseId = viewer.isAdmin ? (index.data?.knowledgeBaseId ?? undefined) : undefined
  const detail = useConnectorDetail(knowledgeBaseId, connectorId)
  const back = { text: 'Sources', icon: ArrowLeft, onSelect: () => router.push(backHref) }

  if (!viewer.isAdmin)
    return (
      <SettingsPanel back={back} title='Search source'>
        <SettingsEmptyState variant='inline'>
          Only organization admins can manage sources.
        </SettingsEmptyState>
      </SettingsPanel>
    )
  const accessFailure = [index, detail].find(
    (query) =>
      query.isError && isApiClientError(query.error) && [401, 403, 404].includes(query.error.status)
  )
  const failedQuery = accessFailure ?? (index.isError ? index : detail.isError ? detail : null)
  const hasCanonicalDetail = Boolean(
    detail.data &&
      !detail.isPlaceholderData &&
      detail.data.id === connectorId &&
      detail.data.knowledgeBaseId === knowledgeBaseId
  )
  if (failedQuery && (!hasCanonicalDetail || accessFailure))
    return (
      <SettingsPanel back={back} title='Search source'>
        {isApiClientError(failedQuery.error) && failedQuery.error.status === 404 ? (
          <SettingsEmptyState variant='inline'>
            This source is no longer available.
          </SettingsEmptyState>
        ) : (
          <SettingsQueryErrorState
            error={failedQuery.error}
            isRetrying={failedQuery.isFetching}
            onRetry={() => void failedQuery.refetch()}
            fallback='Could not load source'
            variant='inline'
          />
        )}
      </SettingsPanel>
    )
  if (!index.isPending && !knowledgeBaseId)
    return (
      <SettingsPanel back={back} title='Search source'>
        <SettingsEmptyState variant='inline'>
          This source is no longer available.
        </SettingsEmptyState>
      </SettingsPanel>
    )
  if (
    !detail.data ||
    detail.isPlaceholderData ||
    detail.data.id !== connectorId ||
    detail.data.knowledgeBaseId !== knowledgeBaseId
  )
    return (
      <SettingsPanel back={back} title='Search source'>
        <SettingsEmptyState variant='inline'>Loading source…</SettingsEmptyState>
      </SettingsPanel>
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
          <SettingsQueryErrorState
            error={failedQuery.error}
            isRetrying={failedQuery.isFetching}
            onRetry={() => void failedQuery.refetch()}
            fallback='Could not refresh source'
            variant='inline'
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
  const [view, setView] = useQueryState(
    sourceViewParam.key,
    sourceViewParam.parser.withOptions({ history: 'replace' })
  )
  const [filter, setFilter] = useQueryState(
    sourceDocumentFilterParam.key,
    sourceDocumentFilterParam.parser
  )
  const [search, setSearch] = useSettingsSearch()
  const documentSearch = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS)
  const meta = CONNECTOR_META_REGISTRY[connector.connectorType]
  const title = meta
    ? describeSearchSource(meta, connector.sourceConfig) || meta.name
    : 'Search source'
  const { effectiveStatus, lastSyncError } = getConnectorSyncState(connector)
  const status =
    effectiveStatus === 'paused'
      ? 'Sync paused'
      : effectiveStatus === 'disabled'
        ? 'Sync disabled'
        : effectiveStatus === 'error'
          ? 'Sync needs attention'
          : undefined
  const description =
    [title === meta?.name ? undefined : meta?.name, status].filter(Boolean).join(' · ') || undefined
  const onBack = () => router.push(backHref)
  const onViewChange = (value: string) => {
    const next = sourceViewParam.parser.parse(value)
    if (next) void setView(next)
  }
  if (
    integrations.isError &&
    isApiClientError(integrations.error) &&
    [401, 403, 404].includes(integrations.error.status)
  )
    return (
      <SettingsPanel
        back={{ text: backText, icon: ArrowLeft, onSelect: onBack }}
        title='Search source'
      >
        <SettingsQueryErrorState
          error={integrations.error}
          isRetrying={integrations.isFetching}
          onRetry={() => void integrations.refetch()}
          fallback='Could not load integration status'
          variant='inline'
        />
      </SettingsPanel>
    )
  const integrationFeedback = (
    <>
      {queryError}
      {integrations.isError ? (
        <SettingsQueryErrorState
          error={integrations.error}
          isRetrying={integrations.isFetching}
          onRetry={() => void integrations.refetch()}
          fallback='Could not load integration status'
          variant='inline'
        />
      ) : integrations.isPending ? (
        <SettingsEmptyState variant='inline'>Loading integration status…</SettingsEmptyState>
      ) : null}
      {integrations.data?.find((item) => item.connectorType === connector.connectorType)
        ?.approved === false && (
        <SettingsResourceRow
          title={`${meta?.name ?? 'This integration'} is deactivated`}
          description='Its content is unavailable in Search, Assistant, and MCP.'
        />
      )}
    </>
  )
  if (view === 'settings')
    return (
      <SourceSettingsEditor
        key={connector.id}
        connector={connector}
        scope={scope}
        title={title}
        description={description}
        queryError={integrationFeedback}
        backText={backText}
        onBack={onBack}
        onViewChange={onViewChange}
      />
    )
  return (
    <SourcePanel
      connector={connector}
      back={{ text: backText, icon: ArrowLeft, onSelect: onBack }}
      title={title}
      description={description}
      docsLink={meta?.searchDocsUrl}
      onRemoved={onBack}
    >
      {integrationFeedback}
      <SourceNavigation view={view} onViewChange={onViewChange} />
      {effectiveStatus === 'active' && lastSyncError && (
        <SettingsResourceRow
          title='Some source updates are incomplete'
          description='Review the source settings and try syncing again.'
        />
      )}
      <ConnectorRecovery
        connector={connector}
        knowledgeBaseId={connector.knowledgeBaseId}
        scope={scope}
        isSearchIndex
        canEdit
        onEdit={() => onViewChange('settings')}
      />
      {view === 'documents' ? (
        <ConnectorDocuments
          knowledgeBaseId={connector.knowledgeBaseId}
          connectorId={connector.id}
          search={documentSearch}
          searchControl={{ value: search, onChange: setSearch }}
          filter={filter}
          onFilterChange={(next) => void setFilter(next)}
          progressScope={scope}
          isSearchIndex
          syncing={isConnectorSyncingOrPending(connector)}
        />
      ) : (
        <ConnectorSyncHistory
          connector={connector}
          knowledgeBaseId={connector.knowledgeBaseId}
          detail={connector}
        />
      )}
    </SourcePanel>
  )
}

interface SourceNavigationProps {
  view: SourceView
  onViewChange: (view: string) => void
}

function SourceNavigation({ view, onViewChange }: SourceNavigationProps) {
  return (
    <div>
      <ChipModalTabs
        tabs={SOURCE_VIEWS}
        value={view}
        onChange={onViewChange}
        aria-label='Source views'
      />
    </div>
  )
}

interface SourcePanelProps {
  connector: ConnectorData
  back: SettingsBackAction
  title: string
  description?: string
  docsLink?: string
  actions?: SettingsAction[]
  lifecycleDisabled?: boolean
  onRemoved: () => void
  children: ReactNode
}

function SourcePanel({
  connector,
  actions,
  lifecycleDisabled,
  onRemoved,
  children,
  ...panel
}: SourcePanelProps) {
  const lifecycle = useConnectorActions({
    connector,
    knowledgeBaseId: connector.knowledgeBaseId,
    canEdit: true,
    disabled: lifecycleDisabled,
    primarySync: !actions,
    onRemoved,
  })
  return (
    <SettingsPanel {...panel} actions={[...lifecycle.actions, ...(actions ?? [])]}>
      <ConnectorActionFeedback state={lifecycle} />
      {children}
    </SettingsPanel>
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
  onViewChange: (view: string) => void
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
  onViewChange,
  onSaved,
  onDiscard,
}: SourceSettingsFormProps) {
  const form = useConnectorSettingsForm({
    connector: baseline,
    scope,
    knowledgeBaseId: connector.knowledgeBaseId,
    isSearchIndex: true,
    onSaved,
  })
  const guard = useSettingsUnsavedGuard({ isDirty: form.dirty, navigationBlocked: form.saving })
  return (
    <SourcePanel
      connector={connector}
      back={{ text: backText, icon: ArrowLeft, onSelect: () => guard.guardBack(onBack) }}
      title={title}
      description={description}
      docsLink={form.docsUrl}
      lifecycleDisabled={form.dirty || form.saving}
      onRemoved={onBack}
      actions={saveDiscardActions({
        dirty: form.dirty,
        saving: form.saving,
        saveDisabled: !form.canSave,
        onSave: form.save,
        onDiscard,
      })}
    >
      {queryError}
      <SourceNavigation
        view='settings'
        onViewChange={(next) => {
          if (next !== 'settings') guard.guardBack(() => onViewChange(next))
        }}
      />
      <div className='-mx-2 flex flex-col gap-4'>
        <ConnectorSettingsFields {...form.fieldsProps} />
      </div>
      <UnsavedChangesModal
        open={guard.showUnsavedModal}
        onOpenChange={guard.setShowUnsavedModal}
        onDiscard={guard.confirmDiscard}
      />
    </SourcePanel>
  )
}
