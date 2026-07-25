'use client'

import type { ComponentType } from 'react'
import { memo } from 'react'
import { Database, Table } from '@sim/emcn/icons'
import { Command } from 'cmdk'
import {
  MemoizedActionItem,
  MemoizedCommandItem,
  MemoizedFileItem,
  MemoizedIconItem,
  MemoizedPageItem,
  MemoizedTaskItem,
  MemoizedWorkflowItem,
  MemoizedWorkspaceItem,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/components/command-items'
import type {
  ActionItem,
  FileItem,
  IntegrationSearchItem,
  PageItem,
  TaskItem,
  WorkflowItem,
  WorkspaceItem,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import { GROUP_HEADING_CLASSNAME } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import type {
  SearchBlockItem,
  SearchDocItem,
  SearchToolOperationItem,
} from '@/stores/modals/search/types'

export const ActionsGroup = memo(function ActionsGroup({
  items,
  onSelect,
}: {
  items: ActionItem[]
  onSelect: (action: ActionItem) => void
}) {
  if (items.length === 0) return null
  return (
    <Command.Group heading='Actions' className={GROUP_HEADING_CLASSNAME}>
      {items.map((action) => (
        <MemoizedActionItem
          key={action.id}
          value={`${action.name} ${action.keywords ?? ''} action-${action.id}`}
          onSelect={() => onSelect(action)}
          icon={action.icon}
          name={action.name}
          shortcut={action.shortcut}
        />
      ))}
    </Command.Group>
  )
})

export const BlocksGroup = memo(function BlocksGroup({
  items,
  onSelect,
}: {
  items: SearchBlockItem[]
  onSelect: (block: SearchBlockItem) => void
}) {
  if (items.length === 0) return null
  return (
    <Command.Group heading='Blocks' className={GROUP_HEADING_CLASSNAME}>
      {items.map((block) => (
        <MemoizedCommandItem
          key={block.id}
          value={`${block.name} block-${block.id}`}
          onSelect={() => onSelect(block)}
          icon={block.icon}
          bgColor={block.bgColor}
          showColoredIcon
          label={block.name}
        />
      ))}
    </Command.Group>
  )
})

export const ToolsGroup = memo(function ToolsGroup({
  items,
  onSelect,
}: {
  items: SearchBlockItem[]
  onSelect: (tool: SearchBlockItem) => void
}) {
  if (items.length === 0) return null
  return (
    <Command.Group heading='Tools' className={GROUP_HEADING_CLASSNAME}>
      {items.map((tool) => (
        <MemoizedCommandItem
          key={tool.id}
          value={`${tool.name} tool-${tool.id}`}
          onSelect={() => onSelect(tool)}
          icon={tool.icon}
          bgColor={tool.bgColor}
          showColoredIcon
          label={tool.name}
        />
      ))}
    </Command.Group>
  )
})

export const TriggersGroup = memo(function TriggersGroup({
  items,
  onSelect,
}: {
  items: SearchBlockItem[]
  onSelect: (trigger: SearchBlockItem) => void
}) {
  if (items.length === 0) return null
  return (
    <Command.Group heading='Triggers' className={GROUP_HEADING_CLASSNAME}>
      {items.map((trigger) => (
        <MemoizedCommandItem
          key={trigger.id}
          value={`${trigger.name} trigger-${trigger.id}`}
          onSelect={() => onSelect(trigger)}
          icon={trigger.icon}
          bgColor={trigger.bgColor}
          showColoredIcon
          label={trigger.name}
        />
      ))}
    </Command.Group>
  )
})

export const ToolOpsGroup = memo(function ToolOpsGroup({
  items,
  onSelect,
}: {
  items: SearchToolOperationItem[]
  onSelect: (op: SearchToolOperationItem) => void
}) {
  if (items.length === 0) return null
  return (
    <Command.Group heading='Tool operations' className={GROUP_HEADING_CLASSNAME}>
      {items.map((op) => (
        <MemoizedCommandItem
          key={op.id}
          value={`${op.searchValue} operation-${op.id}`}
          onSelect={() => onSelect(op)}
          icon={op.icon}
          bgColor={op.bgColor}
          showColoredIcon
          label={op.name}
        />
      ))}
    </Command.Group>
  )
})

export const DocsGroup = memo(function DocsGroup({
  items,
  onSelect,
}: {
  items: SearchDocItem[]
  onSelect: (doc: SearchDocItem) => void
}) {
  if (items.length === 0) return null
  return (
    <Command.Group heading='Docs' className={GROUP_HEADING_CLASSNAME}>
      {items.map((doc) => (
        <MemoizedCommandItem
          key={doc.id}
          value={`${doc.name} docs documentation doc-${doc.id}`}
          onSelect={() => onSelect(doc)}
          icon={doc.icon}
          bgColor='#6B7280'
          showColoredIcon
          label={doc.name}
        />
      ))}
    </Command.Group>
  )
})

export const WorkflowsGroup = memo(function WorkflowsGroup({
  items,
  onSelect,
}: {
  items: WorkflowItem[]
  onSelect: (workflow: WorkflowItem) => void
}) {
  if (items.length === 0) return null
  return (
    <Command.Group heading='Workflows' className={GROUP_HEADING_CLASSNAME}>
      {items.map((workflow) => (
        <MemoizedWorkflowItem
          key={workflow.id}
          value={`${workflow.name} ${workflow.folderPath?.join(' / ') ?? ''} workflow-${workflow.id}`}
          onSelect={() => onSelect(workflow)}
          name={workflow.name}
          folderPath={workflow.folderPath}
          isCurrent={workflow.isCurrent}
        />
      ))}
    </Command.Group>
  )
})

export const ChatsGroup = memo(function ChatsGroup({
  items,
  onSelect,
}: {
  items: TaskItem[]
  onSelect: (task: TaskItem) => void
}) {
  if (items.length === 0) return null
  return (
    <Command.Group heading='Chats' className={GROUP_HEADING_CLASSNAME}>
      {items.map((task) => (
        <MemoizedTaskItem
          key={task.id}
          value={`${task.name} task-${task.id}`}
          onSelect={() => onSelect(task)}
          name={task.name}
        />
      ))}
    </Command.Group>
  )
})

export const WorkspacesGroup = memo(function WorkspacesGroup({
  items,
  onSelect,
}: {
  items: WorkspaceItem[]
  onSelect: (workspace: WorkspaceItem) => void
}) {
  if (items.length === 0) return null
  return (
    <Command.Group heading='Workspaces' className={GROUP_HEADING_CLASSNAME}>
      {items.map((workspace) => (
        <MemoizedWorkspaceItem
          key={workspace.id}
          value={`${workspace.name} workspace-${workspace.id}`}
          onSelect={() => onSelect(workspace)}
          name={workspace.name}
          isCurrent={workspace.isCurrent}
        />
      ))}
    </Command.Group>
  )
})

export const PagesGroup = memo(function PagesGroup({
  items,
  onSelect,
}: {
  items: PageItem[]
  onSelect: (page: PageItem) => void
}) {
  if (items.length === 0) return null
  return (
    <Command.Group heading='Pages' className={GROUP_HEADING_CLASSNAME}>
      {items.map((page) => (
        <MemoizedPageItem
          key={page.id}
          value={`${page.name} page-${page.id}`}
          onSelect={() => onSelect(page)}
          icon={page.icon}
          name={page.name}
          shortcut={page.shortcut}
        />
      ))}
    </Command.Group>
  )
})

export const TablesGroup = createIconGroup('Tables', 'table', Table)
export const KnowledgeBasesGroup = createIconGroup('Knowledge bases', 'knowledge-base', Database)

export const ConnectedAccountsGroup = createColoredIconGroup('Connected', 'connected-account')
export const IntegrationsGroup = createColoredIconGroup('Integrations', 'integration')

export const FilesGroup = memo(function FilesGroup({
  items,
  onSelect,
}: {
  items: FileItem[]
  onSelect: (file: FileItem) => void
}) {
  if (items.length === 0) return null
  return (
    <Command.Group heading='Files' className={GROUP_HEADING_CLASSNAME}>
      {items.map((file) => (
        <MemoizedFileItem
          key={file.id}
          value={`${file.name} ${file.folderPath?.join(' / ') ?? ''} file-${file.id}`}
          onSelect={() => onSelect(file)}
          name={file.name}
          folderPath={file.folderPath}
        />
      ))}
    </Command.Group>
  )
})

/**
 * Factory for groups that render each item with its own brand icon on a
 * brand-colored tile (the same `showColoredIcon` pattern used by
 * `BlocksGroup` / `ToolsGroup`). Used for integrations and connected accounts
 * where every row has a distinct per-item icon and brand color.
 */
function createColoredIconGroup(heading: string, prefix: string) {
  return memo(function ColoredIconGroup({
    items,
    onSelect,
  }: {
    items: IntegrationSearchItem[]
    onSelect: (item: IntegrationSearchItem) => void
  }) {
    if (items.length === 0) return null
    return (
      <Command.Group heading={heading} className={GROUP_HEADING_CLASSNAME}>
        {items.map((item) => (
          <MemoizedCommandItem
            key={item.id}
            value={`${item.name} ${prefix}-${item.id}`}
            onSelect={() => onSelect(item)}
            icon={item.icon}
            bgColor={item.bgColor}
            showColoredIcon
            label={item.name}
          />
        ))}
      </Command.Group>
    )
  })
}

function createIconGroup(
  heading: string,
  prefix: string,
  icon: ComponentType<{ className?: string }>
) {
  return memo(function IconGroup({
    items,
    onSelect,
  }: {
    items: TaskItem[]
    onSelect: (item: TaskItem) => void
  }) {
    if (items.length === 0) return null
    return (
      <Command.Group heading={heading} className={GROUP_HEADING_CLASSNAME}>
        {items.map((item) => (
          <MemoizedIconItem
            key={item.id}
            value={`${item.name} ${prefix}-${item.id}`}
            onSelect={() => onSelect(item)}
            name={item.name}
            icon={icon}
          />
        ))}
      </Command.Group>
    )
  })
}
