'use client'

import { type ElementType, type ReactNode, useMemo } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import {
  Blimp,
  Database,
  File as FileIcon,
  Folder as FolderIcon,
  Library,
  Table as TableIcon,
  TerminalWindow,
} from '@/components/emcn/icons'
import { WorkflowIcon } from '@/components/icons'
import { getDocumentIcon } from '@/components/icons/document-icons'
import { cn } from '@/lib/core/utils/cn'
import { workflowBorderColor } from '@/lib/workspaces/colors'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { knowledgeKeys } from '@/hooks/queries/kb/knowledge'
import { logKeys } from '@/hooks/queries/logs'
import { tableKeys } from '@/hooks/queries/tables'
import { taskKeys } from '@/hooks/queries/tasks'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { invalidateWorkflowLists } from '@/hooks/queries/utils/invalidate-workflow-lists'
import { useWorkflows } from '@/hooks/queries/workflows'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

interface DropdownItemRenderProps {
  item: { id: string; name: string; [key: string]: unknown }
}

export interface ResourceTypeConfig {
  type: MothershipResourceType
  label: string
  icon: ElementType
  renderTabIcon: (resource: MothershipResource, className: string) => ReactNode
  renderDropdownItem: (props: DropdownItemRenderProps) => ReactNode
}

function WorkflowTabSquare({ workflowId, className }: { workflowId: string; className?: string }) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: workflowList } = useWorkflows(workspaceId)
  const color = useMemo(() => {
    const wf = (workflowList ?? []).find((w) => w.id === workflowId)
    return wf?.color ?? '#888'
  }, [workflowList, workflowId])
  return (
    <div
      className={cn('flex-shrink-0 rounded-[3px] border-[2px]', className)}
      style={{
        backgroundColor: color,
        borderColor: workflowBorderColor(color),
        backgroundClip: 'padding-box',
      }}
    />
  )
}

function WorkflowDropdownItem({ item }: DropdownItemRenderProps) {
  const color = (item.color as string) ?? '#888'
  return (
    <>
      <div
        className='h-[14px] w-[14px] flex-shrink-0 rounded-[3px] border-[2px]'
        style={{
          backgroundColor: color,
          borderColor: workflowBorderColor(color),
          backgroundClip: 'padding-box',
        }}
      />
      <span className='truncate'>{item.name}</span>
    </>
  )
}

function DefaultDropdownItem({ item }: DropdownItemRenderProps) {
  return <span className='truncate'>{item.name}</span>
}

function FileDropdownItem({ item }: DropdownItemRenderProps) {
  const DocIcon = getDocumentIcon('', item.name)
  return (
    <>
      <DocIcon className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-icon)]' />
      <span className='truncate'>{item.name}</span>
    </>
  )
}

function IconDropdownItem({ item, icon: Icon }: DropdownItemRenderProps & { icon: ElementType }) {
  return (
    <>
      <Icon className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-icon)]' />
      <span className='truncate'>{item.name}</span>
    </>
  )
}

export const RESOURCE_REGISTRY: Record<MothershipResourceType, ResourceTypeConfig> = {
  generic: {
    type: 'generic',
    label: 'Results',
    icon: TerminalWindow,
    renderTabIcon: (_resource, className) => (
      <TerminalWindow className={cn(className, 'text-[var(--text-icon)]')} />
    ),
    renderDropdownItem: (props) => <DefaultDropdownItem {...props} />,
  },
  workflow: {
    type: 'workflow',
    label: 'Workflows',
    icon: WorkflowIcon,
    renderTabIcon: (resource, className) => (
      <WorkflowTabSquare workflowId={resource.id} className={className} />
    ),
    renderDropdownItem: (props) => <WorkflowDropdownItem {...props} />,
  },
  table: {
    type: 'table',
    label: 'Tables',
    icon: TableIcon,
    renderTabIcon: (_resource, className) => (
      <TableIcon className={cn(className, 'text-[var(--text-icon)]')} />
    ),
    renderDropdownItem: (props) => <IconDropdownItem {...props} icon={TableIcon} />,
  },
  file: {
    type: 'file',
    label: 'Files',
    icon: FileIcon,
    renderTabIcon: (resource, className) => {
      const DocIcon = getDocumentIcon('', resource.title)
      return <DocIcon className={cn(className, 'text-[var(--text-icon)]')} />
    },
    renderDropdownItem: (props) => <FileDropdownItem {...props} />,
  },
  knowledgebase: {
    type: 'knowledgebase',
    label: 'Knowledge Bases',
    icon: Database,
    renderTabIcon: (_resource, className) => (
      <Database className={cn(className, 'text-[var(--text-icon)]')} />
    ),
    renderDropdownItem: (props) => <IconDropdownItem {...props} icon={Database} />,
  },
  folder: {
    type: 'folder',
    label: 'Folders',
    icon: FolderIcon,
    renderTabIcon: (_resource, className) => (
      <FolderIcon className={cn(className, 'text-[var(--text-icon)]')} />
    ),
    renderDropdownItem: (props) => <IconDropdownItem {...props} icon={FolderIcon} />,
  },
  task: {
    type: 'task',
    label: 'Tasks',
    icon: Blimp,
    renderTabIcon: (_resource, className) => (
      <Blimp className={cn(className, 'text-[var(--text-icon)]')} />
    ),
    renderDropdownItem: (props) => <IconDropdownItem {...props} icon={Blimp} />,
  },
  log: {
    type: 'log',
    label: 'Logs',
    icon: Library,
    renderTabIcon: (_resource, className) => (
      <Library className={cn(className, 'text-[var(--text-icon)]')} />
    ),
    renderDropdownItem: (props) => <IconDropdownItem {...props} icon={Library} />,
  },
} as const

export const RESOURCE_TYPES = Object.values(RESOURCE_REGISTRY)

export function getResourceConfig(type: MothershipResourceType): ResourceTypeConfig {
  return RESOURCE_REGISTRY[type]
}

type CacheableResourceType = Exclude<MothershipResourceType, 'generic'>

const RESOURCE_INVALIDATORS: Record<
  CacheableResourceType,
  (qc: QueryClient, workspaceId: string, resourceId: string) => void
> = {
  table: (qc, _wId, id) => {
    qc.invalidateQueries({ queryKey: tableKeys.lists() })
    qc.invalidateQueries({ queryKey: tableKeys.detail(id) })
  },
  file: (qc, wId, id) => {
    qc.invalidateQueries({ queryKey: workspaceFilesKeys.lists() })
    qc.invalidateQueries({ queryKey: workspaceFilesKeys.contentFile(wId, id) })
    qc.invalidateQueries({ queryKey: workspaceFilesKeys.storageInfo() })
  },
  workflow: (qc, wId) => {
    void invalidateWorkflowLists(qc, wId)
  },
  knowledgebase: (qc, _wId, id) => {
    qc.invalidateQueries({ queryKey: knowledgeKeys.lists() })
    qc.invalidateQueries({ queryKey: knowledgeKeys.detail(id) })
    qc.invalidateQueries({ queryKey: knowledgeKeys.tagDefinitions(id) })
  },
  folder: (qc) => {
    qc.invalidateQueries({ queryKey: folderKeys.lists() })
  },
  task: (qc, wId) => {
    qc.invalidateQueries({ queryKey: taskKeys.list(wId) })
  },
  log: (qc, _wId, id) => {
    qc.invalidateQueries({ queryKey: logKeys.details() })
    qc.invalidateQueries({ queryKey: logKeys.detail(id) })
  },
}

/**
 * Invalidate list and detail queries for a specific resource.
 * Called when a `resource_added` event arrives so the embedded view refreshes
 * and the add-resource dropdown stays up to date.
 */
export function invalidateResourceQueries(
  queryClient: QueryClient,
  workspaceId: string,
  resourceType: MothershipResourceType,
  resourceId: string
): void {
  if (resourceType === 'generic') return
  RESOURCE_INVALIDATORS[resourceType](queryClient, workspaceId, resourceId)
}
