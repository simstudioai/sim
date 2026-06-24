'use client'

import type { ComponentType } from 'react'
import { memo } from 'react'
import { Database, Table } from '@sim/emcn/icons'
import { Command } from 'cmdk'
import {
  Activity,
  BarChart3,
  Blocks,
  FileText,
  GitBranch,
  LifeBuoy,
  ListChecks,
  type LucideIcon,
  Mail,
  Megaphone,
  MessageCircle,
  Search as SearchIcon,
  Shield,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react'
import {
  MemoizedActionItem,
  MemoizedCategoryItem,
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
import { IntegrationType } from '@/blocks/types'
import type {
  SearchBlockItem,
  SearchCategory,
  SearchDocItem,
  SearchToolOperationItem,
} from '@/stores/modals/search/types'

/**
 * Icon per integration category. Exhaustive over {@link IntegrationType} so a
 * newly added category is a compile error here rather than a silent fallback.
 */
const INTEGRATION_CATEGORY_ICONS: Record<IntegrationType, LucideIcon> = {
  [IntegrationType.AI]: Sparkles,
  [IntegrationType.Analytics]: BarChart3,
  [IntegrationType.Commerce]: ShoppingCart,
  [IntegrationType.Communication]: MessageCircle,
  [IntegrationType.Databases]: Database,
  [IntegrationType.DevOps]: GitBranch,
  [IntegrationType.Documents]: FileText,
  [IntegrationType.Email]: Mail,
  [IntegrationType.HR]: Users,
  [IntegrationType.Marketing]: Megaphone,
  [IntegrationType.Observability]: Activity,
  [IntegrationType.Productivity]: ListChecks,
  [IntegrationType.Sales]: TrendingUp,
  [IntegrationType.Search]: SearchIcon,
  [IntegrationType.Security]: Shield,
  [IntegrationType.Support]: LifeBuoy,
}

/** Resolves the icon for a browse category from its kind, then its integration slug. */
function categoryIcon(category: SearchCategory): LucideIcon {
  if (category.kind === 'block') return Blocks
  if (category.kind === 'trigger') return Zap
  return INTEGRATION_CATEGORY_ICONS[category.id as IntegrationType] ?? Blocks
}

export const ActionsGroup = memo(function ActionsGroup({
  items,
  onSelect,
  query,
}: {
  items: ActionItem[]
  onSelect: (action: ActionItem) => void
  query?: string
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
          query={query}
        />
      ))}
    </Command.Group>
  )
})

/** A recent selection resolved to a renderable row by the modal. */
export interface RecentRenderItem {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  bgColor: string
  onSelect: () => void
}

export const RecentsGroup = memo(function RecentsGroup({ items }: { items: RecentRenderItem[] }) {
  if (items.length === 0) return null
  return (
    <Command.Group heading='Recent' className={GROUP_HEADING_CLASSNAME}>
      {items.map((item) => (
        <MemoizedCommandItem
          key={item.id}
          value={`${item.label} recent-${item.id}`}
          onSelect={item.onSelect}
          icon={item.icon}
          bgColor={item.bgColor}
          showColoredIcon
          label={item.label}
        />
      ))}
    </Command.Group>
  )
})

export const BrowseGroup = memo(function BrowseGroup({
  items,
  onSelect,
}: {
  items: SearchCategory[]
  onSelect: (category: SearchCategory) => void
}) {
  if (items.length === 0) return null
  return (
    <Command.Group heading='Browse' className={GROUP_HEADING_CLASSNAME}>
      {items.map((category) => (
        <MemoizedCategoryItem
          key={category.id}
          value={`${category.label} category-${category.id}`}
          onSelect={() => onSelect(category)}
          icon={categoryIcon(category)}
          name={category.label}
          count={category.count}
        />
      ))}
    </Command.Group>
  )
})

export const BlocksGroup = memo(function BlocksGroup({
  items,
  onSelect,
  query,
  heading = 'Blocks',
}: {
  items: SearchBlockItem[]
  onSelect: (block: SearchBlockItem) => void
  query?: string
  heading?: string
}) {
  if (items.length === 0) return null
  return (
    <Command.Group heading={heading} className={GROUP_HEADING_CLASSNAME}>
      {items.map((block) => (
        <MemoizedCommandItem
          key={block.id}
          value={`${block.name} block-${block.id}`}
          onSelect={() => onSelect(block)}
          icon={block.icon}
          bgColor={block.bgColor}
          showColoredIcon
          label={block.name}
          query={query}
        />
      ))}
    </Command.Group>
  )
})

export const ToolsGroup = memo(function ToolsGroup({
  items,
  onSelect,
  query,
  heading = 'Tools',
}: {
  items: SearchBlockItem[]
  onSelect: (tool: SearchBlockItem) => void
  query?: string
  heading?: string
}) {
  if (items.length === 0) return null
  return (
    <Command.Group heading={heading} className={GROUP_HEADING_CLASSNAME}>
      {items.map((tool) => (
        <MemoizedCommandItem
          key={tool.id}
          value={`${tool.name} tool-${tool.id}`}
          onSelect={() => onSelect(tool)}
          icon={tool.icon}
          bgColor={tool.bgColor}
          showColoredIcon
          label={tool.name}
          query={query}
        />
      ))}
    </Command.Group>
  )
})

export const TriggersGroup = memo(function TriggersGroup({
  items,
  onSelect,
  query,
  heading = 'Triggers',
}: {
  items: SearchBlockItem[]
  onSelect: (trigger: SearchBlockItem) => void
  query?: string
  heading?: string
}) {
  if (items.length === 0) return null
  return (
    <Command.Group heading={heading} className={GROUP_HEADING_CLASSNAME}>
      {items.map((trigger) => (
        <MemoizedCommandItem
          key={trigger.id}
          value={`${trigger.name} trigger-${trigger.id}`}
          onSelect={() => onSelect(trigger)}
          icon={trigger.icon}
          bgColor={trigger.bgColor}
          showColoredIcon
          label={trigger.name}
          query={query}
        />
      ))}
    </Command.Group>
  )
})

export const ToolOpsGroup = memo(function ToolOpsGroup({
  items,
  onSelect,
  query,
}: {
  items: SearchToolOperationItem[]
  onSelect: (op: SearchToolOperationItem) => void
  query?: string
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
          query={query}
        />
      ))}
    </Command.Group>
  )
})

export const DocsGroup = memo(function DocsGroup({
  items,
  onSelect,
  query,
}: {
  items: SearchDocItem[]
  onSelect: (doc: SearchDocItem) => void
  query?: string
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
          query={query}
        />
      ))}
    </Command.Group>
  )
})

export const WorkflowsGroup = memo(function WorkflowsGroup({
  items,
  onSelect,
  query,
}: {
  items: WorkflowItem[]
  onSelect: (workflow: WorkflowItem) => void
  query?: string
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
          query={query}
        />
      ))}
    </Command.Group>
  )
})

export const ChatsGroup = memo(function ChatsGroup({
  items,
  onSelect,
  query,
}: {
  items: TaskItem[]
  onSelect: (task: TaskItem) => void
  query?: string
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
          query={query}
        />
      ))}
    </Command.Group>
  )
})

export const WorkspacesGroup = memo(function WorkspacesGroup({
  items,
  onSelect,
  query,
}: {
  items: WorkspaceItem[]
  onSelect: (workspace: WorkspaceItem) => void
  query?: string
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
          query={query}
        />
      ))}
    </Command.Group>
  )
})

export const PagesGroup = memo(function PagesGroup({
  items,
  onSelect,
  query,
}: {
  items: PageItem[]
  onSelect: (page: PageItem) => void
  query?: string
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
          query={query}
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
  query,
}: {
  items: FileItem[]
  onSelect: (file: FileItem) => void
  query?: string
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
          query={query}
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
    query,
  }: {
    items: IntegrationSearchItem[]
    onSelect: (item: IntegrationSearchItem) => void
    query?: string
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
            query={query}
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
    query,
  }: {
    items: TaskItem[]
    onSelect: (item: TaskItem) => void
    query?: string
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
            query={query}
          />
        ))}
      </Command.Group>
    )
  })
}
