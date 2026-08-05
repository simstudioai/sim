'use client'

import type { ComponentType, ReactElement } from 'react'
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
  FolderedItem,
  IntegrationSearchItem,
  PageItem,
  SearchEntry,
  SearchEntryHandlers,
  TaskItem,
  WorkflowItem,
  WorkspaceItem,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import {
  GROUP_HEADING_CLASSNAME,
  getActionGroupLabel,
  getToolOperationLabel,
  SECTION_LABELS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
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
    <Command.Group heading='Platform' className={GROUP_HEADING_CLASSNAME}>
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
  heading = 'Blocks',
}: {
  items: SearchBlockItem[]
  onSelect: (block: SearchBlockItem) => void
  heading?: string | null
}) {
  if (items.length === 0) return null
  return (
    <Command.Group heading={heading ?? undefined} className={GROUP_HEADING_CLASSNAME}>
      {items.map((block) => (
        <MemoizedCommandItem
          key={block.id}
          value={`${block.name} block-${block.id}`}
          onSelect={() => onSelect(block)}
          icon={block.icon}
          bgColor={block.bgColor}
          showColoredIcon
          workflowType={block.type}
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
          logoUrl={workspace.logoUrl}
          color={workspace.color}
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
    items: FolderedItem[]
    onSelect: (item: FolderedItem) => void
  }) {
    if (items.length === 0) return null
    return (
      <Command.Group heading={heading} className={GROUP_HEADING_CLASSNAME}>
        {items.map((item) => (
          <MemoizedIconItem
            key={item.id}
            value={`${item.name} ${item.folderPath?.join(' / ') ?? ''} ${prefix}-${item.id}`}
            onSelect={() => onSelect(item)}
            name={item.name}
            icon={icon}
            folderPath={item.folderPath}
          />
        ))}
      </Command.Group>
    )
  })
}

interface RenderEntryOptions {
  keyPrefix: string
  meta?: string
  search: string
}

function renderSearchEntry(
  entry: SearchEntry,
  handlers: SearchEntryHandlers,
  options: RenderEntryOptions
): ReactElement {
  const key = `${options.keyPrefix}${entry.section}-${entry.item.id}`
  const rowProps = {
    meta: options.meta,
  }

  switch (entry.section) {
    case 'actions':
      return (
        <MemoizedActionItem
          key={key}
          value={`${entry.item.name} ${entry.item.keywords ?? ''} ${key}`}
          onSelect={() => handlers.onSelectAction(entry.item)}
          icon={entry.item.icon}
          name={entry.item.name}
          shortcut={entry.item.shortcut}
          {...rowProps}
        />
      )
    case 'connectedAccounts':
      return (
        <MemoizedCommandItem
          key={key}
          value={`${entry.item.name} ${key}`}
          onSelect={() => handlers.onSelectConnectedAccount(entry.item)}
          icon={entry.item.icon}
          bgColor={entry.item.bgColor}
          showColoredIcon
          label={entry.item.name}
          {...rowProps}
        />
      )
    case 'integrations':
      return (
        <MemoizedCommandItem
          key={key}
          value={`${entry.item.name} ${key}`}
          onSelect={() => handlers.onSelectIntegration(entry.item)}
          icon={entry.item.icon}
          bgColor={entry.item.bgColor}
          showColoredIcon
          label={entry.item.name}
          {...rowProps}
        />
      )
    case 'blocks':
      return (
        <MemoizedCommandItem
          key={key}
          value={`${entry.item.name} ${key}`}
          onSelect={() => handlers.onSelectBlock(entry.item)}
          icon={entry.item.icon}
          bgColor={entry.item.bgColor}
          showColoredIcon
          workflowType={entry.item.type}
          label={entry.item.name}
          {...rowProps}
        />
      )
    case 'tools':
      return (
        <MemoizedCommandItem
          key={key}
          value={`${entry.item.name} ${key}`}
          onSelect={() => handlers.onSelectTool(entry.item)}
          icon={entry.item.icon}
          bgColor={entry.item.bgColor}
          showColoredIcon
          label={entry.item.name}
          {...rowProps}
        />
      )
    case 'triggers':
      return (
        <MemoizedCommandItem
          key={key}
          value={`${entry.item.name} ${key}`}
          onSelect={() => handlers.onSelectTrigger(entry.item)}
          icon={entry.item.icon}
          bgColor={entry.item.bgColor}
          showColoredIcon
          label={entry.item.name}
          {...rowProps}
        />
      )
    case 'chats':
      return (
        <MemoizedTaskItem
          key={key}
          value={`${entry.item.name} ${key}`}
          onSelect={() => handlers.onSelectChat(entry.item)}
          name={entry.item.name}
          {...rowProps}
        />
      )
    case 'workflows':
      return (
        <MemoizedWorkflowItem
          key={key}
          value={`${entry.item.name} ${entry.item.folderPath?.join(' / ') ?? ''} ${key}`}
          onSelect={() => handlers.onSelectWorkflow(entry.item)}
          name={entry.item.name}
          folderPath={entry.item.folderPath}
          isCurrent={entry.item.isCurrent}
          {...rowProps}
        />
      )
    case 'tables':
      return (
        <MemoizedIconItem
          key={key}
          value={`${entry.item.name} ${key}`}
          onSelect={() => handlers.onSelectTable(entry.item)}
          name={entry.item.name}
          icon={Table}
          {...rowProps}
        />
      )
    case 'files':
      return (
        <MemoizedFileItem
          key={key}
          value={`${entry.item.name} ${entry.item.folderPath?.join(' / ') ?? ''} ${key}`}
          onSelect={() => handlers.onSelectFile(entry.item)}
          name={entry.item.name}
          folderPath={entry.item.folderPath}
          {...rowProps}
        />
      )
    case 'knowledgeBases':
      return (
        <MemoizedIconItem
          key={key}
          value={`${entry.item.name} ${key}`}
          onSelect={() => handlers.onSelectKnowledgeBase(entry.item)}
          name={entry.item.name}
          icon={Database}
          {...rowProps}
        />
      )
    case 'toolOperations':
      return (
        <MemoizedCommandItem
          key={key}
          value={`${entry.item.searchValue} ${key}`}
          onSelect={() => handlers.onSelectToolOperation(entry.item)}
          icon={entry.item.icon}
          bgColor={entry.item.bgColor}
          showColoredIcon
          label={getToolOperationLabel(entry.item, options.search)}
          {...rowProps}
        />
      )
    case 'workspaces':
      return (
        <MemoizedWorkspaceItem
          key={key}
          value={`${entry.item.name} ${key}`}
          onSelect={() => handlers.onSelectWorkspace(entry.item)}
          name={entry.item.name}
          isCurrent={entry.item.isCurrent}
          logoUrl={entry.item.logoUrl}
          color={entry.item.color}
          {...rowProps}
        />
      )
    case 'docs':
      return (
        <MemoizedCommandItem
          key={key}
          value={`${entry.item.name} docs documentation ${key}`}
          onSelect={() => handlers.onSelectDoc(entry.item)}
          icon={entry.item.icon}
          bgColor='#6B7280'
          showColoredIcon
          label={entry.item.name}
          {...rowProps}
        />
      )
    case 'pages':
      return (
        <MemoizedPageItem
          key={key}
          value={`${entry.item.name} ${key}`}
          onSelect={() => handlers.onSelectPage(entry.item)}
          icon={entry.item.icon}
          name={entry.item.name}
          shortcut={entry.item.shortcut}
          {...rowProps}
        />
      )
  }
}

interface SearchEntryGroupProps {
  variant: 'section' | 'results'
  heading?: string
  search?: string
  entries: SearchEntry[]
  handlers: SearchEntryHandlers
}

/** Renders ordinary and aggregate rows with their existing section chrome. */
export const SearchEntryGroup = memo(function SearchEntryGroup({
  variant,
  heading,
  search = '',
  entries,
  handlers,
}: SearchEntryGroupProps) {
  if (entries.length === 0) return null

  const keyPrefix = variant === 'results' ? 'results-' : ''
  const renderedEntries = entries.map((entry) =>
    renderSearchEntry(entry, handlers, {
      keyPrefix,
      meta:
        variant === 'results'
          ? entry.section === 'actions'
            ? getActionGroupLabel(entry.item)
            : SECTION_LABELS[entry.section]
          : undefined,
      search,
    })
  )

  if (variant === 'results') {
    return <Command.Group className={GROUP_HEADING_CLASSNAME}>{renderedEntries}</Command.Group>
  }

  return (
    <Command.Group heading={heading} className={GROUP_HEADING_CLASSNAME}>
      {renderedEntries}
    </Command.Group>
  )
})
