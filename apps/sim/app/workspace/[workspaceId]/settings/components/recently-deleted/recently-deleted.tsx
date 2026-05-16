'use client'

import { useMemo, useState } from 'react'
import { toError } from '@sim/utils/errors'
import { formatDate } from '@sim/utils/formatting'
import { Search } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import {
  Button,
  Combobox,
  Input,
  SModalTabs,
  SModalTabsList,
  SModalTabsTrigger,
} from '@/components/emcn'
import { Folder } from '@/components/emcn/icons'
import { workflowBorderColor } from '@/lib/workspaces/colors'
import { RESOURCE_REGISTRY } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { MothershipResourceType } from '@/app/workspace/[workspaceId]/home/types'
import { DeletedItemSkeleton } from '@/app/workspace/[workspaceId]/settings/components/recently-deleted/deleted-item-skeleton'
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

const SORT_OPTIONS: { column: SortColumn; direction: 'asc' | 'desc'; label: string }[] = [
  { column: 'deleted', direction: 'desc', label: 'Deleted (newest first)' },
  { column: 'name', direction: 'asc', label: 'Name (A–Z)' },
  { column: 'type', direction: 'asc', label: 'Type (A–Z)' },
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
    const color = resource.color ?? '#888'
    return (
      <div
        className='size-[14px] shrink-0 rounded-[3px] border-[2px]'
        style={{
          backgroundColor: color,
          borderColor: workflowBorderColor(color),
          backgroundClip: 'padding-box',
        }}
      />
    )
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
  const params = useParams()
  const router = useRouter()
  const workspaceId = params?.workspaceId as string
  const [activeTab, setActiveTab] = useState<ResourceType>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [activeSort, setActiveSort] = useState<SortConfig | null>(null)
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
        color: wf.color,
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
    if (searchTerm.trim()) {
      const normalized = searchTerm.toLowerCase()
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
        searchTerm.trim() &&
        !entry.resource.name.toLowerCase().includes(searchTerm.toLowerCase())
      ) {
        continue
      }
      items.splice(Math.min(entry.displayIndex, items.length), 0, entry.resource)
    }

    return items
  }, [resources, activeTab, searchTerm, activeSort, restoredItems])

  const showNoResults = searchTerm.trim() && filtered.length === 0 && resources.length > 0
  const selectedSort = activeSort ?? DEFAULT_SORT

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
    <div className='flex h-full flex-col gap-4.5'>
      <div className='flex items-center gap-2'>
        <div className='flex flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-transparent px-2 py-[5px] transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover-hover:border-[var(--border-1)] dark:hover-hover:bg-[var(--surface-5)]'>
          <Search
            className='size-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
            strokeWidth={2}
          />
          <Input
            placeholder='Search deleted items...'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            disabled={isLoading}
            className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>
        <div className='w-[190px] shrink-0'>
          <Combobox
            size='sm'
            align='end'
            disabled={isLoading}
            value={`${selectedSort.column}:${selectedSort.direction}`}
            onChange={(value) => {
              const option = SORT_OPTIONS.find(
                (sortOption) => `${sortOption.column}:${sortOption.direction}` === value
              )
              if (option) {
                setActiveSort({ column: option.column, direction: option.direction })
              }
            }}
            options={SORT_OPTIONS.map((option) => ({
              label: option.label,
              value: `${option.column}:${option.direction}`,
            }))}
            className='h-[30px] rounded-lg border-[var(--border)] bg-transparent px-2.5 text-small dark:bg-[var(--surface-4)]'
          />
        </div>
      </div>

      <SModalTabs value={activeTab} onValueChange={(v) => setActiveTab(v as ResourceType)}>
        <SModalTabsList activeValue={activeTab} className='border-[var(--border)] border-b'>
          {TABS.map((tab) => (
            <SModalTabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </SModalTabsTrigger>
          ))}
        </SModalTabsList>
      </SModalTabs>

      <div className='min-h-0 flex-1 overflow-y-auto'>
        {error ? (
          <div className='flex h-full flex-col items-center justify-center gap-2'>
            <p className='text-[var(--text-error)] text-xs leading-tight'>
              {toError(error).message || 'Failed to load deleted items'}
            </p>
          </div>
        ) : isLoading ? (
          <div className='flex flex-col gap-2'>
            <DeletedItemSkeleton />
            <DeletedItemSkeleton />
            <DeletedItemSkeleton />
          </div>
        ) : filtered.length === 0 ? (
          <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
            {showNoResults
              ? `No items found matching \u201c${searchTerm}\u201d`
              : 'No deleted items'}
          </div>
        ) : (
          <div className='flex flex-col gap-2'>
            {filtered.map((resource) => {
              const isRestoring = restoringIds.has(resource.id)
              const isRestored = restoredItems.has(resource.id)

              return (
                <div
                  key={resource.id}
                  className='flex items-center gap-3 rounded-md px-2 py-2 hover-hover:bg-[var(--bg-hover)]'
                >
                  <ResourceIcon resource={resource} />

                  <div className='flex min-w-0 flex-1 flex-col'>
                    <span className='truncate font-medium text-[var(--text-primary)] text-small'>
                      {resource.name}
                    </span>
                    <span className='text-[var(--text-tertiary)] text-caption'>
                      {TYPE_LABEL[resource.type]}
                      {' \u00b7 '}
                      Deleted {formatDate(resource.deletedAt)}
                    </span>
                  </div>

                  {isRestoring ? (
                    <Button variant='primary' size='sm' disabled className='shrink-0'>
                      Restoring...
                    </Button>
                  ) : isRestored ? (
                    <div className='flex shrink-0 items-center gap-2'>
                      <span className='text-[var(--text-tertiary)] text-small'>Restored</span>
                      <Button variant='primary' size='sm' onClick={() => handleView(resource)}>
                        View
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant='primary'
                      size='sm'
                      onClick={() => void handleRestore(resource)}
                      className='shrink-0'
                    >
                      Restore
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
