'use client'

import type { ReactElement } from 'react'
import { memo } from 'react'
import { Library } from '@sim/emcn'
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
  SearchEntry,
  SearchEntryHandlers,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import { GROUP_HEADING_CLASSNAME } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import type { SearchBlockItem } from '@/stores/modals/search/types'

/** Canvas block group, consumed by the connection block selector. */
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
          blockType={block.type}
          label={block.name}
        />
      ))}
    </Command.Group>
  )
})

/** Canvas tool group, consumed by the connection block selector. */
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
          blockType={tool.type}
          label={tool.name}
        />
      ))}
    </Command.Group>
  )
})

interface RenderEntryOptions {
  keyPrefix: string
}

function renderSearchEntry(
  entry: SearchEntry,
  handlers: SearchEntryHandlers,
  options: RenderEntryOptions
): ReactElement {
  const key = `${options.keyPrefix}${entry.section}-${entry.item.id}`

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
          blockType={entry.item.type}
          label={entry.item.name}
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
          blockType={entry.item.type}
          label={entry.item.name}
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
          blockType={entry.item.type}
          label={entry.item.name}
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
          blockType={entry.item.blockType}
          labelPrefix={entry.item.serviceName}
          label={entry.item.name}
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
          label={entry.item.name}
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
          label={entry.item.name}
        />
      )
    case 'chats':
      return (
        <MemoizedTaskItem
          key={key}
          value={`${entry.item.name} ${key}`}
          onSelect={() => handlers.onSelectChat(entry.item)}
          name={entry.item.name}
          meta={entry.item.date}
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
        />
      )
    case 'tables':
      return (
        <MemoizedIconItem
          key={key}
          value={`${entry.item.name} ${entry.item.folderPath?.join(' / ') ?? ''} ${key}`}
          onSelect={() => handlers.onSelectTable(entry.item)}
          name={entry.item.name}
          icon={Table}
          folderPath={entry.item.folderPath}
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
        />
      )
    case 'knowledgeBases':
      return (
        <MemoizedIconItem
          key={key}
          value={`${entry.item.name} ${entry.item.folderPath?.join(' / ') ?? ''} ${key}`}
          onSelect={() => handlers.onSelectKnowledgeBase(entry.item)}
          name={entry.item.name}
          icon={Database}
          folderPath={entry.item.folderPath}
        />
      )
    case 'logs':
      return (
        <MemoizedIconItem
          key={key}
          value={`${entry.item.name} ${key}`}
          onSelect={() => handlers.onSelectLog(entry.item)}
          name={entry.item.name}
          icon={Library}
          meta={entry.item.date}
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
        />
      )
  }
}

interface SearchEntryGroupProps {
  variant: 'section' | 'results'
  heading?: string
  entries: SearchEntry[]
  handlers: SearchEntryHandlers
}

/** Renders ordinary and aggregate rows with their existing section chrome. */
export const SearchEntryGroup = memo(function SearchEntryGroup({
  variant,
  heading,
  entries,
  handlers,
}: SearchEntryGroupProps) {
  if (entries.length === 0) return null

  const keyPrefix = variant === 'results' ? 'results-' : ''
  const renderedEntries = entries.map((entry) => renderSearchEntry(entry, handlers, { keyPrefix }))

  if (variant === 'results') {
    return <Command.Group className={GROUP_HEADING_CLASSNAME}>{renderedEntries}</Command.Group>
  }

  return (
    <Command.Group heading={heading} className={GROUP_HEADING_CLASSNAME}>
      {renderedEntries}
    </Command.Group>
  )
})
