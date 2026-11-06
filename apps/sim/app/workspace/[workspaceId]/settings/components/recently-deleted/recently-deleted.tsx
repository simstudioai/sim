'use client'

import { useMemo, useState } from 'react'
import { Chip, ChipInput, ChipModalTabs, cn } from '@sim/emcn'
import { Search } from '@sim/emcn/icons'
import { formatDate } from '@sim/utils/formatting'
import { useParams, useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { canMutateWorkspaceSettingsSection } from '@/components/settings/navigation'
import type { ServedFolderResourceType } from '@/lib/api/contracts/folders'
import {
  RECENTLY_DELETED_TYPES_BY_FILTER,
  type RecentlyDeletedFilter,
} from '@/lib/api/contracts/recently-deleted'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { folderedResourceListHref } from '@/app/workspace/[workspaceId]/components/folders'
import {
  type ColumnOption,
  SortDropdown,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-options'
import { RESOURCE_REGISTRY } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { MothershipResourceType } from '@/app/workspace/[workspaceId]/home/types'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  recentlyDeletedParsers,
  recentlyDeletedSortParams,
  recentlyDeletedUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/components/recently-deleted/search-params'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { useFolders, useRestoreFolder } from '@/hooks/queries/folders'
import { useRestoreKnowledgeBase } from '@/hooks/queries/kb/knowledge'
import { useRestoreMothershipChat } from '@/hooks/queries/mothership-chats'
import { useRecentlyDeletedItems } from '@/hooks/queries/recently-deleted'
import { useRestoreTable } from '@/hooks/queries/tables'
import { useRestoreWorkflow } from '@/hooks/queries/workflows'
import { useRestoreWorkspaceFileFolder } from '@/hooks/queries/workspace-file-folders'
import { useRestoreWorkspaceFile } from '@/hooks/queries/workspace-files'
import { useLoadMoreSentinel } from '@/hooks/use-load-more-sentinel'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import { useUrlSort } from '@/hooks/use-url-sort'
import { useFolderStore } from '@/stores/folders/store'
import type { WorkflowFolder } from '@/stores/folders/types'

type ResourceType =
  | 'all'
  | 'workflow'
  | 'table'
  | 'knowledge'
  | 'file'
  | 'folder'
  | 'workspace_folder'
  | 'knowledge_folder'
  | 'table_folder'
  | 'chat'

function getResourceHref(
  workspaceId: string,
  type: Exclude<ResourceType, 'all'>,
  id: string
): string {
  const base = `/workspace/${workspaceId}`
  switch (type) {
    case 'workflow':
      return `${base}/w/${id}`
    case 'table':
      return `${base}/tables/${id}`
    case 'knowledge':
      return `${base}/knowledge/${id}`
    case 'file':
      return `${base}/files/${id}`
    case 'folder':
      return `${base}/w`
    case 'workspace_folder':
      return folderedResourceListHref('file', workspaceId, id)
    case 'knowledge_folder':
      return folderedResourceListHref('knowledge_base', workspaceId, id)
    case 'table_folder':
      return folderedResourceListHref('table', workspaceId, id)
    case 'chat':
      return `${base}/chat/${id}`
  }
}

const SORT_OPTIONS: ColumnOption[] = [
  { id: 'deleted', label: 'Deleted' },
  { id: 'name', label: 'Name' },
  { id: 'type', label: 'Type' },
]

const ICON_CLASS = 'size-5 shrink-0'

const RESOURCE_TYPE_TO_MOTHERSHIP: Record<Exclude<ResourceType, 'all'>, MothershipResourceType> = {
  workflow: 'workflow',
  folder: 'folder',
  workspace_folder: 'filefolder',
  knowledge_folder: 'folder',
  table_folder: 'folder',
  table: 'table',
  knowledge: 'knowledgebase',
  file: 'file',
  chat: 'task',
}

interface DeletedResource {
  id: string
  name: string
  type: Exclude<ResourceType, 'all'>
  deletedAt: Date
  /** The parent folder, for a folder row. */
  parentId: string | null
}

interface RestoredResourceEntry {
  resource: DeletedResource
  displayIndex: number
}

/** Labels for {@link RECENTLY_DELETED_FILTERS}, which owns the order. */
const TABS: { id: ResourceType; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'chat', label: 'Chats' },
  { id: 'table', label: 'Tables' },
  { id: 'file', label: 'Files' },
  { id: 'knowledge', label: 'Knowledge Bases' },
  { id: 'workflow', label: 'Workflows' },
  { id: 'folder', label: 'Folders' },
]

const TYPE_LABEL: Record<Exclude<ResourceType, 'all'>, string> = {
  workflow: 'Workflow',
  folder: 'Folder',
  workspace_folder: 'File Folder',
  knowledge_folder: 'Knowledge Folder',
  table_folder: 'Table Folder',
  table: 'Table',
  knowledge: 'Knowledge Base',
  file: 'File',
  chat: 'Chat',
}

function ResourceIcon({ resource }: { resource: DeletedResource }) {
  const mothershipType = RESOURCE_TYPE_TO_MOTHERSHIP[resource.type]
  const config = RESOURCE_REGISTRY[mothershipType]
  return config.renderTabIcon(
    { type: mothershipType, id: resource.id, title: resource.name },
    ICON_CLASS
  )
}

/**
 * Folder trees served by the generic folders API, other than the workflow tree: the
 * `resourceType` each deleted-folder type is restored under.
 */
const FOLDERED_RESOURCE_TREES = [
  { type: 'knowledge_folder', resourceType: 'knowledge_base' },
  { type: 'table_folder', resourceType: 'table' },
] as const satisfies readonly {
  type: Exclude<ResourceType, 'all'>
  resourceType: ServedFolderResourceType
}[]

/**
 * Restore brings a workflow back but deliberately does NOT re-enable its schedules, webhooks,
 * or chats. Archive overwrites their enabled state without recording what it was, so restoring
 * to a constant would re-enable something the user had deliberately switched off — and a
 * deliberately-disabled schedule or webhook is a common state, not an edge case, so that would
 * be wrong more often than right.
 *
 * Leaving it off is the safe choice; leaving it UNSAID is not. Restoring anything that carries
 * automations says so at the moment of restore, so re-enabling is a known step rather than a
 * silent surprise.
 */
const PAUSED_AUTOMATION_TYPES = new Set<ResourceType>(['workflow', 'folder'])

function matchesActiveTab(resource: DeletedResource, activeTab: RecentlyDeletedFilter): boolean {
  return RECENTLY_DELETED_TYPES_BY_FILTER[activeTab].includes(resource.type)
}

export function RecentlyDeleted() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params?.workspaceId as string
  const workspacePermissions = useUserPermissionsContext()
  const canEdit = canMutateWorkspaceSettingsSection('recently-deleted', workspacePermissions)
  const [{ tab: activeTab }, setRecentlyDeletedFilters] = useQueryStates(
    recentlyDeletedParsers,
    recentlyDeletedUrlKeys
  )

  const {
    sort: sortColumn,
    dir: sortDirection,
    activeSort,
    onSort,
    onClear,
  } = useUrlSort(recentlyDeletedSortParams, recentlyDeletedUrlKeys)

  /**
   * The input is controlled directly by the instant nuqs value; only the URL
   * write is debounced. The list is searched on the server, so the query reads
   * a debounced copy rather than refetching on every keystroke.
   */
  const [urlSearchTerm, setSearchTerm] = useSettingsSearch()
  const debouncedSearch = useSearchFilterValue(urlSearchTerm, SEARCH_DEBOUNCE_MS).trim()

  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set())
  const [restoredItems, setRestoredItems] = useState<Map<string, RestoredResourceEntry>>(new Map())

  const deletedQuery = useRecentlyDeletedItems({
    workspaceId,
    filter: activeTab,
    search: debouncedSearch,
    sortBy: sortColumn,
    sortOrder: sortDirection,
  })
  const activeFoldersQuery = useFolders(workspaceId, {
    enabled: activeTab === 'all' || activeTab === 'folder',
  })

  const restoreWorkflow = useRestoreWorkflow()
  const restoreFolder = useRestoreFolder()
  const restoreTable = useRestoreTable()
  const restoreKnowledgeBase = useRestoreKnowledgeBase()
  const restoreWorkspaceFile = useRestoreWorkspaceFile()
  const restoreWorkspaceFileFolder = useRestoreWorkspaceFileFolder()
  const restoreChat = useRestoreMothershipChat(workspaceId)

  const {
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    isLoading,
    isPlaceholderData,
    error,
  } = deletedQuery

  const loadMoreRef = useLoadMoreSentinel({
    onLoadMore: fetchNextPage,
    enabled: hasNextPage && !isFetchingNextPage && !isFetchNextPageError && !isPlaceholderData,
  })

  const filtered = useMemo(() => {
    const items: DeletedResource[] = (deletedQuery.data?.pages ?? []).flatMap((page) =>
      page.items.map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        deletedAt: new Date(item.deletedAt),
        parentId: item.parentId,
      }))
    )

    const normalized = debouncedSearch.toLowerCase()
    const itemIds = new Set(items.map((item) => item.id))
    for (const [id, entry] of restoredItems) {
      if (itemIds.has(id)) continue
      if (!matchesActiveTab(entry.resource, activeTab)) continue
      if (normalized && !entry.resource.name.toLowerCase().includes(normalized)) {
        continue
      }
      items.splice(Math.min(entry.displayIndex, items.length), 0, entry.resource)
    }

    return items
  }, [deletedQuery.data, debouncedSearch, activeTab, restoredItems])

  const showNoResults = debouncedSearch !== '' && filtered.length === 0

  function handleView(resource: DeletedResource) {
    if (resource.type === 'folder') {
      const setExpanded = useFolderStore.getState().setExpanded
      const byId = new Map<string, WorkflowFolder>()
      for (const folder of activeFoldersQuery.data ?? []) byId.set(folder.id, folder)
      setExpanded(resource.id, true)
      const seen = new Set<string>([resource.id])
      let current = resource.parentId ? byId.get(resource.parentId) : undefined
      while (current && !seen.has(current.id)) {
        seen.add(current.id)
        setExpanded(current.id, true)
        current = current.parentId ? byId.get(current.parentId) : undefined
      }
    }
    const href = getResourceHref(workspaceId, resource.type, resource.id)
    router.push(href)
  }

  async function handleRestore(resource: DeletedResource) {
    const displayIndex = Math.max(
      0,
      filtered.findIndex((item) => item.id === resource.id)
    )
    setRestoringIds((prev) => new Set(prev).add(resource.id))

    try {
      switch (resource.type) {
        case 'workflow':
          await restoreWorkflow.mutateAsync({
            workflowId: resource.id,
            workspaceId,
          })
          break
        case 'folder':
          await restoreFolder.mutateAsync({
            folderId: resource.id,
            workspaceId,
          })
          break
        case 'table':
          await restoreTable.mutateAsync(resource.id)
          break
        case 'knowledge':
          await restoreKnowledgeBase.mutateAsync(resource.id)
          break
        case 'file':
          await restoreWorkspaceFile.mutateAsync({
            workspaceId,
            fileId: resource.id,
          })
          break
        case 'workspace_folder':
          await restoreWorkspaceFileFolder.mutateAsync({
            workspaceId,
            folderId: resource.id,
          })
          break
        case 'knowledge_folder':
        case 'table_folder': {
          const tree = FOLDERED_RESOURCE_TREES.find((entry) => entry.type === resource.type)
          if (!tree) break
          await restoreFolder.mutateAsync({
            folderId: resource.id,
            workspaceId,
            resourceType: tree.resourceType,
          })
          break
        }
        case 'chat':
          await restoreChat.mutateAsync(resource.id)
          break
      }

      setRestoredItems((prev) => new Map(prev).set(resource.id, { resource, displayIndex }))
    } catch {
      return
    } finally {
      setRestoringIds((prev) => {
        const next = new Set(prev)
        next.delete(resource.id)
        return next
      })
    }
  }

  return (
    <SettingsPanel>
      <div className='flex items-center gap-2'>
        <ChipInput
          icon={Search}
          placeholder='Search deleted items...'
          value={urlSearchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className='min-w-0 flex-1'
        />
        <SortDropdown
          config={{
            options: SORT_OPTIONS,
            active: activeSort,
            onSort,
            onClear,
          }}
        />
      </div>

      <ChipModalTabs
        tabs={TABS.map((tab) => ({ value: tab.id, label: tab.label }))}
        value={activeTab}
        onChange={(v) => setRecentlyDeletedFilters({ tab: v as RecentlyDeletedFilter })}
      />

      {error && !deletedQuery.data ? (
        <SettingsQueryErrorState
          error={error}
          fallback='Failed to load deleted items'
          isRetrying={deletedQuery.isFetching}
          onRetry={() => void deletedQuery.refetch()}
        />
      ) : isLoading && filtered.length === 0 ? null : filtered.length === 0 ? (
        showNoResults ? (
          <SettingsEmptyState variant='inline'>
            {`No items found matching \u201c${debouncedSearch}\u201d`}
          </SettingsEmptyState>
        ) : (
          <SettingsEmptyState>No deleted items</SettingsEmptyState>
        )
      ) : (
        <div
          className={cn(RESOURCE_LIST_STACK, isPlaceholderData && 'opacity-50 transition-opacity')}
        >
          {filtered.map((resource) => {
            const isRestoring = restoringIds.has(resource.id)
            const isRestored = restoredItems.has(resource.id)
            // Chats are per-user (the archived list and restore are scoped to the
            // viewer's own rows), so chat restore skips the workspace edit gate —
            // mirroring that any member can delete their own chats.
            const canRestore = resource.type === 'chat' || canEdit

            return (
              <SettingsResourceRow
                key={resource.id}
                icon={<ResourceIcon resource={resource} />}
                title={resource.name}
                description={
                  <>
                    {TYPE_LABEL[resource.type]}
                    {' \u00b7 '}
                    Deleted {formatDate(resource.deletedAt)}
                  </>
                }
                badge={
                  canRestore && isRestored ? (
                    <span className='text-[var(--text-muted)] text-caption'>
                      {PAUSED_AUTOMATION_TYPES.has(resource.type)
                        ? 'Restored \u00b7 schedules and webhooks stay paused'
                        : 'Restored'}
                    </span>
                  ) : undefined
                }
                trailing={
                  !canRestore ? null : isRestoring ? (
                    <Chip variant='primary' disabled>
                      Restoring...
                    </Chip>
                  ) : isRestored ? (
                    <Chip variant='primary' onClick={() => handleView(resource)}>
                      View
                    </Chip>
                  ) : (
                    <Chip
                      variant='primary'
                      disabled={isPlaceholderData}
                      onClick={() => void handleRestore(resource)}
                    >
                      Restore
                    </Chip>
                  )
                }
              />
            )
          })}
          {isFetchNextPageError ? (
            <SettingsQueryErrorState
              error={error}
              fallback='Failed to load more deleted items'
              isRetrying={isFetchingNextPage}
              onRetry={() => void fetchNextPage()}
              variant='inline'
            />
          ) : (
            <div ref={loadMoreRef} aria-hidden />
          )}
        </div>
      )}
    </SettingsPanel>
  )
}
