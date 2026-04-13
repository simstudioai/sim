'use client'

import type { ComponentType } from 'react'
import { memo } from 'react'
import { Command } from 'cmdk'
import { Database, File, Table } from '@/components/emcn/icons'
import type {
  SearchBlockItem,
  SearchDocItem,
  SearchToolOperationItem,
} from '@/stores/modals/search/types'
import type { PageItem, TaskItem, WorkflowItem, WorkspaceItem } from '../utils'
import { GROUP_HEADING_CLASSNAME } from '../utils'
import {
  MemoizedCommandItem,
  MemoizedIconItem,
  MemoizedPageItem,
  MemoizedTaskItem,
  MemoizedWorkflowItem,
  MemoizedWorkspaceItem,
} from './command-items'

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
        >
          {block.name}
        </MemoizedCommandItem>
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
        >
          {tool.name}
        </MemoizedCommandItem>
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
        >
          {trigger.name}
        </MemoizedCommandItem>
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
    <Command.Group heading='Tool Operations' className={GROUP_HEADING_CLASSNAME}>
      {items.map((op) => (
        <MemoizedCommandItem
          key={op.id}
          value={`${op.searchValue} operation-${op.id}`}
          onSelect={() => onSelect(op)}
          icon={op.icon}
          bgColor={op.bgColor}
          showColoredIcon
        >
          {op.name}
        </MemoizedCommandItem>
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
        >
          {doc.name}
        </MemoizedCommandItem>
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
          value={`${workflow.name} ${workflow.folderPath ?? ''} workflow-${workflow.id}`}
          onSelect={() => onSelect(workflow)}
          color={workflow.color}
          name={workflow.name}
          folderPath={workflow.folderPath}
          isCurrent={workflow.isCurrent}
        />
      ))}
    </Command.Group>
  )
})

export const TasksGroup = memo(function TasksGroup({
  items,
  onSelect,
}: {
  items: TaskItem[]
  onSelect: (task: TaskItem) => void
}) {
  if (items.length === 0) return null
  return (
    <Command.Group heading='Tasks' className={GROUP_HEADING_CLASSNAME}>
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
export const FilesGroup = createIconGroup('Files', 'file', File)
export const KnowledgeBasesGroup = createIconGroup('Knowledge Bases', 'knowledge-base', Database)

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
