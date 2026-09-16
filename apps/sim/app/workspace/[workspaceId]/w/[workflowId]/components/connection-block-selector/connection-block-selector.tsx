'use client'

import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button, cn } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { WorkflowBlockBorder, type WorkflowBorderPort } from '@sim/workflow-renderer'
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react'
import { Command } from 'cmdk'
import { useParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { captureEvent } from '@/lib/posthog/client'
import {
  CommandFadedList,
  CommandSearch,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/components/command-chrome'
import { MemoizedCommandItem } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/components/command-items'
import {
  BlocksGroup,
  ToolsGroup,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/components/search-groups'
import {
  filterAndCap,
  GROUP_HEADING_CLASSNAME,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import {
  CMDK_ITEM_GAP_CLASS,
  CMDK_SECTION_GAP_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { useSearchModalStore } from '@/stores/modals/search/store'
import type {
  PendingConnect,
  SearchBlockItem,
  SearchToolOperationItem,
} from '@/stores/modals/search/types'

export const CONNECTION_BLOCK_SELECTOR_NODE_ID = '__connection-block-selector__'

export const CONNECTION_BLOCK_SELECTOR_DIMENSIONS = {
  width: 250,
  height: 352,
} as const

const SELECTOR_ACTION_MENU_WIDTH = 140
const SELECTOR_ACTION_MENU_RIGHT_INSET = 24
const SELECTOR_ACTION_MENU_AMPLITUDE = 7
const RECENT_SELECTION_LIMIT = 3
const RECENT_SELECTION_STORAGE_PREFIX = 'sim:connection-block-selector:recent'
const BROWSE_PREFETCH_MARGIN_PX = 640
const BROWSE_PAGE_SIZE = 50
const POPULAR_BLOCK_TYPES = [
  'agent',
  'function',
  'api',
  'condition',
  'knowledge',
  'memory',
] as const

/** Ordered prefix that reuses the source array once `count` covers all of it. */
function takePrefix<T>(items: T[], count: number): T[] {
  return count >= items.length ? items : items.slice(0, Math.max(0, count))
}

const SELECTOR_PORTS: WorkflowBorderPort[] = [
  {
    id: 'target',
    side: 'left',
    position: 'center',
    plateau: 38,
    color: 'var(--text-secondary)',
    restAmplitude: 1,
    hoverAmplitude: 1,
    magnetizable: false,
  },
  {
    id: 'action-menu',
    side: 'top',
    position: {
      fromEnd: SELECTOR_ACTION_MENU_RIGHT_INSET + SELECTOR_ACTION_MENU_WIDTH / 2,
    },
    plateau: SELECTOR_ACTION_MENU_WIDTH,
    restAmplitude: SELECTOR_ACTION_MENU_AMPLITUDE,
    hoverAmplitude: SELECTOR_ACTION_MENU_AMPLITUDE,
    magnetizable: false,
  },
]

export interface ConnectionBlockSelectorData extends Record<string, unknown> {
  pendingConnect: PendingConnect
  onClose: () => void
}

export type ConnectionBlockSelectorNode = Node<
  ConnectionBlockSelectorData,
  'connectionBlockSelector'
>

type RecentSelection =
  | { kind: 'block'; id: string }
  | { kind: 'tool'; id: string }
  | { kind: 'tool_operation'; id: string }

type RecentPickerResult =
  | { kind: 'block'; item: SearchBlockItem }
  | { kind: 'tool'; item: SearchBlockItem }
  | { kind: 'tool_operation'; item: SearchToolOperationItem }

function getBlockCommandValue(item: SearchBlockItem, kind: 'block' | 'tool'): string {
  return `${item.name} ${kind}-${item.id}`
}

function getToolOperationCommandValue(item: SearchToolOperationItem): string {
  return `${item.searchValue} operation-${item.id}`
}

function getPickerResultCommandValue(result: RecentPickerResult): string {
  return result.kind === 'tool_operation'
    ? getToolOperationCommandValue(result.item)
    : getBlockCommandValue(result.item, result.kind)
}

function getRecentCommandValue(result: RecentPickerResult): string {
  return `recent ${getPickerResultCommandValue(result)}`
}

function isRecentSelection(value: unknown): value is RecentSelection {
  if (
    !value ||
    typeof value !== 'object' ||
    !('kind' in value) ||
    !('id' in value) ||
    typeof value.id !== 'string'
  ) {
    return false
  }
  return value.kind === 'block' || value.kind === 'tool' || value.kind === 'tool_operation'
}

/**
 * Transient on-canvas block picker shown after a connection is released on the
 * pane. Its outer silhouette is the canonical workflow-card border, so the
 * temporary edge reads as connected to the block that will replace it.
 */
export function ConnectionBlockSelector({ id, data }: NodeProps<ConnectionBlockSelectorNode>) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const currentWorkflowId = params.workflowId as string | undefined
  const posthog = usePostHog()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const browseSentinelRef = useRef<HTMLDivElement>(null)
  const [search, setSearch] = useState('')
  const [selectedValue, setSelectedValue] = useState('')
  const [recentSelections, setRecentSelections] = useState<RecentSelection[]>([])
  const [browseLimit, setBrowseLimit] = useState(BROWSE_PAGE_SIZE)
  const deferredSearch = useDeferredValue(search)
  const isSearching = deferredSearch.trim().length > 0
  const recentStorageKey = `${RECENT_SELECTION_STORAGE_PREFIX}:${workspaceId}`
  const { blocks, tools, toolOperations } = useSearchModalStore((state) => state.data)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') data.onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [data])

  useEffect(() => {
    try {
      const storedSelections = window.localStorage.getItem(recentStorageKey)
      if (!storedSelections) {
        setRecentSelections([])
        return
      }
      const parsedSelections: unknown = JSON.parse(storedSelections)
      setRecentSelections(
        Array.isArray(parsedSelections)
          ? parsedSelections.filter(isRecentSelection).slice(0, RECENT_SELECTION_LIMIT)
          : []
      )
    } catch {
      setRecentSelections([])
    }
  }, [recentStorageKey])

  const availableBlocks = useMemo(
    () =>
      blocks.filter(
        (block) => !block.sourceWorkflowId || block.sourceWorkflowId !== currentWorkflowId
      ),
    [blocks, currentWorkflowId]
  )

  const availableTools = useMemo(
    () =>
      tools.filter((tool) => !tool.sourceWorkflowId || tool.sourceWorkflowId !== currentWorkflowId),
    [currentWorkflowId, tools]
  )

  const searchCandidates = useMemo<RecentPickerResult[]>(
    () => [
      ...availableBlocks.map((item): RecentPickerResult => ({ kind: 'block', item })),
      ...availableTools.map((item): RecentPickerResult => ({ kind: 'tool', item })),
      ...toolOperations.map((item): RecentPickerResult => ({ kind: 'tool_operation', item })),
    ],
    [availableBlocks, availableTools, toolOperations]
  )

  const searchResults = useMemo(
    () =>
      deferredSearch.trim()
        ? filterAndCap(
            searchCandidates,
            (result) => result.item.name,
            deferredSearch,
            (result) => result.item.searchValue
          )
        : [],
    [deferredSearch, searchCandidates]
  )

  const recentSelectionKeys = useMemo(
    () => new Set(recentSelections.map((selection) => `${selection.kind}:${selection.id}`)),
    [recentSelections]
  )

  const recentResults = useMemo(() => {
    const blocksById = new Map(availableBlocks.map((block) => [block.id, block]))
    const toolsById = new Map(availableTools.map((tool) => [tool.id, tool]))
    const operationsById = new Map(toolOperations.map((operation) => [operation.id, operation]))
    const results: RecentPickerResult[] = []

    for (const selection of recentSelections) {
      if (selection.kind === 'block') {
        const item = blocksById.get(selection.id)
        if (item) results.push({ kind: 'block', item })
      } else if (selection.kind === 'tool') {
        const item = toolsById.get(selection.id)
        if (item) results.push({ kind: 'tool', item })
      } else {
        const item = operationsById.get(selection.id)
        if (item) results.push({ kind: 'tool_operation', item })
      }
    }

    return results.slice(0, RECENT_SELECTION_LIMIT)
  }, [availableBlocks, availableTools, recentSelections, toolOperations])

  const popularBlocks = useMemo(
    () =>
      POPULAR_BLOCK_TYPES.map((type) => availableBlocks.find((block) => block.type === type))
        .filter((block): block is SearchBlockItem => Boolean(block))
        .filter((block) => !recentSelectionKeys.has(`block:${block.id}`))
        .slice(0, RECENT_SELECTION_LIMIT),
    [availableBlocks, recentSelectionKeys]
  )

  const popularBlockIds = useMemo(
    () => new Set(popularBlocks.map((block) => block.id)),
    [popularBlocks]
  )

  const browseBlocks = useMemo(
    () =>
      availableBlocks.filter(
        (block) => !recentSelectionKeys.has(`block:${block.id}`) && !popularBlockIds.has(block.id)
      ),
    [availableBlocks, popularBlockIds, recentSelectionKeys]
  )

  const browseTools = useMemo(
    () => availableTools.filter((tool) => !recentSelectionKeys.has(`tool:${tool.id}`)),
    [availableTools, recentSelectionKeys]
  )
  const visibleBrowseBlocks = useMemo(
    () => takePrefix(browseBlocks, browseLimit),
    [browseBlocks, browseLimit]
  )
  const visibleBrowseTools = useMemo(
    () => takePrefix(browseTools, browseLimit - browseBlocks.length),
    [browseBlocks.length, browseLimit, browseTools]
  )
  const hasMoreBrowseResults = browseLimit < browseBlocks.length + browseTools.length

  /**
   * Mounting every cmdk item up front caused the frame spike; a manual "show
   * more" control would leak that constraint into the UI. Prefetching near the
   * viewport keeps scrolling continuous and cmdk's keyboard navigation intact.
   */
  useEffect(() => {
    const list = listRef.current
    const sentinel = browseSentinelRef.current
    if (isSearching || !hasMoreBrowseResults || !list || !sentinel) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        startTransition(() => {
          setBrowseLimit((current) => current + BROWSE_PAGE_SIZE)
        })
      },
      {
        root: list,
        rootMargin: `0px 0px ${BROWSE_PREFETCH_MARGIN_PX}px 0px`,
      }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMoreBrowseResults, isSearching])

  const dispatchSelection = useCallback(
    (type: string, resultType: 'block' | 'tool' | 'tool_operation', presetOperation?: string) => {
      window.dispatchEvent(
        new CustomEvent('add-block-from-toolbar', {
          detail: {
            type,
            presetOperation,
            pendingConnect: data.pendingConnect,
          },
        })
      )
      captureEvent(posthog, 'search_result_selected', {
        result_type: resultType,
        query_length: deferredSearch.length,
        workspace_id: workspaceId,
      })
      data.onClose()
    },
    [data, deferredSearch.length, posthog, workspaceId]
  )

  const rememberSelection = useCallback(
    (selection: RecentSelection) => {
      const nextSelections = [
        selection,
        ...recentSelections.filter(
          (recent) => recent.kind !== selection.kind || recent.id !== selection.id
        ),
      ].slice(0, RECENT_SELECTION_LIMIT)
      setRecentSelections(nextSelections)
      try {
        window.localStorage.setItem(recentStorageKey, JSON.stringify(nextSelections))
      } catch {
        return
      }
    },
    [recentSelections, recentStorageKey]
  )

  const handleBlockSelect = useCallback(
    (block: SearchBlockItem) => {
      rememberSelection({ kind: 'block', id: block.id })
      dispatchSelection(block.type, 'block')
    },
    [dispatchSelection, rememberSelection]
  )

  const handleToolSelect = useCallback(
    (tool: SearchBlockItem) => {
      rememberSelection({ kind: 'tool', id: tool.id })
      dispatchSelection(tool.type, 'tool')
    },
    [dispatchSelection, rememberSelection]
  )

  const handleToolOperationSelect = (operation: SearchToolOperationItem) => {
    rememberSelection({ kind: 'tool_operation', id: operation.id })
    dispatchSelection(operation.blockType, 'tool_operation', operation.operationId)
  }

  const resetResultsViewport = useCallback(() => {
    const list = listRef.current
    if (!list) return
    list.scrollTop = 0
  }, [])

  let firstResultValue = ''
  const firstSearchResult = searchResults[0]
  const firstRecent = recentResults[0]
  const firstPopular = popularBlocks[0]
  const firstBrowseBlock = browseBlocks[0]
  const firstBrowseTool = browseTools[0]

  if (isSearching) {
    if (firstSearchResult) firstResultValue = getPickerResultCommandValue(firstSearchResult)
  } else if (firstRecent) {
    firstResultValue = getRecentCommandValue(firstRecent)
  } else if (firstPopular) {
    firstResultValue = getBlockCommandValue(firstPopular, 'block')
  } else if (firstBrowseBlock) {
    firstResultValue = getBlockCommandValue(firstBrowseBlock, 'block')
  } else if (firstBrowseTool) {
    firstResultValue = getBlockCommandValue(firstBrowseTool, 'tool')
  }

  const resolvedSelectedValue = selectedValue || (search === deferredSearch ? firstResultValue : '')

  const handleSearchChange = (value: string) => {
    setSearch(value)
    setSelectedValue('')
    requestAnimationFrame(resetResultsViewport)
  }

  useEffect(() => {
    const frame = requestAnimationFrame(resetResultsViewport)
    return () => cancelAnimationFrame(frame)
  }, [deferredSearch, resetResultsViewport])

  return (
    <div
      role='dialog'
      aria-label='Add a connected block'
      className='workflow-drag-handle relative h-[352px] w-[250px] cursor-grab select-none rounded-2xl [&:active]:cursor-grabbing'
    >
      <WorkflowBlockBorder
        nodeId={id}
        ports={SELECTOR_PORTS}
        cursorSwellEnabled={false}
        hasRing
        ringStyles='ring-[1.5px] ring-[var(--text-secondary)]'
        height={CONNECTION_BLOCK_SELECTOR_DIMENSIONS.height}
      />
      <div
        data-workflow-action-bar-swell=''
        className='-top-[28px] pointer-events-auto absolute right-[24px] z-30 flex h-[28px] w-[140px] items-center justify-between gap-1.5 overflow-hidden py-0.5 pr-[0.2rem] pl-5'
      >
        <span className='min-w-max shrink-0 whitespace-nowrap font-medium text-[var(--surface-2)] text-sm leading-5'>
          Add block
        </span>
        <Button
          variant='ghost'
          onClick={data.onClose}
          aria-label='Close block selector'
          title='Close'
          className="nodrag nopan [&_svg]:-translate-x-[6px] h-[24px]! w-[40px]! shrink-0 rounded-md border-none bg-[color-mix(in_srgb,var(--surface-2)_18%,transparent)]! p-0 text-[color-mix(in_srgb,var(--text-inverse)_72%,transparent)]! transition-[background-color,color,opacity,transform] duration-150 [clip-path:path('M16.25_0A8_8_0_0_1_22.4_2.88L36.59_19.9A2.5_2.5_0_0_1_34.66_24L4_24A4_4_0_0_1_0_20L0_4A4_4_0_0_1_4_0Z')] hover-hover:bg-[var(--surface-2)]! hover-hover:text-[var(--text-primary)]! active:scale-[0.96] [&_svg]:translate-y-px"
        >
          <X className='size-[14px]' />
        </Button>
      </div>
      <Handle
        type='target'
        position={Position.Left}
        id='target'
        className='-translate-y-1/2! top-1/2! left-0! z-30! h-[38px]! w-[14px]! cursor-default! rounded-none! border-none! bg-transparent! opacity-0!'
        isConnectableStart={false}
        isConnectableEnd={false}
      />

      <Command
        label='Add a connected block'
        shouldFilter={false}
        value={resolvedSelectedValue}
        onValueChange={setSelectedValue}
        className='relative z-20 flex h-full flex-col overflow-hidden rounded-2xl [clip-path:inset(0_round_16px)]'
      >
        <div className='relative min-h-0 flex-1'>
          <CommandFadedList
            ref={listRef}
            className={cn(
              "nodrag nopan nowheel allow-scroll scrollbar-none h-full [clip-path:inset(3px_round_13px)] [&_[cmdk-item][aria-selected='true']]:border-transparent! [&_[cmdk-item][aria-selected='true']]:bg-[var(--surface-hover)]! [&_[cmdk-item]_svg]:scale-100! [&_[cmdk-item]_svg]:transition-none!",
              CMDK_ITEM_GAP_CLASS,
              CMDK_SECTION_GAP_CLASS
            )}
          >
            <Command.Empty className='flex items-center justify-center px-4 py-8 text-center text-[var(--text-subtle)] text-sm'>
              No blocks found.
            </Command.Empty>
            {isSearching ? (
              searchResults.length > 0 && (
                <Command.Group className={GROUP_HEADING_CLASSNAME}>
                  {searchResults.map((result) => (
                    <MemoizedCommandItem
                      key={`search-${result.kind}-${result.item.id}`}
                      value={getPickerResultCommandValue(result)}
                      onSelect={() => {
                        if (result.kind === 'block') handleBlockSelect(result.item)
                        else if (result.kind === 'tool') handleToolSelect(result.item)
                        else handleToolOperationSelect(result.item)
                      }}
                      icon={result.item.icon}
                      bgColor={result.item.bgColor}
                      blockType={
                        result.kind === 'tool_operation' ? result.item.blockType : result.item.type
                      }
                      label={result.item.name}
                    />
                  ))}
                </Command.Group>
              )
            ) : (
              <>
                {recentResults.length > 0 && (
                  <Command.Group heading='Recently used' className={GROUP_HEADING_CLASSNAME}>
                    {recentResults.map((result) => {
                      if (result.kind === 'tool_operation') {
                        return (
                          <MemoizedCommandItem
                            key={`recent-operation-${result.item.id}`}
                            value={getRecentCommandValue(result)}
                            onSelect={() => handleToolOperationSelect(result.item)}
                            icon={result.item.icon}
                            bgColor={result.item.bgColor}
                            blockType={result.item.blockType}
                            label={result.item.name}
                          />
                        )
                      }

                      return (
                        <MemoizedCommandItem
                          key={`recent-${result.kind}-${result.item.id}`}
                          value={getRecentCommandValue(result)}
                          onSelect={() =>
                            result.kind === 'block'
                              ? handleBlockSelect(result.item)
                              : handleToolSelect(result.item)
                          }
                          icon={result.item.icon}
                          bgColor={result.item.bgColor}
                          blockType={result.item.type}
                          label={result.item.name}
                        />
                      )
                    })}
                  </Command.Group>
                )}
                <BlocksGroup items={popularBlocks} onSelect={handleBlockSelect} heading='Popular' />
                <BlocksGroup
                  items={visibleBrowseBlocks}
                  onSelect={handleBlockSelect}
                  heading='All blocks'
                />
                <ToolsGroup items={visibleBrowseTools} onSelect={handleToolSelect} />
                {hasMoreBrowseResults && (
                  <div ref={browseSentinelRef} aria-hidden='true' className='h-px' />
                )}
              </>
            )}
          </CommandFadedList>
          <CommandSearch
            ref={inputRef}
            surface='canvas'
            autoFocus
            aria-label='Search blocks'
            value={search}
            onValueChange={handleSearchChange}
            placeholder='Search blocks...'
          />
        </div>
      </Command>
    </div>
  )
}
