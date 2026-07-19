'use client'

import { useMemo, useState } from 'react'
import { Chip, ChipInput, ChipModalTabs } from '@sim/emcn'
import { Search } from '@sim/emcn/icons'
import { toError } from '@sim/utils/errors'
import { formatDate } from '@sim/utils/formatting'
import { useParams, useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { canMutateWorkspaceSettingsSection } from '@/components/settings/navigation'
import { type ColumnOption, SortDropdown } from '@/app/workspace/[workspaceId]/components'
import { RESOURCE_REGISTRY } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { MothershipResourceType } from '@/app/workspace/[workspaceId]/home/types'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  type RecentlyDeletedTab,
  recentlyDeletedParsers,
  recentlyDeletedSortParams,
  recentlyDeletedUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/components/recently-deleted/search-params'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useFolders, useRestoreFolder } from '@/hooks/queries/folders'
import { useInterfacesList, useRestoreInterface } from '@/hooks/queries/interfaces'
import { useKnowledgeBasesQuery, useRestoreKnowledgeBase } from '@/hooks/queries/kb/knowledge'
import { useRestoreTable, useTablesList } from '@/hooks/queries/tables'
import { useRestoreWorkflow, useWorkflows } from '@/hooks/queries/workflows'
import {
  useRestoreWorkspaceFileFolder,
  useWorkspaceFileFolders,
} from '@/hooks/queries/workspace-file-folders'
import { useRestoreWorkspaceFile, useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useUrlSort } from '@/hooks/use-url-sort'
import { useFolderStore } from '@/stores/folders/store'
import type { WorkflowFolder } from '@/stores/folders/types'

type ResourceType =
  | 'all'
  | 'workflow'
  | 'interface'
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
    case 'interface':
      return `${base}/interfaces/${id}`
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
  interface: 'interface',
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
}

interface RestoredResourceEntry {
  resource: DeletedResource
  displayIndex: number
}

const TABS: { id: ResourceType; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'workflow', label: 'Workflows' },
  { id: 'folder', label: 'Folders' },
  { id: 'interface', label: 'Interfaces' },
  { id: 'table', label: 'Tables' },
  { id: 'knowledge', label: 'Knowledge Bases' },
  { id: 'file', label: 'Files' },
]

const TYPE_LABEL: Record<Exclude<ResourceType, 'all'>, string> = {
  workflow: 'Workflow',
  folder: 'Folder',
  workspace_folder: 'File Folder',
  interface: 'Interface',
  table: 'Table',
  knowledge: 'Knowledge Base',
  file: 'File',
}

function ResourceIcon({ resource }: { resource: DeletedResource }) {
  const mothershipType = RESOURCE_TYPE_TO_MOTHERSHIP[resource.type]
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
  const params = useParams()
  const router = useRouter()
  const workspaceId = params?.workspaceId as string
  const workspacePermissions = useUserPermissionsContext()
  const canEdit = canMutateWorkspaceSettingsSection('recently-deleted', workspacePermissions)
  const [{ tab: activeTab, search: urlSearchTerm }, setRecentlyDeletedFilters] = useQueryStates(
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
   * write is debounced. Filtering below is cheap in-memory over a small list, so
   * it reads the instant value too.
   */
  const setSearchTerm = useDebouncedSearchSetter((value, options) =>
    setRecentlyDeletedFilters({ search: value }, options)
  )

  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set())
  const [restoredItems, setRestoredItems] = useState<Map<string, RestoredResourceEntry>>(new Map())

  const workflowsQuery = useWorkflows(workspaceId, { scope: 'archived' })
  const foldersQuery = useFolders(workspaceId, { scope: 'archived' })
  const activeFoldersQuery = useFolders(workspaceId)
  const interfacesQuery = useInterfacesList(workspaceId, 'archived')
  const tablesQuery = useTablesList(workspaceId, 'archived')
  const knowledgeQuery = useKnowledgeBasesQuery(workspaceId, { scope: 'archived' })
  const filesQuery = useWorkspaceFiles(workspaceId, 'archived')
  const workspaceFoldersQuery = useWorkspaceFileFolders(workspaceId, 'archived')

  const restoreWorkflow = useRestoreWorkflow()
  const restoreFolder = useRestoreFolder()
  const restoreInterface = useRestoreInterface(workspaceId)
  const restoreTable = useRestoreTable()
  const restoreKnowledgeBase = useRestoreKnowledgeBase()
  const restoreWorkspaceFile = useRestoreWorkspaceFile()
  const restoreWorkspaceFileFolder = useRestoreWorkspaceFileFolder()

  const isLoading =
    workflowsQuery.isLoading ||
    foldersQuery.isLoading ||
    interfacesQuery.isLoading ||
    tablesQuery.isLoading ||
    knowledgeQuery.isLoading ||
    filesQuery.isLoading ||
    workspaceFoldersQuery.isLoading

  const error =
    workflowsQuery.error ||
    foldersQuery.error ||
    interfacesQuery.error ||
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
      })
    }

    for (const definition of interfacesQuery.data ?? []) {
      items.push({
        id: definition.id,
        name: definition.name,
        type: 'interface',
        deletedAt: new Date(definition.archivedAt ?? definition.updatedAt),
        workspaceId: definition.workspaceId,
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
    interfacesQuery.data,
    tablesQuery.data,
    knowledgeQuery.data,
    filesQuery.data,
    workspaceFoldersQuery.data,
    workspaceId,
  ])

  const filtered = useMemo(() => {
    let items = resources.filter((resource) => matchesActiveTab(resource, activeTab))
    const normalized = urlSearchTerm.trim().toLowerCase()
    if (normalized) {
      items = items.filter((r) => r.name.toLowerCase().includes(normalized))
    }
    items.sort((a, b) => {
      let cmp = 0
      switch (sortColumn) {
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
      return sortDirection === 'asc' ? cmp : -cmp
    })

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
  }, [resources, activeTab, urlSearchTerm, sortColumn, sortDirection, restoredItems])

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
        case 'interface':
          await restoreInterface.mutateAsync(resource.id)
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
          placeholder='Search deleted items...'
          value={urlSearchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          disabled={isLoading}
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
        onChange={(v) => setRecentlyDeletedFilters({ tab: v as RecentlyDeletedTab })}
      />

      {error ? (
        <div className='flex h-full flex-col items-center justify-center gap-2'>
          <p className='text-[var(--text-error)] text-sm leading-tight'>
            {toError(error).message || 'Failed to load deleted items'}
          </p>
        </div>
      ) : isLoading ? null : filtered.length === 0 ? (
        showNoResults ? (
          <SettingsEmptyState variant='inline'>
            {`No items found matching \u201c${urlSearchTerm}\u201d`}
          </SettingsEmptyState>
        ) : (
          <SettingsEmptyState>No deleted items</SettingsEmptyState>
        )
      ) : (
        <div className='flex flex-col gap-2'>
          {filtered.map((resource) => {
            const isRestoring = restoringIds.has(resource.id)
            const isRestored = restoredItems.has(resource.id)

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
                trailing={
                  !canEdit ? null : isRestoring ? (
                    <Chip variant='primary' disabled className='shrink-0'>
                      Restoring...
                    </Chip>
                  ) : isRestored ? (
                    <div className='flex shrink-0 items-center gap-2'>
                      <span className='text-[var(--text-muted)] text-small'>Restored</span>
                      <Chip variant='primary' onClick={() => handleView(resource)}>
                        View
                      </Chip>
                    </div>
                  ) : (
                    <Chip
                      variant='primary'
                      onClick={() => void handleRestore(resource)}
                      className='shrink-0'
                    >
                      Restore
                    </Chip>
                  )
                }
              />
            )
          })}
        </div>
      )}
    </SettingsPanel>
  )
}
