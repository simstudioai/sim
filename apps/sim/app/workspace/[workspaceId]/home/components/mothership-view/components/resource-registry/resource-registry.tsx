'use client'

import type { ElementType, ReactNode } from 'react'
import { cn } from '@sim/emcn'
import {
  Calendar,
  Connections,
  Cursor,
  Database,
  File as FileIcon,
  Folder as FolderIcon,
  Library,
  Table as TableIcon,
  Task,
  TerminalWindow,
  Workflow,
} from '@sim/emcn/icons'
import type { QueryClient } from '@tanstack/react-query'
import { getDocumentIcon } from '@/components/icons/document-icons'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { getBareIconStyle, type StyleableIcon } from '@/blocks/icon-color'
import { knowledgeKeys } from '@/hooks/queries/kb/knowledge'
import { logKeys } from '@/hooks/queries/logs'
import { mothershipChatKeys } from '@/hooks/queries/mothership-chats'
import { scheduleKeys } from '@/hooks/queries/schedules'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { invalidateWorkflowLists } from '@/hooks/queries/utils/invalidate-workflow-lists'
import { tableKeys } from '@/hooks/queries/utils/table-keys'
import { workspaceFileFolderKeys } from '@/hooks/queries/workspace-file-folders'
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

function WorkflowDropdownItem({ item }: DropdownItemRenderProps) {
  return (
    <>
      <Workflow className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
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
      <DocIcon className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
      <span className='truncate'>{item.name}</span>
    </>
  )
}

function IconDropdownItem({ item, icon: Icon }: DropdownItemRenderProps & { icon: ElementType }) {
  return (
    <>
      <Icon className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
      <span className='truncate'>{item.name}</span>
    </>
  )
}

/**
 * Renders an integration mention candidate using the block's own brand icon at
 * the standard 14px dropdown size. Single-fill icons drawn with
 * `fill='currentColor'` (e.g. HubSpot) are tinted with the block's brand
 * {@link BlockConfig.iconColor}; multi-color brand icons keep their own SVG fills.
 */
function IntegrationDropdownItem({ item }: DropdownItemRenderProps) {
  const Icon = item.iconComponent as StyleableIcon | undefined
  if (!Icon) return <span className='truncate'>{item.name}</span>
  return (
    <>
      <Icon
        className='size-[14px] flex-shrink-0 text-[var(--text-icon)]'
        style={getBareIconStyle(Icon)}
      />
      <span className='truncate'>{item.name}</span>
    </>
  )
}

function LogDropdownItem({ item }: DropdownItemRenderProps) {
  const workflowName = (item.workflowName as string) ?? item.name
  const time = (item.time as string) ?? ''
  return (
    <>
      <Workflow className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
      <span className='truncate'>{workflowName}</span>
      {time && (
        <span className='ml-auto flex-shrink-0 text-[var(--text-tertiary)] text-caption'>
          {time}
        </span>
      )}
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
    icon: Workflow,
    renderTabIcon: (_resource, className) => (
      <Workflow className={cn(className, 'text-[var(--text-icon)]')} />
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
  filefolder: {
    type: 'filefolder',
    label: 'File Folders',
    icon: FolderIcon,
    renderTabIcon: (_resource, className) => (
      <FolderIcon className={cn(className, 'text-[var(--text-icon)]')} />
    ),
    renderDropdownItem: (props) => <IconDropdownItem {...props} icon={FolderIcon} />,
  },
  task: {
    type: 'task',
    label: 'Chats',
    icon: Task,
    renderTabIcon: (_resource, className) => (
      <Task className={cn(className, 'text-[var(--text-icon)]')} />
    ),
    renderDropdownItem: (props) => <DefaultDropdownItem {...props} />,
  },
  scheduledtask: {
    type: 'scheduledtask',
    label: 'Scheduled Tasks',
    icon: Calendar,
    renderTabIcon: (_resource, className) => (
      <Calendar className={cn(className, 'text-[var(--text-icon)]')} />
    ),
    renderDropdownItem: (props) => <IconDropdownItem {...props} icon={Calendar} />,
  },
  log: {
    type: 'log',
    label: 'Logs',
    icon: Library,
    renderTabIcon: (_resource, className) => (
      <Library className={cn(className, 'text-[var(--text-icon)]')} />
    ),
    renderDropdownItem: (props) => <LogDropdownItem {...props} />,
  },
  integration: {
    type: 'integration',
    label: 'Integrations',
    icon: Connections,
    renderTabIcon: (_resource, className) => (
      <Connections className={cn(className, 'text-[var(--text-icon)]')} />
    ),
    renderDropdownItem: (props) => <IntegrationDropdownItem {...props} />,
  },
  browser: {
    type: 'browser',
    label: 'Browser',
    icon: Cursor,
    renderTabIcon: (_resource, className) => (
      <Cursor className={cn(className, 'text-[var(--text-icon)]')} />
    ),
    renderDropdownItem: (props) => <IconDropdownItem {...props} icon={Cursor} />,
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
  filefolder: (qc, wId) => {
    qc.invalidateQueries({ queryKey: workspaceFileFolderKeys.workspaceLists(wId) })
    qc.invalidateQueries({ queryKey: workspaceFilesKeys.workspaceLists(wId) })
    qc.invalidateQueries({ queryKey: workspaceFilesKeys.storageInfo() })
  },
  task: (qc, wId) => {
    qc.invalidateQueries({ queryKey: mothershipChatKeys.list(wId) })
  },
  scheduledtask: (qc, wId) => {
    qc.invalidateQueries({ queryKey: scheduleKeys.list(wId) })
  },
  log: (qc, wId, id) => {
    qc.invalidateQueries({ queryKey: logKeys.details() })
    qc.invalidateQueries({ queryKey: logKeys.detail(wId, id) })
  },
  /**
   * Integrations are sourced from the static integration catalog
   * (`listIntegrations()`), not a server-backed query, so there is nothing to
   * invalidate when one is added.
   */
  integration: () => {},
  /**
   * The browser panel hosts the desktop app's natively embedded browser view
   * (in-memory page state, no server-backed query), so there is nothing to
   * invalidate.
   */
  browser: () => {},
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
