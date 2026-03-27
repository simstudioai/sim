'use client'

import type { ElementType, ReactNode } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import {
  Database,
  File as FileIcon,
  Table as TableIcon,
  TerminalWindow,
} from '@/components/emcn/icons'
import { WorkflowIcon } from '@/components/icons'
import { getDocumentIcon } from '@/components/icons/document-icons'
import { cn } from '@/lib/core/utils/cn'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { knowledgeKeys } from '@/hooks/queries/kb/knowledge'
import { tableKeys } from '@/hooks/queries/tables'
import { workflowKeys } from '@/hooks/queries/workflows'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

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
  const color = useWorkflowRegistry((state) => state.workflows[workflowId]?.color ?? '#888')
  return (
    <div
      className={cn('flex-shrink-0 rounded-[3px] border-[2px]', className)}
      style={{
        backgroundColor: color,
        borderColor: `${color}60`,
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
        className='mr-[0px] h-[14px] w-[14px] flex-shrink-0 rounded-[3px] border-[2px]'
        style={{
          backgroundColor: color,
          borderColor: `${color}60`,
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
      <DocIcon className='mr-2 h-[14px] w-[14px] text-[var(--text-icon)]' />
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
    renderDropdownItem: (props) => <DefaultDropdownItem {...props} />,
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
    renderDropdownItem: (props) => <DefaultDropdownItem {...props} />,
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
  workflow: (qc, _wId) => {
    qc.invalidateQueries({ queryKey: workflowKeys.lists() })
  },
  knowledgebase: (qc, _wId, id) => {
    qc.invalidateQueries({ queryKey: knowledgeKeys.lists() })
    qc.invalidateQueries({ queryKey: knowledgeKeys.detail(id) })
    qc.invalidateQueries({ queryKey: knowledgeKeys.tagDefinitions(id) })
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
