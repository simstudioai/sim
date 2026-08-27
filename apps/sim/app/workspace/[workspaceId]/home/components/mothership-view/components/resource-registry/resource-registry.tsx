'use client'

import type { ElementType, ReactNode } from 'react'
import { cn } from '@sim/emcn'
import {
  Connections,
  Database,
  File as FileIcon,
  Folder as FolderIcon,
  Globe,
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
import { getDisplayStatus, STATUS_CONFIG } from '@/app/workspace/[workspaceId]/logs/utils'
import { BrandIcon, type StyleableIcon } from '@/blocks/brand-icon'
import { logKeys } from '@/hooks/queries/logs'
import { mothershipChatKeys } from '@/hooks/queries/mothership-chats'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { invalidateWorkflowLists } from '@/hooks/queries/utils/invalidate-workflow-lists'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
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
  /**
   * How many of this family's candidates an unfiltered `@` list shows, overriding
   * {@link MENTION_PREVIEW_DEFAULT_LIMIT}. Raise it only for a family whose rows a
   * user browses; the unfiltered list is a preview, not a browser, and typing a
   * query lifts the cap entirely — see `buildMentionPreview`.
   */
  mentionPreviewLimit?: number
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
      <BrandIcon icon={Icon} className='size-[14px] flex-shrink-0' />
      <span className='truncate'>{item.name}</span>
    </>
  )
}

/**
 * A run, not the workflow it ran — the Logs icon is what says so, and it is the
 * same one the sidebar, the search palette, and the resulting chip already use.
 *
 * A run that did not simply succeed carries the same dot `Badge` draws at `sm`,
 * so a status reads identically here and on the logs page. Marking every row
 * would mark nothing, so a plain success gets none.
 */
function LogDropdownItem({ item }: DropdownItemRenderProps) {
  const workflowName = (item.workflowName as string) ?? item.name
  const time = (item.time as string) ?? ''
  const status = getDisplayStatus(item.status as string | null | undefined)
  const statusColor = status === 'info' ? null : STATUS_CONFIG[status].color
  return (
    <>
      <Library className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
      <span className='truncate'>{workflowName}</span>
      {statusColor && (
        <div
          aria-hidden
          className='ml-auto size-[5px] flex-shrink-0 rounded-xs'
          style={{ backgroundColor: statusColor }}
        />
      )}
      {time && (
        <span
          className={cn(
            'flex-shrink-0 text-[var(--text-tertiary)] text-caption',
            !statusColor && 'ml-auto'
          )}
        >
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
    icon: Globe,
    renderTabIcon: (_resource, className) => (
      <Globe className={cn(className, 'text-[var(--text-icon)]')} />
    ),
    renderDropdownItem: (props) => <IconDropdownItem {...props} icon={Globe} />,
  },
  terminal: {
    type: 'terminal',
    label: 'Terminal',
    icon: TerminalWindow,
    renderTabIcon: (_resource, className) => (
      <TerminalWindow className={cn(className, 'text-[var(--text-icon)]')} />
    ),
    renderDropdownItem: (props) => <IconDropdownItem {...props} icon={TerminalWindow} />,
  },
} as const

/**
 * Rows per family in the unfiltered `@` preview, unless the family overrides it
 * with {@link ResourceTypeConfig.mentionPreviewLimit}. Enough to show what a family
 * holds without any one of them crowding out the rest.
 */
export const MENTION_PREVIEW_DEFAULT_LIMIT = 5

/**
 * Top-down order for every menu that lists resource families, mirroring the
 * workspace sidebar so a user reads the same sequence in both places. The two
 * desktop-only panels trail the workspace resources, matching where they surface
 * in the app. `folder`/`filefolder` never render as their own entry — they feed
 * their family's folder tree — but are ordered beside it so a menu that ever does
 * surface them lands in the right place.
 */
export const RESOURCE_MENU_ORDER: readonly MothershipResourceType[] = [
  'integration',
  'task',
  'table',
  'file',
  'filefolder',
  'knowledgebase',
  'workflow',
  'log',
  'folder',
  'browser',
  'terminal',
  'generic',
]

/** Sorts anything keyed by resource type into {@link RESOURCE_MENU_ORDER}. */
export function byResourceMenuOrder<T extends { type: MothershipResourceType }>(
  a: T,
  b: T
): number {
  return RESOURCE_MENU_ORDER.indexOf(a.type) - RESOURCE_MENU_ORDER.indexOf(b.type)
}

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
    // A view the agent just created must be in the list before the embedded
    // table can switch to it; see the view-pin store.
    qc.invalidateQueries({ queryKey: tableKeys.views(id) })
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
  log: (qc, wId, id) => {
    qc.invalidateQueries({ queryKey: logKeys.details() })
    qc.invalidateQueries({ queryKey: logKeys.detail(wId, id) })
  },
  /**
   * Integrations are sourced from the static integration catalog
   * (`listIntegrationsByPopularity()`), not a server-backed query, so there is nothing to
   * invalidate when one is added.
   */
  integration: () => {},
  /**
   * The browser panel hosts the desktop app's natively embedded browser view
   * (in-memory page state, no server-backed query), so there is nothing to
   * invalidate.
   */
  browser: () => {},
  /**
   * The terminal panel is backed by a live PTY in the desktop app, not a
   * server-backed query, so there is nothing to invalidate.
   */
  terminal: () => {},
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
