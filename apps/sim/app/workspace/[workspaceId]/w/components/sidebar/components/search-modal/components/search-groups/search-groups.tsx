'use client'

import type { ComponentType, ReactNode } from 'react'
import { memo, useCallback, useMemo } from 'react'
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
import {
  FALLBACK_BG_COLOR,
  GROUP_HEADING_CLASSNAME,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
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
const INTEGRATION_CATEGORY_ICONS: Record<IntegrationType, ComponentType<{ className?: string }>> = {
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
function categoryIcon(category: SearchCategory): ComponentType<{ className?: string }> {
  if (category.kind === 'block') return Blocks
  if (category.kind === 'trigger') return Zap
  return INTEGRATION_CATEGORY_ICONS[category.id as IntegrationType] ?? Blocks
}

/**
 * Dispatches a cmdk row selection by looking the row's `value` back up in a
 * `Map` built from the current `items`, instead of handing each row a
 * per-render closure. This keeps `onSelect`'s identity stable across renders
 * (so `React.memo` on the row components actually bails out, and the row
 * genuinely re-renders only when the row itself changes) and removes the
 * stale-closure risk of a memo comparator that ignores `onSelect` while every
 * call site allocates a fresh arrow function per item per render.
 */
function useItemDispatch<T>(
  items: T[],
  valueFor: (item: T) => string,
  onSelect: (item: T) => void
): (value: string) => void {
  const itemByValue = useMemo(() => {
    const map = new Map<string, T>()
    for (const item of items) map.set(valueFor(item), item)
    return map
  }, [items, valueFor])
  return useCallback(
    (value: string) => {
      const item = itemByValue.get(value)
      if (item) onSelect(item)
    },
    [itemByValue, onSelect]
  )
}

/**
 * Non-interactive trailing row shown when a group's cap trimmed real matches,
 * so truncation is communicated instead of silently dropping the tail of a
 * broad query. Not a `Command.Item` — it isn't selectable and must never
 * participate in keyboard navigation.
 */
const TruncationRow = memo(function TruncationRow({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <div className='mx-0.5 flex h-[26px] items-center px-2 text-[var(--text-subtle)] text-small'>
      +{count} more — refine your search
    </div>
  )
})

/**
 * Builds a `Command.Group` component: dispatch through {@link useItemDispatch},
 * render each item via `renderRow`, then an optional {@link TruncationRow}.
 * Every group in this file is produced by this one factory instead of each
 * hand-copying the "empty check → heading → rows → truncation" shell —
 * `renderRow` is the only part that's genuinely per-group.
 */
function createRowGroup<T>(
  displayName: string,
  defaultHeading: string,
  valueFor: (item: T) => string,
  renderRow: (
    item: T,
    handleSelect: (value: string) => void,
    query: string | undefined
  ) => ReactNode
) {
  const RowGroup = memo(function RowGroup({
    items,
    onSelect,
    query,
    heading = defaultHeading,
    truncatedCount = 0,
  }: {
    items: T[]
    onSelect: (item: T) => void
    query?: string
    heading?: string
    truncatedCount?: number
  }) {
    const handleSelect = useItemDispatch(items, valueFor, onSelect)
    if (items.length === 0) return null
    return (
      <Command.Group heading={heading} className={GROUP_HEADING_CLASSNAME}>
        {items.map((item) => renderRow(item, handleSelect, query))}
        <TruncationRow count={truncatedCount} />
      </Command.Group>
    )
  })
  RowGroup.displayName = displayName
  return RowGroup
}

const actionValue = (action: ActionItem) =>
  `${action.name} ${action.keywords ?? ''} action-${action.id}`

export const ActionsGroup = createRowGroup(
  'ActionsGroup',
  'Actions',
  actionValue,
  (action, handleSelect, query) => (
    <MemoizedActionItem
      key={action.id}
      value={actionValue(action)}
      onSelect={handleSelect}
      icon={action.icon}
      name={action.name}
      shortcut={action.shortcut}
      query={query}
    />
  )
)

/** A recent selection resolved to a renderable row by the modal. */
export interface RecentRenderItem {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  bgColor: string
  onSelect: () => void
}

const recentValue = (item: RecentRenderItem) => `${item.label} recent-${item.id}`
/** Hoisted so its identity never changes — {@link useItemDispatch}'s dispatcher stays stable. */
const callRecentOnSelect = (item: RecentRenderItem) => item.onSelect()

const RecentsRowGroup = createRowGroup(
  'RecentsGroup',
  'Recent',
  recentValue,
  (item, handleSelect) => (
    <MemoizedCommandItem
      key={item.id}
      value={recentValue(item)}
      onSelect={handleSelect}
      icon={item.icon}
      bgColor={item.bgColor}
      showColoredIcon
      label={item.label}
    />
  )
)

/** Recents carry their own per-item handler, so there's no top-level `onSelect` to thread. */
export const RecentsGroup = memo(function RecentsGroup({ items }: { items: RecentRenderItem[] }) {
  return <RecentsRowGroup items={items} onSelect={callRecentOnSelect} />
})

const categoryValue = (category: SearchCategory) => `${category.label} category-${category.id}`

export const BrowseGroup = createRowGroup(
  'BrowseGroup',
  'Browse',
  categoryValue,
  (category, handleSelect, query) => (
    <MemoizedIconItem
      key={category.id}
      value={categoryValue(category)}
      onSelect={handleSelect}
      icon={categoryIcon(category)}
      name={category.label}
      count={category.count}
      query={query}
    />
  )
)

const blockValue = (block: SearchBlockItem) => `${block.name} block-${block.id}`

export const BlocksGroup = createRowGroup(
  'BlocksGroup',
  'Blocks',
  blockValue,
  (block, handleSelect, query) => (
    <MemoizedCommandItem
      key={block.id}
      value={blockValue(block)}
      onSelect={handleSelect}
      icon={block.icon}
      bgColor={block.bgColor}
      showColoredIcon
      label={block.name}
      query={query}
    />
  )
)

const toolValue = (tool: SearchBlockItem) => `${tool.name} tool-${tool.id}`

export const ToolsGroup = createRowGroup(
  'ToolsGroup',
  'Tools',
  toolValue,
  (tool, handleSelect, query) => (
    <MemoizedCommandItem
      key={tool.id}
      value={toolValue(tool)}
      onSelect={handleSelect}
      icon={tool.icon}
      bgColor={tool.bgColor}
      showColoredIcon
      label={tool.name}
      query={query}
    />
  )
)

const triggerValue = (trigger: SearchBlockItem) => `${trigger.name} trigger-${trigger.id}`

export const TriggersGroup = createRowGroup(
  'TriggersGroup',
  'Triggers',
  triggerValue,
  (trigger, handleSelect, query) => (
    <MemoizedCommandItem
      key={trigger.id}
      value={triggerValue(trigger)}
      onSelect={handleSelect}
      icon={trigger.icon}
      bgColor={trigger.bgColor}
      showColoredIcon
      label={trigger.name}
      query={query}
    />
  )
)

const toolOpValue = (op: SearchToolOperationItem) => `${op.searchValue} operation-${op.id}`

export const ToolOpsGroup = createRowGroup(
  'ToolOpsGroup',
  'Tool operations',
  toolOpValue,
  (op, handleSelect, query) => (
    <MemoizedCommandItem
      key={op.id}
      value={toolOpValue(op)}
      onSelect={handleSelect}
      icon={op.icon}
      bgColor={op.bgColor}
      showColoredIcon
      label={op.name}
      query={query}
    />
  )
)

const docValue = (doc: SearchDocItem) => `${doc.name} docs documentation doc-${doc.id}`

export const DocsGroup = createRowGroup(
  'DocsGroup',
  'Docs',
  docValue,
  (doc, handleSelect, query) => (
    <MemoizedCommandItem
      key={doc.id}
      value={docValue(doc)}
      onSelect={handleSelect}
      icon={doc.icon}
      bgColor={FALLBACK_BG_COLOR}
      showColoredIcon
      label={doc.name}
      query={query}
    />
  )
)

const workflowValue = (workflow: WorkflowItem) =>
  `${workflow.name} ${workflow.folderPath?.join(' / ') ?? ''} workflow-${workflow.id}`

export const WorkflowsGroup = createRowGroup(
  'WorkflowsGroup',
  'Workflows',
  workflowValue,
  (workflow, handleSelect, query) => (
    <MemoizedWorkflowItem
      key={workflow.id}
      value={workflowValue(workflow)}
      onSelect={handleSelect}
      name={workflow.name}
      folderPath={workflow.folderPath}
      isCurrent={workflow.isCurrent}
      query={query}
    />
  )
)

const taskValue = (task: TaskItem) => `${task.name} task-${task.id}`

export const ChatsGroup = createRowGroup(
  'ChatsGroup',
  'Chats',
  taskValue,
  (task, handleSelect, query) => (
    <MemoizedTaskItem
      key={task.id}
      value={taskValue(task)}
      onSelect={handleSelect}
      name={task.name}
      query={query}
    />
  )
)

const workspaceValue = (workspace: WorkspaceItem) => `${workspace.name} workspace-${workspace.id}`

export const WorkspacesGroup = createRowGroup(
  'WorkspacesGroup',
  'Workspaces',
  workspaceValue,
  (workspace, handleSelect, query) => (
    <MemoizedWorkspaceItem
      key={workspace.id}
      value={workspaceValue(workspace)}
      onSelect={handleSelect}
      name={workspace.name}
      isCurrent={workspace.isCurrent}
      query={query}
    />
  )
)

const pageValue = (page: PageItem) => `${page.name} page-${page.id}`

export const PagesGroup = createRowGroup(
  'PagesGroup',
  'Pages',
  pageValue,
  (page, handleSelect, query) => (
    <MemoizedPageItem
      key={page.id}
      value={pageValue(page)}
      onSelect={handleSelect}
      icon={page.icon}
      name={page.name}
      shortcut={page.shortcut}
      query={query}
    />
  )
)

const fileValue = (file: FileItem) =>
  `${file.name} ${file.folderPath?.join(' / ') ?? ''} file-${file.id}`

export const FilesGroup = createRowGroup(
  'FilesGroup',
  'Files',
  fileValue,
  (file, handleSelect, query) => (
    <MemoizedFileItem
      key={file.id}
      value={fileValue(file)}
      onSelect={handleSelect}
      name={file.name}
      folderPath={file.folderPath}
      query={query}
    />
  )
)

/**
 * Groups whose rows render each item with its own brand icon on a
 * brand-colored tile (the same `showColoredIcon` pattern as `BlocksGroup` /
 * `ToolsGroup`) — used where every row has a distinct per-item icon and color.
 */
function createColoredIconGroup(displayName: string, heading: string, prefix: string) {
  const valueFor = (item: IntegrationSearchItem) => `${item.name} ${prefix}-${item.id}`
  return createRowGroup(displayName, heading, valueFor, (item, handleSelect, query) => (
    <MemoizedCommandItem
      key={item.id}
      value={valueFor(item)}
      onSelect={handleSelect}
      icon={item.icon}
      bgColor={item.bgColor}
      showColoredIcon
      label={item.name}
      query={query}
    />
  ))
}

function createIconGroup(
  displayName: string,
  heading: string,
  prefix: string,
  icon: ComponentType<{ className?: string }>
) {
  const valueFor = (item: TaskItem) => `${item.name} ${prefix}-${item.id}`
  return createRowGroup(displayName, heading, valueFor, (item, handleSelect, query) => (
    <MemoizedIconItem
      key={item.id}
      value={valueFor(item)}
      onSelect={handleSelect}
      name={item.name}
      icon={icon}
      query={query}
    />
  ))
}

export const TablesGroup = createIconGroup('TablesGroup', 'Tables', 'table', Table)
export const KnowledgeBasesGroup = createIconGroup(
  'KnowledgeBasesGroup',
  'Knowledge bases',
  'knowledge-base',
  Database
)

export const ConnectedAccountsGroup = createColoredIconGroup(
  'ConnectedAccountsGroup',
  'Connected',
  'connected-account'
)
export const IntegrationsGroup = createColoredIconGroup(
  'IntegrationsGroup',
  'Integrations',
  'integration'
)
