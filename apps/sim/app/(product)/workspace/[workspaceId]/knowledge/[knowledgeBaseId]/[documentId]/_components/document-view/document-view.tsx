'use client'

import { type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { type BreadcrumbItem, Breadcrumbs } from '@sim/emcn/breadcrumbs'
import { Button, IconButton } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { Pagination } from '@sim/emcn/pagination'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { SearchField } from '@sim/emcn/search-field'
import { FailureNotice, StatusText } from '@sim/emcn/status'
import { notFound, useRouter, useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { toast } from '@/lib/toast/sink'
import { ControlBar } from '@/app/(product)/_components/control-bar/control-bar'
import { DocumentTagsModal } from '@/app/(product)/_components/workspace/knowledge/document-tags-modal/document-tags-modal'
import {
  documentHref,
  formatTokenCount,
  knowledgeBaseHref,
  knowledgeListHref,
} from '@/app/(product)/_components/workspace/knowledge/knowledge-base/model'
import { RenameModal } from '@/app/(product)/_components/workspace/knowledge/rename-modal/rename-modal'
import {
  type ResourceColumn,
  type ResourceRow,
  ResourceTable,
} from '@/app/(product)/_components/workspace/resource-table/resource-table'
import { useResourceSelection } from '@/app/(product)/_components/workspace/resource-table/use-resource-selection'
import {
  LiveWorkspacePage,
  WorkspaceEmpty,
} from '@/app/(product)/_components/workspace/workspace-page/workspace-page'
import {
  ChunkEditor,
  type ChunkSaveStatus,
} from '@/app/(product)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/[documentId]/_components/chunk-editor/chunk-editor'
import styles from '@/app/(product)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/[documentId]/_components/document-view/document-view.module.css'
import {
  type ChunkData,
  chunkListParsers,
  chunkSortParams,
  getDocumentIndexingStatus,
  knowledgeUrlOptions,
  useBeforeUnloadWhile,
  useBulkChunkOperation,
  useDebounce,
  useDebouncedSearchSetter,
  useDeleteChunk,
  useDeleteDocument,
  useDocument,
  useDocumentChunkSearchQuery,
  useDocumentChunks,
  useDocumentRecord,
  useFolderMap,
  useKnowledgeAccess,
  useKnowledgeBase,
  useUpdateChunk,
  useUpdateDocument,
  useUrlSort,
} from '@/platform/lib/data/knowledge'
import { folderChain } from '@/platform/lib/folder-chain'
import { LOCALE } from '@/platform/shared/time'

/** Chunk search feels snappier than the shared window, as it does on the legacy page. */
const SEARCH_DEBOUNCE_MS = 200
const PAGE_SIZE = 50
const NO_IDS: readonly string[] = []
const PREVIEW_LENGTH = 150
const CONTEXT_BEFORE = 30
/** How long a failed create says so before its button reads Create chunk again. */
const CREATE_FAILURE_DWELL_MS = 2000
/** After a page change, how often the list is checked for the chunk to open, and how many times. */
const ARRIVAL_POLL_MS = 100
const ARRIVAL_POLL_TRIES = 50
const NEXT_TASK = 0

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
] as const

const SORTS = [
  { column: 'index', heading: 'Index', asc: 'First to last', desc: 'Last to first' },
  { column: 'tokens', heading: 'Tokens', desc: 'Most first', asc: 'Fewest first' },
  { column: 'status', heading: 'Status', desc: 'Enabled first', asc: 'Disabled first' },
] as const

const SORT_FIELD = { index: 'chunkIndex', tokens: 'tokenCount', status: 'enabled' } as const

/** The list's lanes after the content: index, tokens on the trailing edge, and whether it is searchable. */
const CHUNK_COLUMNS: readonly ResourceColumn[] = [
  { id: 'index', label: 'Index', width: 'tight' },
  { id: 'tokens', label: 'Tokens', numeric: true, width: 'compact' },
  { id: 'status', label: 'Status', width: 'compact', narrow: true },
]

/**
 * The chunk's first 150 characters, or 150 around the first search term it contains, so a match
 * deep in a long chunk is still in view.
 */
function preview(content: string, query: string) {
  if (content.length <= PREVIEW_LENGTH) return content
  for (const term of query.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = content.toLowerCase().indexOf(term)
    if (at === -1) continue
    const start = Math.max(0, at - CONTEXT_BEFORE)
    const end = Math.min(content.length, start + PREVIEW_LENGTH)
    return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`
  }
  return `${content.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…`
}

function chunks(count: number) {
  return `${count.toLocaleString(LOCALE)} chunk${count === 1 ? '' : 's'}`
}

interface DocumentViewProps {
  workspaceId: string
  knowledgeBaseId: string
  documentId: string
}

/**
 * A document's chunks: searched, filtered, sorted and paged, each opening in place for editing.
 * The editor saves as it goes, moves to the previous or next chunk across pages, and asks before
 * an unsaved edit is left behind.
 */
export function DocumentView({ workspaceId, knowledgeBaseId, documentId }: DocumentViewProps) {
  const router = useRouter()
  const search = useSearchParams()
  const access = useKnowledgeAccess(workspaceId)
  const [{ page, chunk: openChunkId, search: searchText, enabled }, setParams] = useQueryStates(
    chunkListParsers,
    knowledgeUrlOptions
  )
  const sort = useUrlSort(chunkSortParams, knowledgeUrlOptions)
  const setSearch = useDebouncedSearchSetter(
    (value, options) => setParams({ search: value, page: null }, options),
    { debounceMs: SEARCH_DEBOUNCE_MS }
  )
  const query = useDebounce(searchText, SEARCH_DEBOUNCE_MS).trim()

  const base = useKnowledgeBase(knowledgeBaseId)
  const knowledgeBase = base.knowledgeBase
  const document = useDocument(knowledgeBaseId, documentId).document
  const record = useDocumentRecord(knowledgeBaseId, documentId)
  const folders = useFolderMap(workspaceId, 'knowledge_base').data
  const list = useDocumentChunks(
    knowledgeBaseId,
    documentId,
    page,
    '',
    enabled,
    sort.sort ? SORT_FIELD[sort.sort] : undefined,
    sort.dir ?? undefined
  )
  const searchQuery = useDocumentChunkSearchQuery(
    { knowledgeBaseId, documentId, search: query },
    { enabled: Boolean(query) }
  )
  const results = searchQuery.data ?? []
  const showingSearch = Boolean(query) && searchText.trim().length > 0 && results.length > 0
  const searchPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE))
  const searchPage = showingSearch ? Math.max(1, Math.min(page, searchPages)) : 1
  const rows = showingSearch
    ? results.slice((searchPage - 1) * PAGE_SIZE, searchPage * PAGE_SIZE)
    : list.chunks
  const currentPage = showingSearch ? searchPage : list.currentPage
  const totalPages = showingSearch ? searchPages : list.totalPages
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const totalPagesRef = useRef(totalPages)
  totalPagesRef.current = totalPages

  const updateChunk = useUpdateChunk()
  const bulk = useBulkChunkOperation()
  const deleteChunk = useDeleteChunk()
  const deleteDocument = useDeleteDocument()
  const updateDocument = useUpdateDocument()

  const [creating, setCreating] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<ChunkSaveStatus>('idle')
  const [createStatus, setCreateStatus] = useState<ChunkSaveStatus>('idle')
  /** Held as an object: a bare function in state would be called as an updater. */
  const [pendingAction, setPendingAction] = useState<{ run: () => void } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [tagging, setTagging] = useState(false)
  const [deletingDocument, setDeletingDocument] = useState(false)
  const [deletingChunk, setDeletingChunk] = useState<ChunkData | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const saveRef = useRef<(() => Promise<void>) | null>(null)

  const canEdit = access.canEdit
  const connectorDocument = Boolean(document?.connectorId)
  const editable = canEdit && !connectorDocument
  const completed = document?.processingStatus === 'completed'
  const status = document ? getDocumentIndexingStatus(document) : undefined
  const nothingToIndex =
    completed && document.mimeType.startsWith('image/') && document.chunkCount === 0
  const chunkError = completed
    ? list.error || (searchQuery.error ? searchQuery.error.message : null)
    : null
  const editing = openChunkId !== null || creating
  const selection = useResourceSelection({
    rowIds: completed ? rows.map((item) => item.id) : NO_IDS,
    onDelete: editable ? () => setBulkDeleting(true) : undefined,
    keyboardBlocked: !completed || !editable || editing,
  })
  const selected = selection.selected
  const openIndex = openChunkId ? rows.findIndex((item) => item.id === openChunkId) : -1
  const openChunk = openIndex >= 0 ? rows[openIndex] : null
  const canPrevious = openIndex > 0 || currentPage > 1
  const canNext = (openIndex >= 0 && openIndex < rows.length - 1) || currentPage < totalPages

  useBeforeUnloadWhile(dirty)

  const setOpenChunk = useCallback(
    (chunkId: string | null) =>
      void setParams({ chunk: chunkId }, chunkId === null ? undefined : { history: 'push' }),
    [setParams]
  )
  const goToPage = useCallback((next: number) => setParams({ page: next }), [setParams])

  function closeEditor() {
    setOpenChunk(null)
    setCreating(false)
    setDirty(false)
    setSaveStatus('idle')
    setCreateStatus('idle')
  }

  /** Runs an action now, or after the reader agrees to leave an unsaved edit. */
  function guard(action: () => void) {
    if (dirty) setPendingAction({ run: action })
    else action()
  }

  async function save() {
    const run = saveRef.current
    if (!run || !dirty) return
    if (creating) {
      if (createStatus === 'saving') return
      setCreateStatus('saving')
      try {
        await run()
        setCreateStatus('saved')
      } catch {
        setCreateStatus('error')
        window.setTimeout(() => setCreateStatus('idle'), CREATE_FAILURE_DWELL_MS)
      }
      return
    }
    if (saveStatus !== 'saving') await run()
  }

  const saveLatest = useRef(save)
  saveLatest.current = save
  useEffect(() => {
    if (!editing) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        void saveLatest.current().catch(() => {})
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  /** After a page change the list loads anew; the chunk to open is picked once it arrives. */
  function selectOnArrival(
    pick: (rows: readonly ChunkData[]) => ChunkData | undefined,
    before: readonly ChunkData[]
  ) {
    let tries = 0
    const check = () => {
      const current = rowsRef.current
      if (current.length > 0 && current !== before) {
        const target = pick(current)
        if (target) setOpenChunk(target.id)
      } else if (tries < ARRIVAL_POLL_TRIES) {
        tries++
        window.setTimeout(check, ARRIVAL_POLL_MS)
      }
    }
    window.setTimeout(check, NEXT_TASK)
  }

  async function navigate(direction: 'previous' | 'next') {
    if (!openChunk) return
    if (direction === 'previous') {
      const previous = rows[openIndex - 1]
      if (previous) setOpenChunk(previous.id)
      else if (currentPage > 1) {
        await goToPage(currentPage - 1)
        selectOnArrival((current) => current[current.length - 1], rows)
      }
      return
    }
    const next = rows[openIndex + 1]
    if (next) setOpenChunk(next.id)
    else if (currentPage < totalPages) {
      await goToPage(currentPage + 1)
      selectOnArrival((current) => current[0], rows)
    }
  }

  /** A new chunk is appended, so its page is the last one, which it may have just created. */
  async function created(chunkId: string) {
    setCreating(false)
    setDirty(false)
    setCreateStatus('idle')
    const lastPage = totalPages
    await goToPage(lastPage)
    let tries = 0
    let movedOn = false
    const check = () => {
      if (rowsRef.current.some((item) => item.id === chunkId)) setOpenChunk(chunkId)
      else if (!movedOn && totalPagesRef.current > lastPage) {
        movedOn = true
        tries = 0
        void goToPage(totalPagesRef.current)
        window.setTimeout(check, ARRIVAL_POLL_MS)
      } else if (tries < ARRIVAL_POLL_TRIES) {
        tries++
        window.setTimeout(check, ARRIVAL_POLL_MS)
      }
    }
    window.setTimeout(check, NEXT_TASK)
  }

  function toggleEnabled(target: ChunkData) {
    const next = !target.enabled
    if (!showingSearch) list.updateChunk(target.id, { enabled: next })
    updateChunk.mutate(
      { knowledgeBaseId, documentId, chunkId: target.id, enabled: next },
      {
        onError: () => {
          if (!showingSearch) list.updateChunk(target.id, { enabled: target.enabled })
        },
      }
    )
  }

  const selectedChunks = rows.filter((item) => selected.has(item.id))
  const enabledCount = selectedChunks.filter((item) => item.enabled).length
  const disabledCount = selectedChunks.length - enabledCount

  function runBulk(operation: 'enable' | 'disable' | 'delete', targets: readonly ChunkData[]) {
    if (targets.length === 0) return undefined
    return bulk.mutateAsync(
      { knowledgeBaseId, documentId, operation, chunkIds: targets.map((item) => item.id) },
      {
        onSuccess: (result) => {
          if (operation !== 'delete' && result.errorCount === 0 && !showingSearch)
            for (const item of targets)
              list.updateChunk(item.id, { enabled: operation === 'enable' })
          selection.clear()
        },
      }
    )
  }

  function rowActions(target: ChunkData): readonly MenuAction[] {
    const multiple = selected.size > 1 && selected.has(target.id)
    const actions: MenuAction[] = []
    if (!multiple) {
      actions.push(
        {
          id: 'open',
          label: 'Open in new tab',
          onSelect: () =>
            window.open(
              documentHref(workspaceId, knowledgeBaseId, documentId, search, target.id),
              '_blank',
              'noopener'
            ),
        },
        {
          id: 'edit',
          label: connectorDocument ? 'View' : 'Edit',
          disabled: !canEdit && !connectorDocument,
          onSelect: () => setOpenChunk(target.id),
        },
        {
          id: 'copy',
          label: 'Copy content',
          onSelect: () => {
            void navigator.clipboard
              .writeText(target.content)
              .then(() => toast.success('Copied chunk content'))
              .catch(() => toast.error('Could not copy the chunk content'))
          },
        }
      )
    }
    actions.push({
      id: 'toggle',
      label: multiple
        ? disabledCount > 0
          ? `Enable ${disabledCount.toLocaleString(LOCALE)} items`
          : `Disable ${enabledCount.toLocaleString(LOCALE)} items`
        : target.enabled
          ? 'Disable'
          : 'Enable',
      disabled: !editable,
      onSelect: () => {
        if (!multiple) toggleEnabled(target)
        else if (disabledCount > 0)
          void runBulk(
            'enable',
            selectedChunks.filter((item) => !item.enabled)
          )
        else
          void runBulk(
            'disable',
            selectedChunks.filter((item) => item.enabled)
          )
      },
    })
    actions.push({
      id: 'delete',
      label: multiple ? `Delete ${selected.size.toLocaleString(LOCALE)} items` : 'Delete',
      destructive: true,
      separatorBefore: true,
      disabled: !editable,
      onSelect: () => (multiple ? setBulkDeleting(true) : setDeletingChunk(target)),
    })
    return actions
  }

  const newChunkDisabled = document?.processingStatus === 'failed' || !canEdit || connectorDocument
  function startNewChunk() {
    guard(() => {
      setCreating(true)
      setOpenChunk(null)
      setDirty(false)
      setCreateStatus('idle')
    })
  }

  const name = document?.filename
  const trail: BreadcrumbItem[] = [
    { id: 'root', label: 'Knowledge bases', href: knowledgeListHref(workspaceId, null, search) },
    ...folderChain(folders, knowledgeBase?.folderId).map((folder) => ({
      id: folder.id,
      label: folder.name,
      href: knowledgeListHref(workspaceId, folder.id, search),
    })),
    ...(knowledgeBase
      ? [
          {
            id: knowledgeBaseId,
            label: knowledgeBase.name,
            href: knowledgeBaseHref(workspaceId, knowledgeBaseId, search),
          },
        ]
      : []),
    ...(name
      ? [
          editing
            ? {
                id: documentId,
                label: name,
                href: documentHref(workspaceId, knowledgeBaseId, documentId, search),
              }
            : {
                id: documentId,
                label: name,
                actions: canEdit
                  ? [
                      { id: 'rename', label: 'Rename', onSelect: () => setRenaming(true) },
                      { id: 'tags', label: 'Tags', onSelect: () => setTagging(true) },
                      {
                        id: 'delete',
                        label: 'Delete',
                        destructive: true,
                        separatorBefore: true,
                        onSelect: () => setDeletingDocument(true),
                      },
                    ]
                  : undefined,
              },
        ]
      : []),
    ...(editing && name
      ? [
          {
            id: 'chunk',
            label: creating ? 'New chunk' : openChunk ? `Chunk #${openChunk.chunkIndex}` : '…',
          },
        ]
      : []),
  ]

  const editorSaveLabel = (() => {
    const current = creating ? createStatus : saveStatus
    if (current === 'saving') return creating ? 'Creating…' : 'Saving…'
    if (current === 'saved') return creating ? 'Created' : 'Saved'
    if (current === 'error') return creating ? 'Create failed' : 'Save failed'
    return creating ? 'Create chunk' : 'Save'
  })()

  const sortActions: MenuAction[] = [
    {
      id: 'default',
      label: 'Document order',
      checked: sort.activeSort === null,
      onSelect: () => {
        sort.onClear()
        void goToPage(1)
      },
    },
    ...SORTS.flatMap((group) =>
      (group.column === 'index' ? (['asc', 'desc'] as const) : (['desc', 'asc'] as const)).map(
        (direction, index): MenuAction => ({
          id: `${group.column}-${direction}`,
          label: group[direction],
          headingBefore: index === 0 ? group.heading : undefined,
          checked: sort.sort === group.column && sort.dir === direction,
          onSelect: () => {
            sort.onSort(group.column, direction)
            void goToPage(1)
          },
        })
      )
    ),
  ]

  /**
   * A crumb that leaves the route takes an unsaved chunk with it, so it asks first. The guard
   * catches clicks on the trail's links before Next navigates.
   */
  const trailGuard = (event: MouseEvent) => {
    if (!editing || !dirty) return
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!link) return
    event.preventDefault()
    const href = link.getAttribute('href') ?? ''
    guard(() => {
      if (href === documentHref(workspaceId, knowledgeBaseId, documentId, search)) closeEditor()
      else router.push(href)
    })
  }

  const controls = (
    <ControlBar
      search={
        completed && !editing ? (
          <SearchField
            label='Search chunks'
            placeholder='Search chunks'
            variant='quiet'
            value={searchText}
            onValueChange={setSearch}
          />
        ) : undefined
      }
      trail={
        <div className={styles.trail} onClickCapture={trailGuard}>
          <Breadcrumbs label='Location' items={trail} />
        </div>
      }
    >
      {editing ? (
        <>
          {!creating && (
            <>
              <IconButton
                label='Previous chunk'
                icon='I023'
                tooltip
                disabled={!canPrevious}
                onClick={() => guard(() => void navigate('previous'))}
              />
              <IconButton
                label='Next chunk'
                icon='I102'
                tooltip
                disabled={!canNext}
                onClick={() => guard(() => void navigate('next'))}
              />
            </>
          )}
          {(creating || editable) && (
            <Button
              variant='secondary'
              size='compact'
              disabled={!dirty || (creating ? createStatus : saveStatus) === 'saving'}
              onClick={() => void save().catch(() => {})}
            >
              {editorSaveLabel}
            </Button>
          )}
        </>
      ) : (
        <>
          <ChoiceMenu
            label='Status'
            options={STATUS_OPTIONS}
            value={enabled}
            onValueChange={(value) => {
              selection.clear()
              void setParams({
                enabled: value === 'enabled' || value === 'disabled' ? value : null,
                page: null,
              })
            }}
          />
          <ActionMenu label='Sort chunks' icon='I050' tooltip actions={sortActions} />
          <Button
            variant='secondary'
            size='compact'
            icon='I074'
            disabled={newChunkDisabled}
            onClick={startNewChunk}
          >
            New chunk
          </Button>
        </>
      )}
    </ControlBar>
  )

  const listViewport = useRef<HTMLDivElement | null>(null)
  const listColumn = useScrollEdges<HTMLDivElement>('vertical', { viewport: listViewport })
  const processing: { title: string; description?: string } | undefined =
    !document || completed
      ? undefined
      : status === 'pending'
        ? { title: 'Document processing pending…' }
        : status === 'processing'
          ? { title: 'Document processing in progress…' }
          : status === 'failed'
            ? { title: 'Document processing failed' }
            : status === 'skipped'
              ? { title: 'Document skipped', description: document.processingError ?? undefined }
              : { title: 'Document not ready' }
  const chunkById = new Map(rows.map((item) => [item.id, item]))
  const chunkRows: ResourceRow[] = completed
    ? rows.map((item) => ({
        id: item.id,
        name: preview(item.content, searchText),
        label: `Chunk ${item.chunkIndex}`,
        onOpen: () => setOpenChunk(item.id),
        cells: {
          index: String(item.chunkIndex),
          tokens: formatTokenCount(item.tokenCount),
          status: item.enabled ? (
            <StatusText label='Enabled' intent='success' />
          ) : (
            <StatusText label='Disabled' />
          ),
        },
      }))
    : []

  let content: ReactNode
  if (!document) content = null
  else if (creating)
    content = (
      <ChunkEditor
        key='new-chunk'
        mode='create'
        document={document}
        knowledgeBaseId={knowledgeBaseId}
        canEdit
        maxChunkSize={knowledgeBase?.chunkingConfig?.maxSize}
        onDirtyChange={setDirty}
        onSaveStatusChange={() => {}}
        saveRef={saveRef}
        onCreated={(chunkId) => void created(chunkId)}
      />
    )
  else if (openChunkId)
    content = openChunk ? (
      <ChunkEditor
        key={openChunk.id}
        mode='edit'
        chunk={openChunk}
        document={document}
        knowledgeBaseId={knowledgeBaseId}
        canEdit={editable}
        maxChunkSize={knowledgeBase?.chunkingConfig?.maxSize}
        onDirtyChange={setDirty}
        onSaveStatusChange={setSaveStatus}
        saveRef={saveRef}
      />
    ) : null
  else
    content = (
      <div ref={listColumn} className={styles.list} role='region' aria-label='Chunks'>
        {chunkError ? (
          <FailureNotice
            title={list.error ? 'Couldn’t load chunks' : 'Search failed'}
            message={chunkError}
            retrying={list.error ? list.isFetching : searchQuery.isFetching}
            onRetry={() => void (list.error ? list.refetch() : searchQuery.refetch())}
          />
        ) : (
          <ResourceTable
            label='Chunks'
            nameLabel='Content'
            columns={CHUNK_COLUMNS}
            rows={chunkRows}
            marks={searchText.trim().split(/\s+/).filter(Boolean)}
            selection={completed && editable ? selection : undefined}
            rowActions={(row) => {
              const target = chunkById.get(row.id)
              return target ? rowActions(target) : []
            }}
            backgroundActions={[
              {
                id: 'new',
                label: 'New chunk',
                disabled: newChunkDisabled,
                onSelect: startNewChunk,
              },
            ]}
            bulkActions={[
              ...(disabledCount > 0
                ? [
                    {
                      id: 'enable',
                      label: 'Enable',
                      onSelect: () =>
                        void runBulk(
                          'enable',
                          selectedChunks.filter((item) => !item.enabled)
                        ),
                    },
                  ]
                : []),
              ...(enabledCount > 0
                ? [
                    {
                      id: 'disable',
                      label: 'Disable',
                      onSelect: () =>
                        void runBulk(
                          'disable',
                          selectedChunks.filter((item) => item.enabled)
                        ),
                    },
                  ]
                : []),
              {
                id: 'delete',
                label: 'Delete',
                destructive: true,
                onSelect: () => setBulkDeleting(true),
              },
            ]}
            empty={
              processing ? (
                <WorkspaceEmpty title={processing.title} description={processing.description} />
              ) : nothingToIndex ? (
                <EmptyState
                  title='Nothing to index'
                  description='This image holds no searchable information, such as a logo or an icon.'
                />
              ) : list.isLoading || (query && searchQuery.isLoading) ? null : (
                <WorkspaceEmpty
                  title={
                    searchText.trim() || enabled !== 'all' ? 'No matching chunks' : 'No chunks yet'
                  }
                  description={
                    searchText.trim() || enabled !== 'all'
                      ? 'Try another search or status.'
                      : undefined
                  }
                  action={
                    searchText.trim() || enabled !== 'all'
                      ? {
                          label: 'Clear filters',
                          onClick: () =>
                            void setParams({ search: null, enabled: null, page: null }),
                        }
                      : undefined
                  }
                />
              )
            }
          />
        )}
        {completed && !chunkError && totalPages > 1 && (
          <div className={styles.paging}>
            <Pagination
              label='Chunk pages'
              page={currentPage}
              pageCount={totalPages}
              onPageChange={(next) => {
                selection.clear()
                listViewport.current?.scrollTo({ top: 0 })
                void goToPage(next)
              }}
            />
          </div>
        )}
      </div>
    )

  if (record.missing) notFound()

  return (
    <>
      <LiveWorkspacePage
        workspaceId={workspaceId}
        current='knowledge'
        layout='fill'
        controls={controls}
        read={record.read}
      >
        {content}
      </LiveWorkspacePage>
      <ConfirmDialog
        target={pendingAction}
        onClose={() => setPendingAction(null)}
        title='Unsaved changes'
        description='You have unsaved changes. Discard them?'
        confirmLabel='Discard changes'
        pendingLabel='Discarding…'
        onConfirm={(action) => {
          setDirty(false)
          setPendingAction(null)
          action.run()
        }}
      />
      {renaming && document && (
        <RenameModal
          title='Rename document'
          label='Name'
          initialName={document.filename}
          maxLength={255}
          onClose={() => setRenaming(false)}
          onSave={(next) =>
            updateDocument
              .mutateAsync({ knowledgeBaseId, documentId, updates: { filename: next } })
              .then(() => {})
          }
        />
      )}
      {tagging && (
        <DocumentTagsModal
          open
          onOpenChange={(open) => {
            if (!open) setTagging(false)
          }}
          knowledgeBaseId={knowledgeBaseId}
          documentId={documentId}
          document={document}
        />
      )}
      <ConfirmDialog
        target={deletingDocument && document}
        onClose={() => setDeletingDocument(false)}
        title='Delete document'
        description={(target) =>
          `Delete ${target.filename}? The document and its ${chunks(target.chunkCount)} are deleted permanently. ${
            target.connectorId
              ? 'It is synced from a connector, so deleting it excludes it from future syncs. To hide it from search for now, disable it instead.'
              : "This can't be undone."
          }`
        }
        confirmLabel='Delete document'
        pendingLabel='Deleting…'
        onConfirm={async () => {
          await deleteDocument.mutateAsync({ knowledgeBaseId, documentId })
          router.push(knowledgeBaseHref(workspaceId, knowledgeBaseId, search))
        }}
      />
      <ConfirmDialog
        target={deletingChunk}
        onClose={() => setDeletingChunk(null)}
        title='Delete chunk'
        description="Delete this chunk? This can't be undone."
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        onConfirm={async (target) => {
          await deleteChunk.mutateAsync({ knowledgeBaseId, documentId, chunkId: target.id })
          if (selection.selected.has(target.id)) selection.toggle(target.id, false, false)
        }}
      />
      <ConfirmDialog
        target={bulkDeleting && selectedChunks.length > 0 ? selectedChunks.length : null}
        onClose={() => setBulkDeleting(false)}
        title={(count) => (count === 1 ? 'Delete chunk' : 'Delete chunks')}
        description={(count) => `Delete ${chunks(count)}? This can't be undone.`}
        confirmLabel={`Delete ${chunks(selectedChunks.length)}`}
        pendingLabel='Deleting…'
        onConfirm={() => runBulk('delete', selectedChunks)}
      />
    </>
  )
}
