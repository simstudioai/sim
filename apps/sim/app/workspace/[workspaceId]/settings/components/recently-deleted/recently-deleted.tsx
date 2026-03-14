'use client'

import { useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import {
  Button,
  Check,
  SModalTabs,
  SModalTabsList,
  SModalTabsTrigger,
  toast,
} from '@/components/emcn'
import { Input } from '@/components/ui'
import { formatDate } from '@/lib/core/utils/formatting'
import type { MothershipResourceType } from '@/app/workspace/[workspaceId]/home/types'
import { RESOURCE_REGISTRY } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import { useKnowledgeBasesQuery, useRestoreKnowledgeBase } from '@/hooks/queries/kb/knowledge'
import { useRestoreTable, useTablesList } from '@/hooks/queries/tables'
import { useRestoreWorkspaceFile, useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useRestoreWorkflow, useWorkflows } from '@/hooks/queries/workflows'

function getResourceHref(workspaceId: string, type: Exclude<ResourceType, 'all'>, id: string): string {
  const base = `/workspace/${workspaceId}`
  switch (type) {
    case 'workflow':
      return `${base}/w/${id}`
    case 'table':
      return `${base}/tables/${id}`
    case 'knowledge':
      return `${base}/knowledge/${id}`
    case 'file':
      return `${base}/files`
  }
}

type ResourceType = 'all' | 'workflow' | 'table' | 'knowledge' | 'file'

const ICON_CLASS = 'h-[14px] w-[14px]'

const RESOURCE_TYPE_TO_MOTHERSHIP: Record<Exclude<ResourceType, 'all'>, MothershipResourceType> = {
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

const TABS: { id: ResourceType; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'workflow', label: 'Workflows' },
  { id: 'table', label: 'Tables' },
  { id: 'knowledge', label: 'Knowledge Bases' },
  { id: 'file', label: 'Files' },
]

const TYPE_LABEL: Record<Exclude<ResourceType, 'all'>, string> = {
  workflow: 'Workflow',
  table: 'Table',
  knowledge: 'Knowledge Base',
  file: 'File',
}

function ResourceIcon({ resource }: { resource: DeletedResource }) {
  if (resource.type === 'workflow') {
    const color = resource.color ?? '#888'
    return (
      <div
        className='h-[14px] w-[14px] shrink-0 rounded-[3px] border-[2px]'
        style={{
          backgroundColor: color,
          borderColor: `${color}60`,
          backgroundClip: 'padding-box',
        }}
      />
    )
  }

  const mothershipType = RESOURCE_TYPE_TO_MOTHERSHIP[resource.type]
  const config = RESOURCE_REGISTRY[mothershipType]
  return (
    <>
      {config.renderTabIcon(
        { type: mothershipType, id: resource.id, title: resource.name },
        ICON_CLASS
      )}
    </>
  )
}

export function RecentlyDeleted() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params?.workspaceId as string
  const [activeTab, setActiveTab] = useState<ResourceType>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set())

  const workflowsQuery = useWorkflows(workspaceId, { syncRegistry: false, scope: 'archived' })
  const tablesQuery = useTablesList(workspaceId, 'archived')
  const knowledgeQuery = useKnowledgeBasesQuery(workspaceId, { scope: 'archived' })
  const filesQuery = useWorkspaceFiles(workspaceId, 'archived')

  const restoreWorkflow = useRestoreWorkflow()
  const restoreTable = useRestoreTable()
  const restoreKnowledgeBase = useRestoreKnowledgeBase()
  const restoreWorkspaceFile = useRestoreWorkspaceFile()

  const isLoading =
    workflowsQuery.isLoading ||
    tablesQuery.isLoading ||
    knowledgeQuery.isLoading ||
    filesQuery.isLoading

  const resources = useMemo<DeletedResource[]>(() => {
    const items: DeletedResource[] = []

    for (const wf of workflowsQuery.data ?? []) {
      items.push({
        id: wf.id,
        name: wf.name,
        type: 'workflow',
        deletedAt: new Date(wf.lastModified),
        workspaceId: wf.workspaceId ?? workspaceId,
        color: wf.color,
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
        deletedAt: new Date(kb.updatedAt),
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

    items.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime())
    return items
  }, [workflowsQuery.data, tablesQuery.data, knowledgeQuery.data, filesQuery.data, workspaceId])

  const filtered = useMemo(() => {
    let items = activeTab === 'all' ? resources : resources.filter((r) => r.type === activeTab)
    if (searchTerm.trim()) {
      const normalized = searchTerm.toLowerCase()
      items = items.filter((r) => r.name.toLowerCase().includes(normalized))
    }
    return items
  }, [resources, activeTab, searchTerm])

  const showNoResults = searchTerm.trim() && filtered.length === 0 && resources.length > 0

  function handleRestore(resource: DeletedResource) {
    setRestoringIds((prev) => new Set(prev).add(resource.id))

    const onSettled = () => {
      setRestoringIds((prev) => {
        const next = new Set(prev)
        next.delete(resource.id)
        return next
      })
    }

    const onSuccess = () => {
      const href = getResourceHref(resource.workspaceId, resource.type, resource.id)
      toast.success(`${resource.name} restored`, {
        icon: <Check className='h-[12px] w-[12px]' />,
        action: { label: 'View', onClick: () => router.push(href) },
      })
    }

    switch (resource.type) {
      case 'workflow':
        restoreWorkflow.mutate(resource.id, { onSettled, onSuccess })
        break
      case 'table':
        restoreTable.mutate(resource.id, { onSettled, onSuccess })
        break
      case 'knowledge':
        restoreKnowledgeBase.mutate(resource.id, { onSettled, onSuccess })
        break
      case 'file':
        restoreWorkspaceFile.mutate(
          { workspaceId: resource.workspaceId, fileId: resource.id },
          { onSettled, onSuccess }
        )
        break
    }
  }

  return (
    <div className='flex flex-col gap-[16px]'>
      <p className='text-[13px] text-[var(--text-secondary)]'>
        Items you delete are kept here for 30 days before being permanently removed.
      </p>

      <div className='flex items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px] transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover:border-[var(--border-1)] dark:hover:bg-[var(--surface-5)]'>
        <Search
          className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
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

      <SModalTabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as ResourceType)}
      >
        <SModalTabsList activeValue={activeTab} className='border-b border-[var(--border)]'>
          {TABS.map((tab) => (
            <SModalTabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </SModalTabsTrigger>
          ))}
        </SModalTabsList>
      </SModalTabs>

      {isLoading ? (
        <div className='flex items-center justify-center py-[48px]'>
          <Loader2 className='h-5 w-5 animate-spin text-[var(--text-tertiary)]' />
        </div>
      ) : filtered.length === 0 ? (
        <div className='flex flex-col items-center justify-center py-[48px] text-[var(--text-tertiary)]'>
          <p className='text-[13px]'>
            {showNoResults
              ? `No items found matching \u201c${searchTerm}\u201d`
              : 'No deleted items'}
          </p>
        </div>
      ) : (
        <div className='flex flex-col'>
          {filtered.map((resource) => {
            const isRestoring = restoringIds.has(resource.id)

            return (
              <div
                key={resource.id}
                className='flex items-center gap-[12px] rounded-[6px] px-[8px] py-[8px] hover:bg-[var(--bg-hover)]'
              >
                <ResourceIcon resource={resource} />

                <div className='flex flex-col min-w-0 flex-1'>
                  <span className='text-[13px] font-medium text-[var(--text-primary)] truncate'>
                    {resource.name}
                  </span>
                  <span className='text-[12px] text-[var(--text-tertiary)]'>
                    {TYPE_LABEL[resource.type]}
                    {' \u00b7 '}
                    Deleted {formatDate(resource.deletedAt)}
                  </span>
                </div>

                <Button
                  variant='default'
                  size='sm'
                  disabled={isRestoring}
                  onClick={() => handleRestore(resource)}
                  className='shrink-0'
                >
                  {isRestoring ? (
                    <Loader2 className='h-3.5 w-3.5 animate-spin' />
                  ) : (
                    'Restore'
                  )}
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
