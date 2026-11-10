'use client'

import {
  type ComponentType,
  forwardRef,
  memo,
  type ReactNode,
  type RefObject,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cn } from '@sim/emcn/lib/cn'
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react'
import { Command } from 'cmdk'
import { usePostHog } from 'posthog-js/react'
import { BlockTile } from '@/app/(product)/_components/workspace/workflows/canvas/block-tile/block-tile'
import styles from '@/app/(product)/_components/workspace/workflows/canvas/connection-block-selector/connection-block-selector.module.css'
import {
  WorkflowBlockBorder,
  type WorkflowBorderPort,
} from '@/app/(product)/_components/workspace/workflows/canvas/workflow-block/border'
import { CanvasTooltip } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-block/canvas-tooltip'
import { OverflowSpan } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-block/overflow-span'
import {
  buildBlockSearchIndex,
  captureEvent,
  filterAndCap,
  Search,
  type SearchBlockItem,
  type SearchToolOperationItem,
  useCustomBlockOverlayVersion,
  usePermissionConfig,
  useProvidersStore,
  useScopedWorkflowId,
  useWorkflowScope,
  X,
} from '@/platform/lib/data/workflows'

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

/**
 * Sub-pixel scroll positions and rounding leave `scrollTop` or the remaining
 * distance fractionally above zero at rest; anything within this is "at the edge".
 */
const EDGE_TOLERANCE_PX = 1

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
    color: 'var(--wf-text-secondary)',
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

/**
 * The edge drag-release the picker completes: the dragged source handle and the canvas-space
 * release point. A selection carries it on its event, so the canvas places the block at the drop
 * point and wires it from that handle.
 */
export interface PendingConnect {
  source: { nodeId: string; handleId: string }
  position: { x: number; y: number }
}

/** Data the canvas attaches to the transient picker node. */
export interface ConnectionBlockSelectorData extends Record<string, unknown> {
  pendingConnect: PendingConnect
  onClose: () => void
}

type ConnectionBlockSelectorNode = Node<ConnectionBlockSelectorData, 'connectionBlockSelector'>

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

interface ScrollEdges {
  top: boolean
  bottom: boolean
}

const AT_REST: ScrollEdges = { top: false, bottom: false }

/**
 * Whether the result list hides rows beyond its top or bottom edge, tracked across scrolling and
 * resizes of the list and its content (the legacy `useScrollEdges`, vertical only).
 */
function useScrollEdges(target: RefObject<HTMLElement | null>): ScrollEdges {
  const [edges, setEdges] = useState<[start: boolean, end: boolean]>([false, false])

  useEffect(() => {
    const container = target.current
    if (!container) {
      setEdges([false, false])
      return
    }

    const update = () => {
      const start = container.scrollTop > EDGE_TOLERANCE_PX
      const end =
        container.scrollHeight - container.clientHeight - container.scrollTop > EDGE_TOLERANCE_PX
      setEdges((current) => (current[0] === start && current[1] === end ? current : [start, end]))
    }

    update()
    container.addEventListener('scroll', update, { passive: true })

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(container)
    const content = container.firstElementChild
    if (content) observer?.observe(content)

    return () => {
      container.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [target])

  const [start, end] = edges
  return start || end ? { top: start, bottom: end } : AT_REST
}

interface CommandSearchProps {
  value: string
  onValueChange: (value: string) => void
  placeholder: string
  'aria-label': string
  autoFocus?: boolean
}

interface CommandFadedListProps {
  children: ReactNode
}

/**
 * Borderless search field layered over the fading result list.
 *
 * The matching indent and negative margin give leading glyphs room inside
 * Chrome's input clip edge without moving the text out of alignment.
 */
const CommandSearch = forwardRef<HTMLInputElement, CommandSearchProps>(function CommandSearch(
  { value, onValueChange, placeholder, 'aria-label': ariaLabel, autoFocus },
  ref
) {
  return (
    <div className={`nodrag nopan ${styles.search}`}>
      <Search className={styles.searchIcon} />
      <Command.Input
        ref={ref}
        className={styles.searchInput}
        value={value}
        onValueChange={onValueChange}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
      />
    </div>
  )
})

/**
 * Scrollable command list with the edge fade. The search field floats over the
 * list's top 48px (the top padding keeps the first row clear of it), so the top
 * band is inset by that height: while scrolled, rows are fully hidden under the
 * field and fade in just beneath it. At rest neither edge fades, so the first
 * group's heading and the last row are never fogged on a list that has not moved.
 */
const CommandFadedList = forwardRef<HTMLDivElement, CommandFadedListProps>(
  function CommandFadedList({ children }, ref) {
    const listRef = useRef<HTMLDivElement | null>(null)
    const edges = useScrollEdges(listRef)

    const setRefs = useCallback(
      (node: HTMLDivElement | null) => {
        listRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      },
      [ref]
    )

    return (
      <Command.List
        ref={setRefs}
        className={`nodrag nopan nowheel allow-scroll ${styles.list}`}
        data-scroll-fade-top={edges.top || undefined}
        data-scroll-fade-bottom={edges.bottom || undefined}
      >
        {children}
      </Command.List>
    )
  }
)

interface CommandItemProps {
  value: string
  onSelect: () => void
  icon: ComponentType<{ className?: string }>
  bgColor: string
  blockType: string
  label: string
}

const MemoizedCommandItem = memo(
  function CommandItem({ value, onSelect, icon, bgColor, blockType, label }: CommandItemProps) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={styles.item}>
        <BlockTile blockType={blockType} icon={icon} bgColor={bgColor} />
        <OverflowSpan value={label} className={styles.itemLabel} />
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.icon === next.icon &&
    prev.bgColor === next.bgColor &&
    prev.blockType === next.blockType &&
    prev.label === next.label
)

interface BlocksGroupProps {
  items: SearchBlockItem[]
  onSelect: (block: SearchBlockItem) => void
  heading?: string | null
}

const BlocksGroup = memo(function BlocksGroup({
  items,
  onSelect,
  heading = 'Blocks',
}: BlocksGroupProps) {
  if (items.length === 0) return null
  return (
    <Command.Group heading={heading ?? undefined} className={styles.group}>
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

interface ToolsGroupProps {
  items: SearchBlockItem[]
  onSelect: (tool: SearchBlockItem) => void
}

const ToolsGroup = memo(function ToolsGroup({ items, onSelect }: ToolsGroupProps) {
  if (items.length === 0) return null
  return (
    <Command.Group heading='Tools' className={styles.group}>
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

/**
 * Transient on-canvas block picker shown after a connection is released on the
 * pane. Its outer silhouette is the canonical workflow-card border, so the
 * temporary edge reads as connected to the block that will replace it.
 */
export function ConnectionBlockSelector({ id, data }: NodeProps<ConnectionBlockSelectorNode>) {
  const { workspaceId } = useWorkflowScope()
  const currentWorkflowId = useScopedWorkflowId()
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
  const { filterBlocks, isToolAllowed } = usePermissionConfig()
  const customBlockOverlayVersion = useCustomBlockOverlayVersion()
  const providers = useProvidersStore((state) => state.providers)
  const providerModelSignature = useMemo(
    () =>
      Object.values(providers)
        .map((provider) => provider.models.join('\x00'))
        .join('\x01'),
    [providers]
  )
  /* Searchable dropdown options can list provider models, and custom blocks arrive with the
     overlay, so both rebuild the index though neither is read here. */
  const { blocks, tools, toolOperations } = useMemo(
    () => buildBlockSearchIndex(filterBlocks, isToolAllowed),
    [filterBlocks, isToolAllowed, providerModelSignature, customBlockOverlayVersion]
  )

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
      className={`workflow-drag-handle ${styles.root}`}
    >
      <WorkflowBlockBorder
        nodeId={id}
        ports={SELECTOR_PORTS}
        cursorSwellEnabled={false}
        hasRing
        ring='selected'
        height={CONNECTION_BLOCK_SELECTOR_DIMENSIONS.height}
      />
      <div data-workflow-action-bar-swell='' className={styles.swell}>
        <span className={styles.swellLabel}>Add block</span>
        <CanvasTooltip content='Close'>
          <button
            type='button'
            onClick={data.onClose}
            aria-label='Close block selector'
            className={cn('nodrag nopan', styles.close)}
          >
            <X className={styles.closeIcon} />
          </button>
        </CanvasTooltip>
      </div>
      <Handle
        type='target'
        position={Position.Left}
        id='target'
        className={styles.handle}
        isConnectableStart={false}
        isConnectableEnd={false}
      />

      <Command
        label='Add a connected block'
        shouldFilter={false}
        value={resolvedSelectedValue}
        onValueChange={setSelectedValue}
        className={styles.command}
      >
        <div className={styles.results}>
          <CommandFadedList ref={listRef}>
            <Command.Empty className={styles.empty}>No blocks found.</Command.Empty>
            {isSearching ? (
              searchResults.length > 0 && (
                <Command.Group className={styles.group}>
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
                  <Command.Group heading='Recently used' className={styles.group}>
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
                  <div ref={browseSentinelRef} aria-hidden='true' className={styles.sentinel} />
                )}
              </>
            )}
          </CommandFadedList>
          <CommandSearch
            ref={inputRef}
            autoFocus
            aria-label='Search blocks'
            value={search}
            onValueChange={handleSearchChange}
            placeholder='Search blocks…'
          />
        </div>
      </Command>
    </div>
  )
}
