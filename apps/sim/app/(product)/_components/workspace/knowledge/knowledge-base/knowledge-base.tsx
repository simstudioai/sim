'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { type BreadcrumbItem, Breadcrumbs } from '@sim/emcn/breadcrumbs'
import { Button } from '@sim/emcn/button'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { Pagination } from '@sim/emcn/pagination'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { SearchField } from '@sim/emcn/search-field'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { notFound, useRouter, useSearchParams } from 'next/navigation'
import { useQueryState, useQueryStates } from 'nuqs'
import {
  type PageCommand,
  usePageCommands,
} from '@/app/(product)/_components/command-menu/page-commands'
import { ControlBar } from '@/app/(product)/_components/control-bar/control-bar'
import { AddConnectorModal } from '@/app/(product)/_components/workspace/knowledge/add-connector-modal/add-connector-modal'
import { AddDocumentsModal } from '@/app/(product)/_components/workspace/knowledge/add-documents-modal/add-documents-modal'
import { BaseTagsModal } from '@/app/(product)/_components/workspace/knowledge/base-tags-modal/base-tags-modal'
import { ConnectorModal } from '@/app/(product)/_components/workspace/knowledge/connector-modal/connector-modal'
import { ConnectorsRail } from '@/app/(product)/_components/workspace/knowledge/connectors-rail/connectors-rail'
import {
  DocumentStatus,
  DocumentTags,
  UploadedDate,
} from '@/app/(product)/_components/workspace/knowledge/document-cells/document-cells'
import { DocumentTagsModal } from '@/app/(product)/_components/workspace/knowledge/document-tags-modal/document-tags-modal'
import styles from '@/app/(product)/_components/workspace/knowledge/knowledge-base/knowledge-base.module.css'
import {
  connectorMark,
  documentHref,
  documentIcon,
  formatTokens,
  knowledgeListHref,
} from '@/app/(product)/_components/workspace/knowledge/knowledge-base/model'
import { RenameModal } from '@/app/(product)/_components/workspace/knowledge/rename-modal/rename-modal'
import {
  activeTagFilters,
  TagFilter,
  type TagFilterEntry,
} from '@/app/(product)/_components/workspace/knowledge/tag-filter/tag-filter'
import {
  type ResourceColumn,
  type ResourceRow,
  ResourceTable,
} from '@/app/(product)/_components/workspace/resource-table/resource-table'
import { useResourceSelection } from '@/app/(product)/_components/workspace/resource-table/use-resource-selection'
import {
  LiveWorkspacePage,
  useEmbeddedWorkspacePage,
  WorkspaceEmpty,
} from '@/app/(product)/_components/workspace/workspace-page/workspace-page'
import {
  addConnectorParser,
  type DocumentData,
  documentListParsers,
  documentSortParams,
  downloadKnowledgeBaseExport,
  formatFileSize,
  getDocumentIndexingStatus,
  hasProcessingDocuments,
  KNOWLEDGE_DOCUMENT_PROCESSING_STALE_THRESHOLD_MS,
  knowledgeUrlOptions,
  SEARCH_DEBOUNCE_MS,
  useBulkDocumentOperation,
  useCaptureWhenReady,
  useDebounce,
  useDebouncedSearchSetter,
  useDeleteDocument,
  useDeleteKnowledgeBase,
  useFolderMap,
  useKnowledgeAccess,
  useKnowledgeBase,
  useKnowledgeBaseDocuments,
  useKnowledgeBaseRecord,
  useTagDefinitionsQuery,
  useUpdateDocument,
  useUpdateKnowledgeBase,
  useUrlSort,
} from '@/platform/lib/data/knowledge'
import {
  type ConnectorData,
  isConnectorSyncingOrPending,
  useConnectorList,
  useOAuthReturnForKBConnectors,
} from '@/platform/lib/data/knowledge/connectors'
import { folderChain } from '@/platform/lib/folder-chain'

const DOCUMENTS_PER_PAGE = 50
/** While a document indexes, its own status is what moves. */
const PROCESSING_POLL_MS = 3000
/** While only a connector syncs, rows arrive in batches. */
const CONNECTOR_SYNC_POLL_MS = 5000
const NO_CONNECTORS: ConnectorData[] = []

/**
 * Beside the connectors rail the list is narrow, so Uploaded gives way before Tags: the document
 * page keeps the full timestamp, while tags are what the list filters by.
 */
const COLUMNS: readonly ResourceColumn[] = [
  { id: 'size', label: 'Size', numeric: true, width: 'compact' },
  { id: 'tokens', label: 'Tokens', numeric: true, width: 'tight' },
  { id: 'chunks', label: 'Chunks', numeric: true, width: 'tight' },
  { id: 'uploaded', label: 'Uploaded', width: 'compact', optional: true },
  { id: 'status', label: 'Status', narrow: true },
  { id: 'tags', label: 'Tags' },
]

const SORTS = [
  { column: 'uploadedAt', heading: 'Uploaded', desc: 'Newest first', asc: 'Oldest first' },
  { column: 'filename', heading: 'Name', asc: 'A to Z', desc: 'Z to A' },
  { column: 'fileSize', heading: 'Size', desc: 'Largest first', asc: 'Smallest first' },
  { column: 'tokenCount', heading: 'Tokens', desc: 'Most first', asc: 'Fewest first' },
  { column: 'chunkCount', heading: 'Chunks', desc: 'Most first', asc: 'Fewest first' },
  { column: 'enabled', heading: 'Status', desc: 'Enabled first', asc: 'Disabled first' },
] as const

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
] as const

/**
 * One processing run, not one document: a retried document starts a new run with a new start time,
 * so a later stall is reported again without the set being pruned.
 */
function processKey(document: Pick<DocumentData, 'id' | 'processingStartedAt'>) {
  return `${document.id}:${document.processingStartedAt ?? ''}`
}

function documents(count: number) {
  return `${count.toLocaleString()} document${count === 1 ? '' : 's'}`
}

interface KnowledgeBaseProps {
  workspaceId: string
  knowledgeBaseId: string
}

/**
 * A knowledge base: its documents in the Logs list's anatomy, with search, filters, sort, paging and
 * bulk actions, beside a rail of the connectors that sync into it. The base's crumb carries its own
 * commands; a document opens its chunks once it has finished indexing.
 */
export function KnowledgeBase({ workspaceId, knowledgeBaseId }: KnowledgeBaseProps) {
  const router = useRouter()
  const search = useSearchParams()
  const embedded = useEmbeddedWorkspacePage()
  const access = useKnowledgeAccess(workspaceId)
  const canEdit = access.canEdit
  useOAuthReturnForKBConnectors(knowledgeBaseId)

  const [{ q, enabled, page }, setFilters] = useQueryStates(
    documentListParsers,
    knowledgeUrlOptions
  )
  const sort = useUrlSort(documentSortParams, knowledgeUrlOptions)
  const [addConnector, setAddConnector] = useQueryState('addConnector', addConnectorParser)
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setFilters({ q: value, page: null }, options)
  )
  const query = useDebounce(q, SEARCH_DEBOUNCE_MS).trim()
  const highlight = q.trim()
  const [tagEntries, setTagEntries] = useState<TagFilterEntry[]>([])
  const tagFilters = activeTagFilters(tagEntries)

  const base = useKnowledgeBase(knowledgeBaseId)
  const record = useKnowledgeBaseRecord(knowledgeBaseId)
  const knowledgeBase = base.knowledgeBase
  useCaptureWhenReady(
    'knowledge_base_opened',
    knowledgeBase
      ? { knowledge_base_id: knowledgeBaseId, knowledge_base_name: knowledgeBase.name }
      : null,
    knowledgeBaseId
  )
  const connectorsQuery = useConnectorList(knowledgeBaseId)
  const connectors = connectorsQuery.data ?? NO_CONNECTORS
  const syncing = connectors.some(isConnectorSyncingOrPending)
  const syncingRef = useRef(syncing)
  syncingRef.current = syncing
  const deleteBase = useDeleteKnowledgeBase()

  const list = useKnowledgeBaseDocuments(knowledgeBaseId, {
    search: query || undefined,
    limit: DOCUMENTS_PER_PAGE,
    offset: (Math.max(1, page) - 1) * DOCUMENTS_PER_PAGE,
    sortBy: sort.sort,
    sortOrder: sort.dir,
    enabledFilter: enabled,
    tagFilters: tagFilters.length > 0 ? tagFilters : undefined,
    refetchInterval: (data) => {
      if (deleteBase.isPending) return false
      if (hasProcessingDocuments(data?.documents ?? [])) return PROCESSING_POLL_MS
      if (syncingRef.current) return CONNECTOR_SYNC_POLL_MS
      return false
    },
  })
  const rowsData = list.documents
  const total = list.pagination.total
  const pageCount = Math.max(1, Math.ceil(total / DOCUMENTS_PER_PAGE))
  const tagDefinitions = useTagDefinitionsQuery(knowledgeBaseId).data ?? []
  const folders = useFolderMap(workspaceId, 'knowledge_base').data

  const updateDocument = useUpdateDocument()
  const deleteDocument = useDeleteDocument()
  const bulk = useBulkDocumentOperation()
  const updateBase = useUpdateKnowledgeBase()

  const [tagsOpen, setTagsOpen] = useState(false)
  const [renamingBase, setRenamingBase] = useState(false)
  const [deletingBase, setDeletingBase] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [renaming, setRenaming] = useState<DocumentData | null>(null)
  const [taggingId, setTaggingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [openConnectorId, setOpenConnectorId] = useState<string | null>(null)
  const [allMode, setAllMode] = useState(false)

  /** Stable while the page's rows are, as the selection compares it by identity. */
  const rowIds = useMemo(() => rowsData.map((document) => document.id), [rowsData])
  const selection = useResourceSelection({
    rowIds,
    onDelete: canEdit ? () => setBulkDeleting(true) : undefined,
  })
  const selected = rowsData.filter((document) => selection.selected.has(document.id))
  const allSelected = allMode && rowsData.length > 0 && selected.length === rowsData.length
  const selectedCount = allSelected ? total : selected.length
  const enabledCount = allSelected
    ? enabled === 'disabled'
      ? 0
      : total
    : selected.filter((document) => document.enabled).length
  const disabledCount = allSelected
    ? enabled === 'enabled'
      ? 0
      : total
    : selected.filter((document) => !document.enabled).length

  /** A sync that just finished leaves new documents and counts behind; read them once. */
  const wasSyncing = useRef(false)
  useEffect(() => {
    if (wasSyncing.current && !syncing) {
      void base.refresh()
      void list.refreshDocuments()
    }
    wasSyncing.current = syncing
  }, [syncing, base.refresh, list.refreshDocuments])

  /**
   * Processing runs already reported as stalled. The list polls while anything processes, so each
   * poll would otherwise report the same stalled document again until the server's answer lands.
   */
  const reportedStalls = useRef<Set<string> | null>(null)
  const markFailed = updateDocument.mutate
  useEffect(() => {
    const reported = (reportedStalls.current ??= new Set())
    const now = Date.now()
    for (const document of rowsData) {
      if (document.processingStatus !== 'processing' || !document.processingStartedAt) continue
      const key = processKey(document)
      if (reported.has(key)) continue
      if (
        now - new Date(document.processingStartedAt).getTime() <=
        KNOWLEDGE_DOCUMENT_PROCESSING_STALE_THRESHOLD_MS
      )
        continue
      reported.add(key)
      markFailed(
        {
          knowledgeBaseId,
          documentId: document.id,
          updates: { markFailedDueToTimeout: true },
        },
        { onError: () => reported.delete(key) }
      )
    }
  }, [rowsData, knowledgeBaseId, markFailed])

  function resetSelection() {
    selection.clear()
    setAllMode(false)
  }

  function toggleEnabled(document: DocumentData) {
    const next = !document.enabled
    list.updateDocument(document.id, { enabled: next })
    updateDocument.mutate(
      { knowledgeBaseId, documentId: document.id, updates: { enabled: next } },
      { onError: () => list.updateDocument(document.id, { enabled: !next }) }
    )
  }

  function retry(document: DocumentData) {
    list.updateDocument(document.id, {
      processingStatus: 'pending',
      processingError: null,
      processingStartedAt: null,
      processingCompletedAt: null,
    })
    updateDocument.mutate(
      { knowledgeBaseId, documentId: document.id, updates: { retryProcessing: true } },
      {
        onError: (error) =>
          list.updateDocument(document.id, {
            processingStatus: 'failed',
            processingError: getErrorMessage(error, 'Failed to retry document processing'),
          }),
      }
    )
  }

  function runBulk(operation: 'enable' | 'disable' | 'delete') {
    if (allSelected) {
      return bulk.mutateAsync(
        { knowledgeBaseId, operation, selectAll: true, enabledFilter: enabled },
        { onSuccess: resetSelection }
      )
    }
    const targets = selected.filter((document) =>
      operation === 'enable' ? !document.enabled : operation === 'disable' ? document.enabled : true
    )
    if (targets.length === 0) return undefined
    return bulk.mutateAsync(
      { knowledgeBaseId, operation, documentIds: targets.map((document) => document.id) },
      {
        onSuccess: (result) => {
          for (const document of result.updatedDocuments ?? [])
            list.updateDocument(document.id, { enabled: document.enabled })
          resetSelection()
        },
      }
    )
  }

  const filtersActive = enabled !== 'all' || tagFilters.length > 0
  function clearFilters() {
    setTagEntries([])
    resetSelection()
    void setFilters({ q: null, enabled: null, page: null })
  }

  function openInNewTab(document: DocumentData) {
    window.open(
      documentHref(workspaceId, knowledgeBaseId, document.id, search),
      '_blank',
      'noopener'
    )
  }

  function rowActions(row: ResourceRow): readonly MenuAction[] {
    const document = rowsData.find((entry) => entry.id === row.id)
    if (!document) return []
    const multiple = selectedCount > 1 && selection.selected.has(document.id)
    const busy =
      document.processingStatus === 'processing' || document.processingStatus === 'pending'
    const toggleLabel = multiple
      ? disabledCount > 0
        ? allSelected && enabled === 'all'
          ? 'Enable selected items'
          : `Enable ${disabledCount.toLocaleString()} items`
        : allSelected && enabled === 'all'
          ? 'Disable selected items'
          : `Disable ${enabledCount.toLocaleString()} items`
      : document.enabled
        ? 'Disable'
        : 'Enable'
    const actions: MenuAction[] = []
    if (!multiple) {
      actions.push({ id: 'open', label: 'Open in new tab', onSelect: () => openInNewTab(document) })
      const sourceUrl = document.sourceUrl
      if (sourceUrl)
        actions.push({
          id: 'source',
          label: 'Open source',
          onSelect: () => window.open(sourceUrl, '_blank', 'noopener,noreferrer'),
        })
      actions.push({
        id: 'rename',
        label: 'Rename',
        disabled: !canEdit,
        onSelect: () => setRenaming(document),
      })
      if (canEdit)
        actions.push({ id: 'tags', label: 'Tags', onSelect: () => setTaggingId(document.id) })
    }
    actions.push({
      id: 'toggle',
      label: toggleLabel,
      disabled: !canEdit || (!multiple && busy),
      onSelect: () => {
        if (!multiple) toggleEnabled(document)
        else void runBulk(disabledCount > 0 ? 'enable' : 'disable')
      },
    })
    if (!multiple && canEdit && getDocumentIndexingStatus(document) === 'failed')
      actions.push({ id: 'retry', label: 'Retry', onSelect: () => retry(document) })
    actions.push({
      id: 'delete',
      label: multiple ? `Delete ${selectedCount.toLocaleString()} items` : 'Delete',
      destructive: true,
      separatorBefore: true,
      disabled: !canEdit || (!multiple && document.processingStatus === 'processing'),
      onSelect: () => (multiple ? setBulkDeleting(true) : setDeletingId(document.id)),
    })
    return actions
  }

  const tagDefinitionsBySlot = new Map(
    tagDefinitions.map((definition) => [definition.tagSlot, definition])
  )
  const rows: ResourceRow[] = rowsData.map((document) => {
    const completed = document.processingStatus === 'completed'
    return {
      id: document.id,
      name: document.filename,
      icon: document.connectorType
        ? { providerId: connectorMark(document.connectorType) }
        : documentIcon(document),
      href: completed ? documentHref(workspaceId, knowledgeBaseId, document.id, search) : undefined,
      cells: {
        size: formatFileSize(document.fileSize, { includeBytes: true }),
        tokens: completed ? formatTokens(document.tokenCount) : undefined,
        chunks: completed ? document.chunkCount.toLocaleString() : undefined,
        uploaded: <UploadedDate instant={document.uploadedAt} />,
        status: <DocumentStatus document={document} />,
        tags: <DocumentTags document={document} definitions={tagDefinitionsBySlot} />,
      },
    }
  })

  const bulkActions: MenuAction[] = []
  if (
    !allSelected &&
    rowsData.length > 0 &&
    selected.length === rowsData.length &&
    total > rowsData.length
  )
    bulkActions.push({
      id: 'all',
      label: `Select all ${total.toLocaleString()}`,
      onSelect: () => setAllMode(true),
    })
  if (allSelected)
    bulkActions.push({
      id: 'clear',
      label: 'Clear selection',
      onSelect: resetSelection,
    })
  if (disabledCount > 0)
    bulkActions.push({ id: 'enable', label: 'Enable', onSelect: () => void runBulk('enable') })
  if (enabledCount > 0)
    bulkActions.push({ id: 'disable', label: 'Disable', onSelect: () => void runBulk('disable') })
  bulkActions.push({
    id: 'delete',
    label: 'Delete',
    destructive: true,
    onSelect: () => setBulkDeleting(true),
  })

  const name = knowledgeBase?.name
  const canDeleteBase = Boolean(
    knowledgeBase && canEdit && (!knowledgeBase.isSearchIndex || access.canAdmin)
  )
  /** The legacy palette's page commands, with its ids and labels and the page's own gates. */
  const pageCommands: PageCommand[] = []
  if (canEdit && knowledgeBase && !access.hidden) {
    pageCommands.push(
      {
        id: 'knowledge-base-new-documents',
        label: 'New documents',
        run: () => setUploading(true),
      },
      {
        id: 'knowledge-base-new-connector',
        label: 'New connector',
        run: () => void setAddConnector('', { history: 'replace', scroll: false }),
      },
      { id: 'knowledge-base-rename', label: 'Rename', run: () => setRenamingBase(true) },
      { id: 'knowledge-base-tags', label: 'Edit tags', run: () => setTagsOpen(true) }
    )
    if (canDeleteBase)
      pageCommands.push({
        id: 'knowledge-base-delete',
        label: 'Delete',
        run: () => setDeletingBase(true),
      })
  }
  usePageCommands(pageCommands)

  const baseActions: MenuAction[] = []
  if (canEdit || access.isLoading) {
    baseActions.push(
      {
        id: 'rename',
        label: 'Rename',
        disabled: !canEdit,
        onSelect: () => setRenamingBase(true),
      },
      { id: 'tags', label: 'Tags', disabled: !canEdit, onSelect: () => setTagsOpen(true) }
    )
  }
  if (!access.exportDisabled)
    baseActions.push({
      id: 'export',
      label: 'Export',
      onSelect: () => downloadKnowledgeBaseExport(knowledgeBaseId),
    })
  if (canDeleteBase)
    baseActions.push({
      id: 'delete',
      label: 'Delete',
      destructive: true,
      separatorBefore: true,
      onSelect: () => setDeletingBase(true),
    })

  const trail: BreadcrumbItem[] = [
    { id: 'root', label: 'Knowledge bases', href: knowledgeListHref(workspaceId, null, search) },
    ...folderChain(folders, knowledgeBase?.folderId).map((folder) => ({
      id: folder.id,
      label: folder.name,
      href: knowledgeListHref(workspaceId, folder.id, search),
    })),
    ...(name ? [{ id: knowledgeBaseId, label: name, actions: baseActions }] : []),
  ]

  const sortActions: MenuAction[] = SORTS.flatMap((group) =>
    (group.column === 'filename' ? (['asc', 'desc'] as const) : (['desc', 'asc'] as const)).map(
      (direction, index) => ({
        id: `${group.column}-${direction}`,
        label: group[direction],
        headingBefore: index === 0 ? group.heading : undefined,
        checked: sort.sort === group.column && sort.dir === direction,
        onSelect: () => {
          sort.onSort(group.column, direction)
          void setFilters({ page: null })
        },
      })
    )
  )

  const controls = (
    <ControlBar
      search={
        <SearchField
          label='Search documents'
          placeholder='Search documents'
          variant='quiet'
          value={q}
          onValueChange={setSearch}
        />
      }
      trail={
        <div className={styles.trail}>
          <Breadcrumbs label='Location' items={trail} />
        </div>
      }
    >
      <ChoiceMenu
        label='Status'
        options={STATUS_OPTIONS}
        value={enabled}
        onValueChange={(value) => {
          resetSelection()
          void setFilters({
            enabled: value === 'enabled' || value === 'disabled' ? value : null,
            page: null,
          })
        }}
      />
      {tagDefinitions.length > 0 && (
        <TagFilter
          definitions={tagDefinitions}
          entries={tagEntries}
          onChange={(entries) => {
            setTagEntries(entries)
            resetSelection()
            void setFilters({ page: null })
          }}
        />
      )}
      <ActionMenu label='Sort documents' icon='I050' tooltip actions={sortActions} />
      {!access.exportDisabled && (
        <Button
          variant='quiet'
          size='compact'
          icon='I049'
          onClick={() => downloadKnowledgeBaseExport(knowledgeBaseId)}
        >
          Export
        </Button>
      )}
      {(canEdit || access.isLoading) && (
        <Button
          variant='quiet'
          size='compact'
          icon='I074'
          disabled={!canEdit || !knowledgeBase}
          onClick={() => void setAddConnector('', { history: 'replace', scroll: false })}
        >
          New connector
        </Button>
      )}
      <Button
        variant='secondary'
        size='compact'
        icon='I117'
        disabled={!canEdit}
        onClick={() => setUploading(true)}
      >
        New documents
      </Button>
    </ControlBar>
  )

  const documentsRead = list.error ? (
    <FailureNotice
      message={list.error}
      retrying={list.isFetching}
      onRetry={() => void list.refreshDocuments()}
    />
  ) : list.isLoading ? null : rows.length === 0 ? (
    total === 0 && !query && !filtersActive ? (
      <WorkspaceEmpty
        title='No documents yet'
        description='Upload documents or connect a source to fill this knowledge base.'
      />
    ) : (
      <WorkspaceEmpty
        title='No matching documents'
        description='Try another search, status or tag filter.'
        action={{ label: 'Clear filters', onClick: clearFilters }}
      />
    )
  ) : null

  const documentsViewport = useRef<HTMLDivElement | null>(null)
  const documentsColumn = useScrollEdges<HTMLDivElement>('vertical', {
    viewport: documentsViewport,
  })
  const deletingDocument = rowsData.find((document) => document.id === deletingId)

  if (record.missing && !embedded) notFound()
  if (record.missing)
    return (
      <WorkspaceEmpty
        title='Knowledge base not found'
        description='This knowledge base may have been deleted or moved.'
      />
    )

  return (
    <>
      <LiveWorkspacePage
        workspaceId={workspaceId}
        current='knowledge'
        layout='fill'
        controls={controls}
        read={record.read}
      >
        <div className={styles.frame}>
          <div className={styles.split}>
            <div
              ref={documentsColumn}
              className={styles.documents}
              data-scroll-axis='vertical'
              role='region'
              aria-label='Documents'
            >
              {documentsRead ?? (
                <ResourceTable
                  label='Documents'
                  columns={COLUMNS}
                  rows={rows}
                  rowActions={rowActions}
                  backgroundActions={[
                    {
                      id: 'new-documents',
                      label: 'New documents',
                      disabled: !canEdit,
                      onSelect: () => setUploading(true),
                    },
                  ]}
                  selection={canEdit ? selection : undefined}
                  bulkActions={bulkActions}
                  bulkCount={allSelected ? total : undefined}
                  find={{ query: highlight, activeId: null }}
                />
              )}
              {!list.error && pageCount > 1 && (
                <div className={styles.paging}>
                  <Pagination
                    label='Document pages'
                    page={Math.min(page, pageCount)}
                    pageCount={pageCount}
                    onPageChange={(next) => {
                      resetSelection()
                      documentsViewport.current?.scrollTo({ top: 0 })
                      void setFilters({ page: next })
                    }}
                  />
                </div>
              )}
            </div>
            {knowledgeBase && connectorsQuery.status !== 'pending' && (
              <ConnectorsRail
                workspaceId={workspaceId}
                knowledgeBaseId={knowledgeBaseId}
                isSearchIndex={Boolean(knowledgeBase.isSearchIndex)}
                connectors={connectors}
                error={connectorsQuery.error}
                onRetry={() => void connectorsQuery.refetch()}
                canEdit={canEdit}
                onOpen={setOpenConnectorId}
              />
            )}
          </div>
        </div>
      </LiveWorkspacePage>

      <BaseTagsModal open={tagsOpen} onOpenChange={setTagsOpen} knowledgeBaseId={knowledgeBaseId} />
      {renamingBase && knowledgeBase && (
        <RenameModal
          title='Rename knowledge base'
          label='Name'
          initialName={knowledgeBase.name}
          maxLength={100}
          onClose={() => setRenamingBase(false)}
          onSave={(next) =>
            updateBase.mutateAsync({ knowledgeBaseId, updates: { name: next } }).then(() => {})
          }
        />
      )}
      {renaming && (
        <RenameModal
          title='Rename document'
          label='Name'
          initialName={renaming.filename}
          maxLength={255}
          onClose={() => setRenaming(null)}
          onSave={async (next) => {
            const previous = renaming.filename
            list.updateDocument(renaming.id, { filename: next })
            try {
              await updateDocument.mutateAsync({
                knowledgeBaseId,
                documentId: renaming.id,
                updates: { filename: next },
              })
            } catch (error) {
              list.updateDocument(renaming.id, { filename: previous })
              throw error
            }
          }}
        />
      )}
      {taggingId && (
        <DocumentTagsModal
          open
          onOpenChange={(open) => {
            if (!open) setTaggingId(null)
          }}
          knowledgeBaseId={knowledgeBaseId}
          documentId={taggingId}
          document={rowsData.find((document) => document.id === taggingId) ?? null}
          onDocumentUpdate={(updates) => list.updateDocument(taggingId, updates)}
        />
      )}
      <ConfirmDialog
        target={deletingBase && knowledgeBase}
        onClose={() => setDeletingBase(false)}
        title='Delete knowledge base'
        description={(target) =>
          `Delete ${target.name}? It and its ${documents(total)} are removed. You can restore it from Recently Deleted in Settings.`
        }
        confirmLabel='Delete knowledge base'
        pendingLabel='Deleting…'
        onConfirm={async () => {
          await deleteBase.mutateAsync({ knowledgeBaseId })
          if (!embedded)
            router.push(knowledgeListHref(workspaceId, knowledgeBase?.folderId ?? null, search))
        }}
      />
      <ConfirmDialog
        target={deletingDocument}
        onClose={() => setDeletingId(null)}
        title='Delete document'
        description={(target) =>
          target.connectorId
            ? `Delete ${target.filename}? It is synced from a connector, so deleting it excludes it from future syncs. To hide it from search for now, disable it instead.`
            : `Delete ${target.filename}? The document is deleted permanently. This can't be undone.`
        }
        confirmLabel='Delete document'
        pendingLabel='Deleting…'
        onConfirm={async (target) => {
          await deleteDocument.mutateAsync({ knowledgeBaseId, documentId: target.id })
          selection.toggle(target.id, false, false)
        }}
      />
      <ConfirmDialog
        target={bulkDeleting && selectedCount > 0 ? selectedCount : null}
        onClose={() => setBulkDeleting(false)}
        title={(count) => (count === 1 ? 'Delete document' : 'Delete documents')}
        description={(count) =>
          `Delete ${documents(count)}? The selected ${count === 1 ? 'document is' : 'documents are'} deleted permanently. This can't be undone.`
        }
        confirmLabel={`Delete ${documents(selectedCount)}`}
        pendingLabel='Deleting…'
        onConfirm={() => runBulk('delete')}
      />
      <AddDocumentsModal
        open={uploading}
        onOpenChange={setUploading}
        workspaceId={workspaceId}
        knowledgeBaseId={knowledgeBaseId}
      />
      {addConnector !== null && knowledgeBase && (
        <AddConnectorModal
          workspaceId={workspaceId}
          knowledgeBaseId={knowledgeBaseId}
          isSearchIndex={Boolean(knowledgeBase.isSearchIndex)}
          initialConnectorType={addConnector || undefined}
          onConnectorTypeChange={(type) =>
            void setAddConnector(type, { history: 'replace', scroll: false })
          }
          onClose={() => void setAddConnector(null, { history: 'replace', scroll: false })}
        />
      )}
      {openConnectorId && knowledgeBase && (
        <ConnectorModal
          workspaceId={workspaceId}
          knowledgeBaseId={knowledgeBaseId}
          isSearchIndex={Boolean(knowledgeBase.isSearchIndex)}
          connectorId={openConnectorId}
          canEdit={canEdit}
          onClose={() => setOpenConnectorId(null)}
        />
      )}
    </>
  )
}
