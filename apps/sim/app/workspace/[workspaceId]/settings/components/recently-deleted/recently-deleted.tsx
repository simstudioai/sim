'use client'

import { useCallback, useMemo, useState } from 'react'
import { toError } from '@sim/utils/errors'
import { formatDate } from '@sim/utils/formatting'
import { useParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { debounce, useQueryStates } from 'nuqs'
import { Button, ChipInput, ChipModalTabs } from '@/components/emcn'
import { Folder, Search, Workflow } from '@/components/emcn/icons'
import { type ColumnOption, SortDropdown } from '@/app/workspace/[workspaceId]/components'
import { RESOURCE_REGISTRY } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { MothershipResourceType } from '@/app/workspace/[workspaceId]/home/types'
import {
  DEFAULT_RECENTLY_DELETED_SORT_COLUMN,
  DEFAULT_RECENTLY_DELETED_SORT_DIRECTION,
  RECENTLY_DELETED_SORT_COLUMNS,
  type RecentlyDeletedSortColumn,
  type RecentlyDeletedTab,
  recentlyDeletedParsers,
  recentlyDeletedUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/components/recently-deleted/search-params'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { useFolders, useRestoreFolder } from '@/hooks/queries/folders'
import { useKnowledgeBasesQuery, useRestoreKnowledgeBase } from '@/hooks/queries/kb/knowledge'
import { useRestoreTable, useTablesList } from '@/hooks/queries/tables'
import { useRestoreWorkflow, useWorkflows } from '@/hooks/queries/workflows'
import {
  useRestoreWorkspaceFileFolder,
  useWorkspaceFileFolders,
} from '@/hooks/queries/workspace-file-folders'
import { useRestoreWorkspaceFile, useWorkspaceFiles } from '@/hooks/queries/workspace-files'
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
      return `${base}/files?folderId=${id}`
  }
}

type SortColumn = 'deleted' | 'name' | 'type'

interface SortConfig {
  column: SortColumn
  direction: 'asc' | 'desc'
}

const DEFAULT_SORT: SortConfig = { column: 'deleted', direction: 'desc' }

/** Debounce window for `search` URL writes; the input itself stays instant. */
const SEARCH_DEBOUNCE_MS = 300 as const

const SORT_OPTIONS: ColumnOption[] = [
  { id: 'deleted', label: 'Deleted' },
  { id: 'name', label: 'Name' },
  { id: 'type', label: 'Type' },
]

const ICON_CLASS = 'size-[14px]'

const RESOURCE_TYPE_TO_MOTHERSHIP: Partial<
  Record<Exclude<ResourceType, 'all'>, MothershipResourceType>
> = {
  workflow: 'workflow',
  table: 'table',
  knowledge: 'knowledgebase',
  file: 'file',
}

interface DeletedResource {
  id: string
  name: string
  type: Exclude<ResourceType, 'all'>
  deletedAt: Date
  workspaceId: string
  color?: string
}

interface RestoredResourceEntry {
  resource: DeletedResource
  displayIndex: number
}

const TABS: { id: ResourceType; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'workflow', label: 'Workflows' },
  { id: 'folder', label: 'Folders' },
  { id: 'table', label: 'Tables' },
  { id: 'knowledge', label: 'Knowledge Bases' },
  { id: 'file', label: 'Files' },
]

const TYPE_LABEL: Record<Exclude<ResourceType, 'all'>, string> = {
  workflow: 'Workflow',
  folder: 'Folder',
  workspace_folder: 'File Folder',
  table: 'Table',
  knowledge: 'Knowledge Base',
  file: 'File',
}

function ResourceIcon({ resource }: { resource: DeletedResource }) {
  if (resource.type === 'workflow') {
    return <Workflow className={`${ICON_CLASS} shrink-0 text-[var(--text-icon)]`} />
  }

  if (resource.type === 'folder' || resource.type === 'workspace_folder') {
    const color = resource.color ?? '#6B7280'
    return <Folder className={ICON_CLASS} style={{ color }} />
  }

  const mothershipType = RESOURCE_TYPE_TO_MOTHERSHIP[resource.type]
  if (!mothershipType) return null
  const config = RESOURCE_REGISTRY[mothershipType]
  return config.renderTabIcon(
    { type: mothershipType, id: resource.id, title: resource.name },
    ICON_CLASS
  )
}

function matchesActiveTab(resource: DeletedResource, activeTab: ResourceType): boolean {
  if (activeTab === 'all') return true
  if (activeTab === 'file') return resource.type === 'file' || resource.type === 'workspace_folder'
  return resource.type === activeTab
}

export function RecentlyDeleted() {
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const params = useParams()
  const router = useRouter()
  const workspaceId = params?.workspaceId as string
  const [
    { tab: activeTab, sort: sortColumn, dir: sortDirection, search: urlSearchTerm },
    setRecentlyDeletedFilters,
  ] = useQueryStates(recentlyDeletedParsers, recentlyDeletedUrlKeys)

  /**
   * The input is controlled directly by the instant nuqs value; only the URL
   * write is debounced. Filtering below is cheap in-memory over a small list, so
   * it reads the instant value too.
   */
  const setSearchTerm = useCallback(
    (value: string) => {
      const trimmed = value.trim()
      const next = trimmed.length > 0 ? trimmed : null
      setRecentlyDeletedFilters(
        { search: next },
        next === null ? undefined : { limitUrlUpdates: debounce(SEARCH_DEBOUNCE_MS) }
      )
    },
    [setRecentlyDeletedFilters]
  )

  const activeSort = useMemo<SortConfig | null>(
    () =>
      sortColumn === DEFAULT_RECENTLY_DELETED_SORT_COLUMN &&
      sortDirection === DEFAULT_RECENTLY_DELETED_SORT_DIRECTION
        ? null
        : { column: sortColumn, direction: sortDirection },
    [sortColumn, sortDirection]
  )

  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set())
  const [restoredItems, setRestoredItems] = useState<Map<string, RestoredResourceEntry>>(new Map())

  const workflowsQuery = useWorkflows(workspaceId, { scope: 'archived' })
  const foldersQuery = useFolders(workspaceId, { scope: 'archived' })
  const activeFoldersQuery = useFolders(workspaceId)
  const tablesQuery = useTablesList(workspaceId, 'archived')
  const knowledgeQuery = useKnowledgeBasesQuery(workspaceId, { scope: 'archived' })
  const filesQuery = useWorkspaceFiles(workspaceId, 'archived')
  const workspaceFoldersQuery = useWorkspaceFileFolders(workspaceId, 'archived')

  const restoreWorkflow = useRestoreWorkflow()
  const restoreFolder = useRestoreFolder()
  const restoreTable = useRestoreTable()
  const restoreKnowledgeBase = useRestoreKnowledgeBase()
  const restoreWorkspaceFile = useRestoreWorkspaceFile()
  const restoreWorkspaceFileFolder = useRestoreWorkspaceFileFolder()

  const isLoading =
    workflowsQuery.isLoading ||
    foldersQuery.isLoading ||
    tablesQuery.isLoading ||
    knowledgeQuery.isLoading ||
    filesQuery.isLoading ||
    workspaceFoldersQuery.isLoading

  const error =
    workflowsQuery.error ||
    foldersQuery.error ||
    tablesQuery.error ||
    knowledgeQuery.error ||
    filesQuery.error ||
    workspaceFoldersQuery.error

  const resources = useMemo<DeletedResource[]>(() => {
    const items: DeletedResource[] = []

    for (const wf of workflowsQuery.data ?? []) {
      items.push({
        id: wf.id,
        name: wf.name,
        type: 'workflow',
        deletedAt: wf.archivedAt ? new Date(wf.archivedAt) : new Date(wf.lastModified),
        workspaceId: wf.workspaceId ?? workspaceId,
      })
    }

    for (const folder of foldersQuery.data ?? []) {
      items.push({
        id: folder.id,
        name: folder.name,
        type: 'folder',
        deletedAt: folder.archivedAt ? new Date(folder.archivedAt) : new Date(folder.updatedAt),
        workspaceId: folder.workspaceId,
        color: folder.color,
      })
    }

    for (const t of tablesQuery.data ?? []) {
      items.push({
        id: t.id,
        name: t.name,
        type: 'table',
        deletedAt: new Date(t.archivedAt ?? t.updatedAt),
        workspaceId: t.workspaceId,
      })
    }

    for (const kb of knowledgeQuery.data ?? []) {
      items.push({
        id: kb.id,
        name: kb.name,
        type: 'knowledge',
        deletedAt: kb.deletedAt ? new Date(kb.deletedAt) : new Date(kb.updatedAt),
        workspaceId: kb.workspaceId ?? workspaceId,
      })
    }

    for (const f of filesQuery.data ?? []) {
      items.push({
        id: f.id,
        name: f.name,
        type: 'file',
        deletedAt: new Date(f.deletedAt ?? f.uploadedAt),
        workspaceId: f.workspaceId,
      })
    }

    for (const wf of workspaceFoldersQuery.data ?? []) {
      items.push({
        id: wf.id,
        name: wf.name,
        type: 'workspace_folder',
        deletedAt: wf.deletedAt ? new Date(wf.deletedAt) : new Date(wf.updatedAt),
        workspaceId: wf.workspaceId,
      })
    }

    return items
  }, [
    workflowsQuery.data,
    foldersQuery.data,
    tablesQuery.data,
    knowledgeQuery.data,
    filesQuery.data,
    workspaceFoldersQuery.data,
    workspaceId,
  ])

  const filtered = useMemo(() => {
    let items = resources.filter((resource) => matchesActiveTab(resource, activeTab))
    if (urlSearchTerm.trim()) {
      const normalized = urlSearchTerm.toLowerCase()
      items = items.filter((r) => r.name.toLowerCase().includes(normalized))
    }
    const col = (activeSort ?? DEFAULT_SORT).column
    const dir = (activeSort ?? DEFAULT_SORT).direction
    items = [...items].sort((a, b) => {
      let cmp = 0
      switch (col) {
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'type':
          cmp = a.type.localeCompare(b.type)
          break
        case 'deleted':
          cmp = a.deletedAt.getTime() - b.deletedAt.getTime()
          break
      }
      return dir === 'asc' ? cmp : -cmp
    })

    const itemIds = new Set(items.map((item) => item.id))
    for (const [id, entry] of restoredItems) {
      if (itemIds.has(id)) continue
      if (!matchesActiveTab(entry.resource, activeTab)) continue
      if (
        urlSearchTerm.trim() &&
        !entry.resource.name.toLowerCase().includes(urlSearchTerm.toLowerCase())
      ) {
        continue
      }
      items.splice(Math.min(entry.displayIndex, items.length), 0, entry.resource)
    }

    return items
  }, [resources, activeTab, urlSearchTerm, activeSort, restoredItems])

  const showNoResults = urlSearchTerm.trim() && filtered.length === 0 && resources.length > 0

  function handleView(resource: DeletedResource) {
    if (resource.type === 'folder') {
      const setExpanded = useFolderStore.getState().setExpanded
      const byId = new Map<string, WorkflowFolder>()
      for (const folder of foldersQuery.data ?? []) byId.set(folder.id, folder)
      for (const folder of activeFoldersQuery.data ?? []) byId.set(folder.id, folder)
      let current: WorkflowFolder | undefined = byId.get(resource.id)
      const seen = new Set<string>()
      while (current && !seen.has(current.id)) {
        seen.add(current.id)
        setExpanded(current.id, true)
        current = current.parentId ? byId.get(current.parentId) : undefined
      }
    }
    const href = getResourceHref(resource.workspaceId, resource.type, resource.id)
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
            workspaceId: resource.workspaceId,
          })
          break
        case 'folder':
          await restoreFolder.mutateAsync({
            folderId: resource.id,
            workspaceId: resource.workspaceId,
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
            workspaceId: resource.workspaceId,
            fileId: resource.id,
          })
          break
        case 'workspace_folder':
          await restoreWorkspaceFileFolder.mutateAsync({
            workspaceId: resource.workspaceId,
            folderId: resource.id,
          })
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
          placeholder={t('search_deleted_items')}
          value={urlSearchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          disabled={isLoading}
          className='min-w-0 flex-1'
        />
        <SortDropdown
          config={{
            options: SORT_OPTIONS,
            active: activeSort,
            onSort: (column, direction) => {
              const sort = (RECENTLY_DELETED_SORT_COLUMNS as readonly string[]).includes(column)
                ? (column as RecentlyDeletedSortColumn)
                : DEFAULT_RECENTLY_DELETED_SORT_COLUMN
              setRecentlyDeletedFilters({ sort, dir: direction })
            },
            onClear: () =>
              setRecentlyDeletedFilters({
                sort: DEFAULT_RECENTLY_DELETED_SORT_COLUMN,
                dir: DEFAULT_RECENTLY_DELETED_SORT_DIRECTION,
              }),
          }}
        />
      </div>

      <ChipModalTabs
        tabs={TABS.map((tab) => ({ value: tab.id, label: tab.label }))}
        value={activeTab}
        onChange={(v) => setRecentlyDeletedFilters({ tab: v as RecentlyDeletedTab })}
      />

      {error ? (
        <div className='flex h-full flex-col items-center justify-center gap-2'>
          <p className='text-[var(--text-error)] text-sm leading-tight'>
            {toError(error).message || tI18n('failed_to_load_deleted_items')}
          </p>
        </div>
      ) : isLoading ? null : filtered.length === 0 ? (
        showNoResults ? (
          <SettingsEmptyState variant='inline'>
            {`No items found matching \u201c${urlSearchTerm}\u201d`}
          </SettingsEmptyState>
        ) : (
          <SettingsEmptyState>{t('no_deleted_items')}</SettingsEmptyState>
        )
      ) : (
        <div className='flex flex-col gap-2'>
          {filtered.map((resource) => {
            const isRestoring = restoringIds.has(resource.id)
            const isRestored = restoredItems.has(resource.id)

            return (
              <div
                key={resource.id}
                className='flex items-center gap-2.5 rounded-lg p-2 transition-colors hover-hover:bg-[var(--surface-active)]'
              >
                <ResourceIcon resource={resource} />

                <div className='flex min-w-0 flex-1 flex-col'>
                  <span className='truncate font-medium text-[var(--text-primary)] text-small'>
                    {resource.name}
                  </span>
                  <span className='text-[var(--text-muted)] text-small'>
                    {TYPE_LABEL[resource.type]}
                    {' \u00b7 '}
                    {t('deleted')} {formatDate(resource.deletedAt)}
                  </span>
                </div>

                {isRestoring ? (
                  <Button variant='primary' size='sm' disabled className='shrink-0'>
                    {t('restoring')}
                  </Button>
                ) : isRestored ? (
                  <div className='flex shrink-0 items-center gap-2'>
                    <span className='text-[var(--text-muted)] text-small'>{t('restored')}</span>
                    <Button variant='primary' size='sm' onClick={() => handleView(resource)}>
                      {t('view')}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant='primary'
                    size='sm'
                    onClick={() => void handleRestore(resource)}
                    className='shrink-0'
                  >
                    {t('restore')}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </SettingsPanel>
  )
}
