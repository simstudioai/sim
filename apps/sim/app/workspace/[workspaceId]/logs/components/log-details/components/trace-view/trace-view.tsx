'use client'

import type React from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDuration } from '@sim/utils/formatting'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  Clipboard,
  Search,
  X,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  Badge,
  Button,
  ChevronDown,
  Code,
  Copy as CopyIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Search as SearchIcon,
  Tooltip,
} from '@/components/emcn'
import { AgentSkillsIcon, WorkflowIcon } from '@/components/icons'
import { cn } from '@/lib/core/utils/cn'
import type { TraceSpan } from '@/lib/logs/types'
import { LoopTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/loop/loop-config'
import { ParallelTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/parallel/parallel-config'
import { getBlock, getBlockByToolName } from '@/blocks'
import { useCodeViewerFeatures } from '@/hooks/use-code-viewer'
import { PROVIDER_DEFINITIONS } from '@/providers/models'

const DEFAULT_BLOCK_COLOR = '#6b7280'
const DEFAULT_TREE_PANE_WIDTH = 360
const MIN_TREE_PANE_WIDTH = 200
const MAX_TREE_PANE_WIDTH = 600
const INDENT_PX = 12
const ROW_BASE_PADDING_LEFT = 14
const MIN_BAR_PCT = 0.5

interface TraceViewProps {
  traceSpans: TraceSpan[]
}

interface FlatSpanEntry {
  span: TraceSpan
  depth: number
  parentIds: string[]
  parentDuration?: number
}

interface BlockAppearance {
  icon: React.ComponentType<{ className?: string }> | null
  bgColor: string
}

/**
 * Parses a timestamp or numeric ms into milliseconds since epoch.
 */
function parseTime(value?: string | number | null): number {
  if (!value) return 0
  const ms = typeof value === 'number' ? value : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/**
 * Whether a span type represents a loop or parallel iteration container.
 */
function isIterationType(type: string): boolean {
  const lower = type?.toLowerCase() || ''
  return lower === 'loop-iteration' || lower === 'parallel-iteration'
}

/**
 * Returns the stable id for a span, synthesized when absent.
 */
function getSpanId(span: TraceSpan): string {
  return span.id || `span-${span.name}-${span.startTime}`
}

/**
 * Walks a span's descendants to determine if any error exists in the subtree.
 */
function hasErrorInTree(span: TraceSpan): boolean {
  if (span.status === 'error') return true
  if (span.children?.length) return span.children.some(hasErrorInTree)
  if (span.toolCalls?.length) return span.toolCalls.some((tc) => tc.error)
  return false
}

/**
 * Like `hasErrorInTree` but only counts errors that were not handled by an
 * error-handler path. Used for the root workflow status color.
 */
function hasUnhandledErrorInTree(span: TraceSpan): boolean {
  if (span.status === 'error' && !span.errorHandled) return true
  if (span.children?.length) return span.children.some(hasUnhandledErrorInTree)
  if (span.toolCalls?.length && !span.errorHandled) return span.toolCalls.some((tc) => tc.error)
  return false
}

/**
 * Normalizes and sorts a tree of spans by start time.
 */
function normalizeAndSort(spans: TraceSpan[]): TraceSpan[] {
  return spans
    .map((span) => ({
      ...span,
      children: span.children?.length ? normalizeAndSort(span.children) : undefined,
    }))
    .sort((a, b) => {
      const d = parseTime(a.startTime) - parseTime(b.startTime)
      return d !== 0 ? d : parseTime(a.endTime) - parseTime(b.endTime)
    })
}

/**
 * For agents with no tool calls, hides synthetic model-segment children to
 * avoid noise in the tree.
 */
function getDisplayChildren(span: TraceSpan): TraceSpan[] {
  const kids: TraceSpan[] = span.children?.length
    ? [...span.children]
    : (span.toolCalls ?? []).map((tc, i) => ({
        id: `${getSpanId(span)}-tool-${i}`,
        name: tc.name,
        type: 'tool',
        duration: tc.duration || 0,
        startTime: tc.startTime ?? span.startTime,
        endTime: tc.endTime ?? span.endTime,
        status: tc.error ? ('error' as const) : ('success' as const),
        input: tc.input,
        output: tc.error ? { error: tc.error, ...(tc.output ?? {}) } : tc.output,
      }))
  kids.sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime))
  const isAgent = span.type?.toLowerCase() === 'agent'
  const hasToolCall = kids.some((c) => c.type?.toLowerCase() === 'tool')
  if (isAgent && !hasToolCall) return kids.filter((c) => c.type?.toLowerCase() !== 'model')
  return kids
}

/**
 * Resolves the block icon and accent color for a trace span type.
 */
function getBlockAppearance(type: string, toolName?: string, provider?: string): BlockAppearance {
  const lowerType = type.toLowerCase()
  if (lowerType === 'tool' && toolName) {
    if (toolName === 'load_skill') return { icon: AgentSkillsIcon, bgColor: '#8B5CF6' }
    const toolBlock = getBlockByToolName(toolName)
    if (toolBlock) return { icon: toolBlock.icon, bgColor: toolBlock.bgColor }
  }
  if (lowerType === 'loop' || lowerType === 'loop-iteration')
    return { icon: LoopTool.icon, bgColor: LoopTool.bgColor }
  if (lowerType === 'parallel' || lowerType === 'parallel-iteration')
    return { icon: ParallelTool.icon, bgColor: ParallelTool.bgColor }
  if (lowerType === 'workflow') return { icon: WorkflowIcon, bgColor: '#6366F1' }
  if (lowerType === 'model' && provider) {
    const providerDef = PROVIDER_DEFINITIONS[provider]
    if (providerDef?.icon) {
      return { icon: providerDef.icon, bgColor: providerDef.color ?? DEFAULT_BLOCK_COLOR }
    }
  }
  const blockType = lowerType === 'model' ? 'agent' : lowerType
  const blockConfig = getBlock(blockType)
  if (blockConfig) return { icon: blockConfig.icon, bgColor: blockConfig.bgColor }
  return { icon: null, bgColor: DEFAULT_BLOCK_COLOR }
}

/** Returns 'text-white' for dark backgrounds, dark text for light ones. */
function iconColorClass(bgColor: string): string {
  const hex = bgColor.replace('#', '')
  if (hex.length !== 6) return 'text-white'
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  return r * 299 + g * 587 + b * 114 > 160_000 ? 'text-[#111111]' : 'text-white'
}

function formatTokenCount(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return value.toLocaleString('en-US')
}

function formatCostAmount(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  if (value < 0.0001) return '<$0.0001'
  return `$${value.toFixed(4)}`
}

function formatTtft(ms: number | undefined): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return undefined
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function formatTps(outputTokens: number | undefined, durationMs: number): string | undefined {
  if (typeof outputTokens !== 'number' || !(outputTokens > 0)) return undefined
  if (!(durationMs > 0)) return undefined
  const tps = Math.round(outputTokens / (durationMs / 1000))
  return tps > 0 ? `${tps.toLocaleString('en-US')} tok/s` : undefined
}

/**
 * Flattens the visible (expanded) span tree into a linear list for keyboard
 * navigation, carrying depth, the chain of parent ids for indent drawing, and
 * the immediate parent's duration for percentage-of-parent calculations.
 */
function flattenVisible(spans: TraceSpan[], expanded: Set<string>): FlatSpanEntry[] {
  const out: FlatSpanEntry[] = []
  const walk = (
    list: TraceSpan[],
    depth: number,
    parents: string[],
    parentDuration: number | undefined
  ) => {
    for (const span of list) {
      const id = getSpanId(span)
      out.push({ span, depth, parentIds: parents, parentDuration })
      const children = getDisplayChildren(span)
      if (children.length > 0 && expanded.has(id)) {
        const ownDuration = span.duration || parseTime(span.endTime) - parseTime(span.startTime)
        walk(children, depth + 1, [...parents, id], ownDuration)
      }
    }
  }
  walk(spans, 0, [], undefined)
  return out
}

/**
 * Returns every descendant span id in the tree.
 */
function collectAllIds(spans: TraceSpan[]): string[] {
  const out: string[] = []
  const walk = (list: TraceSpan[]) => {
    for (const span of list) {
      out.push(getSpanId(span))
      const children = getDisplayChildren(span)
      if (children.length > 0) walk(children)
    }
  }
  walk(spans)
  return out
}

/**
 * Finds the leaf-most errored span — the actual error source rather than a
 * parent span that has its status propagated up from a child. When an errored
 * span has errored children, we recurse into those children first; we only
 * return the current span if none of its descendants are also errored.
 */
function findLeafErrorSpan(spans: TraceSpan[]): TraceSpan | null {
  for (const span of spans) {
    if (span.status === 'error') {
      const children = getDisplayChildren(span)
      const childError = findLeafErrorSpan(children)
      return childError ?? span
    }
    const children = getDisplayChildren(span)
    if (children.length > 0) {
      const found = findLeafErrorSpan(children)
      if (found) return found
    }
  }
  return null
}

/**
 * Finds a span by id anywhere in the tree.
 */
function findSpan(spans: TraceSpan[], id: string | null): TraceSpan | null {
  if (!id) return null
  for (const span of spans) {
    if (getSpanId(span) === id) return span
    const children = getDisplayChildren(span)
    if (children.length > 0) {
      const found = findSpan(children, id)
      if (found) return found
    }
  }
  return null
}

/**
 * Case-insensitive name match.
 */
function spanMatchesQuery(span: TraceSpan, query: string): boolean {
  if (!query) return true
  return (span.name ?? '').toLowerCase().includes(query.toLowerCase())
}

/**
 * Returns the set of ids of spans that match the query themselves or contain
 * a matching descendant. Used to show only relevant branches while preserving
 * their parents.
 */
function collectMatchingIds(spans: TraceSpan[], query: string): Set<string> {
  const matches = new Set<string>()
  const walk = (list: TraceSpan[]): boolean => {
    let anyMatch = false
    for (const span of list) {
      const id = getSpanId(span)
      const children = getDisplayChildren(span)
      const childMatch = children.length > 0 ? walk(children) : false
      const selfMatch = spanMatchesQuery(span, query)
      if (selfMatch || childMatch) {
        matches.add(id)
        anyMatch = true
      }
    }
    return anyMatch
  }
  walk(spans)
  return matches
}

/**
 * Row in the tree pane. Renders the span icon, name, duration, a hover tooltip
 * with timing context, and a Gantt-style mini timeline bar below the row so the
 * span's position within the run is visible at a glance. Clicking selects the
 * span; the chevron toggles expansion.
 */
const TraceTreeRow = memo(function TraceTreeRow({
  entry,
  isSelected,
  isExpanded,
  canExpand,
  onSelect,
  onToggleExpand,
  matchQuery,
  runStartMs,
  runTotalMs,
}: {
  entry: FlatSpanEntry
  isSelected: boolean
  isExpanded: boolean
  canExpand: boolean
  onSelect: (id: string) => void
  onToggleExpand: (id: string) => void
  matchQuery: string
  runStartMs: number
  runTotalMs: number
}) {
  const { span, depth, parentDuration } = entry
  const id = getSpanId(span)
  const startMs = parseTime(span.startTime)
  const endMs = parseTime(span.endTime)
  const duration = span.duration || endMs - startMs
  const isRootWorkflow = depth === 0 && span.type?.toLowerCase() === 'workflow'
  const hasError = isRootWorkflow ? hasUnhandledErrorInTree(span) : hasErrorInTree(span)
  const { icon: BlockIcon, bgColor } = getBlockAppearance(span.type, span.name, span.provider)
  const nameMatches = !!matchQuery && spanMatchesQuery(span, matchQuery)

  const offsetMs = runStartMs > 0 ? Math.max(0, startMs - runStartMs) : 0
  const offsetPct = runTotalMs > 0 ? Math.min(100 - MIN_BAR_PCT, (offsetMs / runTotalMs) * 100) : 0
  const rawDurationPct = runTotalMs > 0 ? (duration / runTotalMs) * 100 : 0
  const durationPct = Math.max(MIN_BAR_PCT, Math.min(100 - offsetPct, rawDurationPct))
  const pctOfTotal = runTotalMs > 0 ? (duration / runTotalMs) * 100 : null
  const pctOfParent =
    parentDuration && parentDuration > 0 ? (duration / parentDuration) * 100 : null

  return (
    <div
      className={cn(
        'group relative flex min-w-0 cursor-pointer flex-col transition-colors',
        isSelected ? 'bg-[var(--surface-3)]' : 'hover-hover:bg-[var(--surface-2)]'
      )}
      onClick={() => onSelect(id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(id)
        }
      }}
      role='treeitem'
      tabIndex={isSelected ? 0 : -1}
      aria-selected={isSelected}
      aria-expanded={canExpand ? isExpanded : undefined}
      aria-level={depth + 1}
      data-span-id={id}
    >
      <div
        className='flex min-w-0 items-center gap-1.5 pt-1 pr-3.5'
        style={{ paddingLeft: ROW_BASE_PADDING_LEFT + depth * INDENT_PX }}
      >
        {canExpand ? (
          <Button
            type='button'
            variant='ghost'
            className='h-[14px] w-[14px] flex-shrink-0 p-0 text-[var(--text-tertiary)] hover-hover:bg-[var(--surface-4)] hover-hover:text-[var(--text-primary)]'
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand(id)
            }}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            <ChevronDown
              className={cn(
                'h-[10px] w-[10px] transition-transform duration-100',
                !isExpanded && '-rotate-90'
              )}
            />
          </Button>
        ) : (
          <div className='h-[14px] w-[14px] flex-shrink-0' />
        )}
        {!isIterationType(span.type) && (
          <div
            className='flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center overflow-hidden rounded-sm'
            style={{ background: bgColor }}
          >
            {BlockIcon && (
              <BlockIcon className={cn('h-[10px] w-[10px]', iconColorClass(bgColor))} />
            )}
          </div>
        )}
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <span
              className={cn(
                'min-w-0 flex-1 truncate font-medium text-caption',
                hasError ? 'text-[var(--text-error)]' : 'text-[var(--text-secondary)]',
                nameMatches && 'text-[var(--text-primary)]'
              )}
            >
              {span.name}
            </span>
          </Tooltip.Trigger>
          <Tooltip.Content side='right' className='max-w-[320px]'>
            <div className='flex flex-col gap-0.5'>
              <span className='font-medium'>{span.name}</span>
              <span className='text-[var(--text-tertiary)] text-caption'>
                {formatDuration(duration, { precision: 2 }) || '—'}
                {offsetMs > 0 && ` · +${formatDuration(offsetMs, { precision: 2 })}`}
              </span>
              {pctOfTotal !== null && pctOfTotal >= 0.1 && (
                <span className='text-[var(--text-tertiary)] text-caption'>
                  {pctOfTotal.toFixed(pctOfTotal >= 10 ? 0 : 1)}% of total
                  {pctOfParent !== null &&
                    pctOfParent >= 0.1 &&
                    ` · ${pctOfParent.toFixed(pctOfParent >= 10 ? 0 : 1)}% of parent`}
                </span>
              )}
            </div>
          </Tooltip.Content>
        </Tooltip.Root>
        <span className='flex-shrink-0 font-medium text-[var(--text-tertiary)] text-caption tabular-nums'>
          {formatDuration(duration, { precision: 2 })}
        </span>
      </div>
      <div className='pt-[3px] pr-3.5 pb-[5px] pl-[14px]'>
        <div className='relative h-[3px] w-full overflow-hidden rounded-full bg-[var(--border)]'>
          <div
            className='absolute h-full rounded-full'
            style={{
              left: `${offsetPct}%`,
              width: `${durationPct}%`,
              backgroundColor: hasError ? 'var(--text-error)' : bgColor,
            }}
          />
        </div>
      </div>
    </div>
  )
})

/**
 * Collapsible code viewer with copy/search overlay, used for input/output/thinking/
 * tool-call/error blobs in the detail pane.
 */
function DetailCodeSection({
  label,
  data,
  isError,
  defaultOpen = true,
}: {
  label: string
  data: unknown
  isError?: boolean
  defaultOpen?: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false)
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })
  const [copied, setCopied] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const {
    isSearchActive,
    searchQuery,
    setSearchQuery,
    matchCount,
    currentMatchIndex,
    activateSearch,
    closeSearch,
    goToNextMatch,
    goToPreviousMatch,
    handleMatchCountChange,
    searchInputRef,
  } = useCodeViewerFeatures({ contentRef })

  const jsonString = useMemo(() => {
    if (data == null) return ''
    if (typeof data === 'string') return data
    return JSON.stringify(data, null, 2)
  }, [data])

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
    setIsContextMenuOpen(true)
  }

  function handleCopy() {
    navigator.clipboard.writeText(jsonString)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
    setIsContextMenuOpen(false)
  }

  function handleSearch() {
    activateSearch()
    setIsContextMenuOpen(false)
  }

  return (
    <div className='relative flex min-w-0 flex-col gap-1.5'>
      <div
        className='group flex cursor-pointer items-center justify-between'
        onClick={() => setIsOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setIsOpen((v) => !v)
          }
        }}
        role='button'
        tabIndex={0}
        aria-expanded={isOpen}
      >
        <span
          className={cn(
            'font-medium text-caption transition-colors',
            isError
              ? 'text-[var(--text-error)]'
              : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]'
          )}
        >
          {label}
        </span>
        <ChevronDown
          className={cn(
            'h-[8px] w-[8px] text-[var(--text-tertiary)] transition-colors transition-transform duration-100 group-hover:text-[var(--text-primary)]',
            !isOpen && '-rotate-90'
          )}
        />
      </div>
      {isOpen && (
        <>
          <div ref={contentRef} onContextMenu={handleContextMenu} className='relative'>
            <Code.Viewer
              code={jsonString}
              language='json'
              className='!bg-[var(--surface-4)] dark:!bg-[var(--surface-3)] max-w-full rounded-md border-0 [word-break:break-all]'
              wrapText
              searchQuery={isSearchActive ? searchQuery : undefined}
              currentMatchIndex={currentMatchIndex}
              onMatchCountChange={handleMatchCountChange}
            />
            {!isSearchActive && (
              <div className='absolute top-[7px] right-[6px] z-10 flex gap-1'>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      type='button'
                      variant='default'
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCopy()
                      }}
                      className='h-[20px] w-[20px] cursor-pointer border border-[var(--border-1)] bg-transparent p-0 backdrop-blur-sm hover-hover:bg-[var(--surface-3)]'
                    >
                      {copied ? (
                        <Check className='h-[10px] w-[10px] text-[var(--text-success)]' />
                      ) : (
                        <Clipboard className='h-[10px] w-[10px]' />
                      )}
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>{copied ? 'Copied' : 'Copy'}</Tooltip.Content>
                </Tooltip.Root>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      type='button'
                      variant='default'
                      onClick={(e) => {
                        e.stopPropagation()
                        activateSearch()
                      }}
                      className='h-[20px] w-[20px] cursor-pointer border border-[var(--border-1)] bg-transparent p-0 backdrop-blur-sm hover-hover:bg-[var(--surface-3)]'
                    >
                      <Search className='h-[10px] w-[10px]' />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>Search</Tooltip.Content>
                </Tooltip.Root>
              </div>
            )}
          </div>
          {isSearchActive && (
            <div
              className='absolute top-0 right-0 z-30 flex h-[34px] items-center gap-1.5 rounded-sm border border-[var(--border)] bg-[var(--surface-1)] px-1.5 shadow-sm'
              onClick={(e) => e.stopPropagation()}
            >
              <Input
                ref={searchInputRef}
                type='text'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder='Search...'
                className='mr-0.5 h-[23px] w-[94px] text-caption'
              />
              <span
                className={cn(
                  'min-w-[45px] text-center text-xs',
                  matchCount > 0 ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]'
                )}
              >
                {matchCount > 0 ? `${currentMatchIndex + 1}/${matchCount}` : '0/0'}
              </span>
              <Button
                variant='ghost'
                className='!p-1'
                onClick={goToPreviousMatch}
                disabled={matchCount === 0}
                aria-label='Previous match'
              >
                <ArrowUp className='h-[12px] w-[12px]' />
              </Button>
              <Button
                variant='ghost'
                className='!p-1'
                onClick={goToNextMatch}
                disabled={matchCount === 0}
                aria-label='Next match'
              >
                <ArrowDown className='h-[12px] w-[12px]' />
              </Button>
              <Button
                variant='ghost'
                className='!p-1'
                onClick={closeSearch}
                aria-label='Close search'
              >
                <X className='h-[12px] w-[12px]' />
              </Button>
            </div>
          )}
          {typeof document !== 'undefined' &&
            createPortal(
              <DropdownMenu
                open={isContextMenuOpen}
                onOpenChange={() => setIsContextMenuOpen(false)}
                modal={false}
              >
                <DropdownMenuTrigger asChild>
                  <div
                    style={{
                      position: 'fixed',
                      left: `${contextMenuPosition.x}px`,
                      top: `${contextMenuPosition.y}px`,
                      width: '1px',
                      height: '1px',
                      pointerEvents: 'none',
                    }}
                    tabIndex={-1}
                    aria-hidden
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align='start'
                  side='bottom'
                  sideOffset={4}
                  onCloseAutoFocus={(e) => e.preventDefault()}
                >
                  <DropdownMenuItem onSelect={handleCopy}>
                    <CopyIcon />
                    Copy
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={handleSearch}>
                    <SearchIcon />
                    Search
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>,
              document.body
            )}
        </>
      )}
    </div>
  )
}

/**
 * A single label:value row in the metadata block of the detail pane.
 */
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-center justify-between gap-2 font-medium text-caption'>
      <span className='flex-shrink-0 text-[var(--text-tertiary)]'>{label}</span>
      <span className='min-w-0 truncate text-right text-[var(--text-secondary)]'>{value}</span>
    </div>
  )
}

/**
 * Right-side pane. Renders a header and the available content sections for
 * the selected span: metadata, input, output, thinking, tool calls, error.
 */
const TraceDetailPane = memo(function TraceDetailPane({ span }: { span: TraceSpan | null }) {
  if (!span) {
    return (
      <div className='flex h-full items-center justify-center p-6 text-[var(--text-tertiary)] text-caption'>
        Select a span to see details.
      </div>
    )
  }

  const duration = span.duration || parseTime(span.endTime) - parseTime(span.startTime)
  const { icon: BlockIcon, bgColor } = getBlockAppearance(span.type, span.name, span.provider)
  const isRootWorkflow = span.type?.toLowerCase() === 'workflow'
  const hasError = isRootWorkflow ? hasUnhandledErrorInTree(span) : hasErrorInTree(span)
  const isDirectError = span.status === 'error'
  const isModelSpan = span.type?.toLowerCase() === 'model'

  const startedAt = parseTime(span.startTime)
  const endedAt = parseTime(span.endTime)

  const metaEntries: { label: string; value: string }[] = []
  metaEntries.push({ label: 'Type', value: span.type })
  metaEntries.push({ label: 'Duration', value: formatDuration(duration, { precision: 2 }) || '—' })
  if (span.provider) metaEntries.push({ label: 'Provider', value: span.provider })
  if (span.model) metaEntries.push({ label: 'Model', value: span.model })
  if (span.finishReason) metaEntries.push({ label: 'Finish reason', value: span.finishReason })
  const ttftFormatted = formatTtft(span.ttft)
  if (ttftFormatted) metaEntries.push({ label: 'TTFT', value: ttftFormatted })
  const tpsFormatted = isModelSpan ? formatTps(span.tokens?.output, duration) : undefined
  if (tpsFormatted) metaEntries.push({ label: 'Throughput', value: tpsFormatted })
  const inputTokens = formatTokenCount(span.tokens?.input)
  const outputTokens = formatTokenCount(span.tokens?.output)
  const totalTokens = formatTokenCount(span.tokens?.total)
  const cacheRead = formatTokenCount(span.tokens?.cacheRead)
  const cacheWrite = formatTokenCount(span.tokens?.cacheWrite)
  const reasoning = formatTokenCount(span.tokens?.reasoning)
  if (inputTokens) metaEntries.push({ label: 'Input tokens', value: inputTokens })
  if (outputTokens) metaEntries.push({ label: 'Output tokens', value: outputTokens })
  if (totalTokens) metaEntries.push({ label: 'Total tokens', value: totalTokens })
  if (cacheRead) metaEntries.push({ label: 'Cache read', value: cacheRead })
  if (cacheWrite) metaEntries.push({ label: 'Cache write', value: cacheWrite })
  if (reasoning) metaEntries.push({ label: 'Reasoning tokens', value: reasoning })
  const costTotal = formatCostAmount(span.cost?.total)
  if (costTotal) metaEntries.push({ label: 'Cost', value: costTotal })
  if (span.errorType) metaEntries.push({ label: 'Error type', value: span.errorType })
  if (span.iterationIndex !== undefined)
    metaEntries.push({ label: 'Iteration', value: String(span.iterationIndex + 1) })

  const statusLabel = hasError ? 'Error' : 'Success'

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3.5 pt-3 pb-4'>
      <div className='flex items-start gap-2'>
        {!isIterationType(span.type) && (
          <div
            className='mt-[2px] flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-sm'
            style={{ background: bgColor }}
          >
            {BlockIcon && (
              <BlockIcon className={cn('h-[12px] w-[12px]', iconColorClass(bgColor))} />
            )}
          </div>
        )}
        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <h3
            className={cn(
              'min-w-0 truncate font-medium text-sm',
              hasError ? 'text-[var(--text-error)]' : 'text-[var(--text-primary)]'
            )}
          >
            {span.name}
          </h3>
          <div className='flex items-center gap-1.5 font-medium text-[var(--text-tertiary)] text-caption'>
            <Badge variant={hasError ? 'red' : 'green'} size='sm'>
              {statusLabel}
            </Badge>
            <span>·</span>
            <span>{formatDuration(duration, { precision: 2 }) || '—'}</span>
            {Number.isFinite(startedAt) && startedAt > 0 && (
              <>
                <span>·</span>
                <span title={new Date(startedAt).toISOString()}>
                  {new Date(startedAt).toLocaleTimeString()}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {metaEntries.length > 0 && (
        <div className='flex flex-col gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 dark:bg-transparent'>
          {metaEntries.map((m) => (
            <MetaRow key={m.label} label={m.label} value={m.value} />
          ))}
        </div>
      )}

      {/* Keys by label: without them, React reused a single DetailCodeSection
          across span changes and carried isOpen between sections with different
          labels — a collapsed Output on one span appeared as a collapsed Input
          on the next. */}
      {span.input !== undefined && span.input !== null && (
        <DetailCodeSection key='input' label='Input' data={span.input} />
      )}
      {span.output !== undefined && span.output !== null && (
        <DetailCodeSection
          key={isDirectError ? 'error' : 'output'}
          label={isDirectError ? 'Error' : 'Output'}
          data={span.output}
          isError={isDirectError}
        />
      )}
      {span.thinking && <DetailCodeSection key='thinking' label='Thinking' data={span.thinking} />}
      {span.modelToolCalls && span.modelToolCalls.length > 0 && (
        <DetailCodeSection key='tool-calls' label='Tool calls' data={span.modelToolCalls} />
      )}
      {span.errorMessage && (
        <DetailCodeSection
          key='error-message'
          label='Error message'
          data={span.errorMessage}
          isError
        />
      )}

      {Number.isFinite(startedAt) && Number.isFinite(endedAt) && startedAt > 0 && endedAt > 0 && (
        <div className='flex items-center justify-between font-medium text-[var(--text-tertiary)] text-caption'>
          <span title={new Date(startedAt).toISOString()}>
            Started {new Date(startedAt).toLocaleTimeString()}
          </span>
          <span title={new Date(endedAt).toISOString()}>
            Ended {new Date(endedAt).toLocaleTimeString()}
          </span>
        </div>
      )}
    </div>
  )
})

/**
 * Rich two-pane trace view: hierarchical span tree on the left with
 * keyboard-navigable selection, detail pane on the right. Renders the run
 * in a way that mirrors the executor's internal structure so investigators can
 * follow block-by-block and segment-by-segment what happened and why.
 */
export const TraceView = memo(function TraceView({ traceSpans }: TraceViewProps) {
  const treeRef = useRef<HTMLDivElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [treePaneWidth, setTreePaneWidth] = useState(DEFAULT_TREE_PANE_WIDTH)
  const treePaneWidthRef = useRef(DEFAULT_TREE_PANE_WIDTH)
  treePaneWidthRef.current = treePaneWidth
  const isResizingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return
      const delta = e.clientX - startXRef.current
      setTreePaneWidth(
        Math.max(MIN_TREE_PANE_WIDTH, Math.min(MAX_TREE_PANE_WIDTH, startWidthRef.current + delta))
      )
    }
    const handleMouseUp = () => {
      if (!isResizingRef.current) return
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const {
    normalizedSpans,
    allIds,
    totalDuration,
    runStartMs,
    firstRootId,
    firstErrorId,
    blockCount,
  } = useMemo(() => {
    const sorted = normalizeAndSort(traceSpans ?? [])
    let earliest = Number.POSITIVE_INFINITY
    let latest = 0
    const walkTimeBounds = (spans: TraceSpan[]) => {
      for (const span of spans) {
        const s = parseTime(span.startTime)
        const e = parseTime(span.endTime)
        if (s < earliest) earliest = s
        if (e > latest) latest = e
        if (span.children?.length) walkTimeBounds(span.children)
      }
    }
    walkTimeBounds(sorted)
    const ids = collectAllIds(sorted)
    const count = ids.length
    const runStart = earliest !== Number.POSITIVE_INFINITY ? earliest : 0
    const firstError = findLeafErrorSpan(sorted)
    return {
      normalizedSpans: sorted,
      allIds: ids,
      totalDuration: latest > runStart ? latest - runStart : 0,
      runStartMs: runStart,
      firstRootId: sorted.length > 0 ? getSpanId(sorted[0]) : null,
      firstErrorId: firstError ? getSpanId(firstError) : null,
      blockCount: count,
    }
  }, [traceSpans])

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set(allIds))
  const [selectedId, setSelectedId] = useState<string | null>(firstErrorId ?? firstRootId)
  const [prevAllIds, setPrevAllIds] = useState(allIds)
  if (prevAllIds !== allIds) {
    setPrevAllIds(allIds)
    setExpandedNodes(new Set(allIds))
    setSelectedId(firstErrorId ?? firstRootId)
  }

  const matchingIds = useMemo(
    () => (searchQuery ? collectMatchingIds(normalizedSpans, searchQuery) : null),
    [normalizedSpans, searchQuery]
  )

  const flatList = useMemo(() => {
    const visible = flattenVisible(normalizedSpans, expandedNodes)
    if (!matchingIds) return visible
    return visible.filter((entry) => matchingIds.has(getSpanId(entry.span)))
  }, [normalizedSpans, expandedNodes, matchingIds])

  const selectedSpan = useMemo(
    () => findSpan(normalizedSpans, selectedId),
    [normalizedSpans, selectedId]
  )

  const runStatus =
    normalizedSpans.length === 0
      ? ('empty' as const)
      : normalizedSpans.some((span) =>
            span.type?.toLowerCase() === 'workflow'
              ? hasUnhandledErrorInTree(span)
              : hasErrorInTree(span)
          )
        ? ('error' as const)
        : ('success' as const)

  const handleSelect = useCallback((id: string) => setSelectedId(id), [])

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore while typing in inputs / contentEditable (filter box, etc.).
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      if (!selectedId) return
      const currentIndex = flatList.findIndex((entry) => getSpanId(entry.span) === selectedId)
      if (currentIndex === -1) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = flatList[Math.min(flatList.length - 1, currentIndex + 1)]
        if (next) setSelectedId(getSpanId(next.span))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const prev = flatList[Math.max(0, currentIndex - 1)]
        if (prev) setSelectedId(getSpanId(prev.span))
      } else if (e.key === 'ArrowLeft') {
        const entry = flatList[currentIndex]
        const span = entry.span
        const id = getSpanId(span)
        const canExpand = getDisplayChildren(span).length > 0
        if (canExpand && expandedNodes.has(id)) {
          e.preventDefault()
          handleToggleExpand(id)
        } else if (entry.parentIds.length > 0) {
          e.preventDefault()
          const parentId = entry.parentIds[entry.parentIds.length - 1]
          setSelectedId(parentId)
        }
      } else if (e.key === 'ArrowRight') {
        const entry = flatList[currentIndex]
        const span = entry.span
        const id = getSpanId(span)
        const canExpand = getDisplayChildren(span).length > 0
        if (canExpand && !expandedNodes.has(id)) {
          e.preventDefault()
          handleToggleExpand(id)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [flatList, selectedId, expandedNodes, handleToggleExpand])

  useEffect(() => {
    if (!selectedId || !treeRef.current) return
    const row = treeRef.current.querySelector<HTMLElement>(
      `[data-span-id="${CSS.escape(selectedId)}"]`
    )
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  if (!traceSpans || traceSpans.length === 0) {
    return (
      <div className='flex h-full items-center justify-center text-[var(--text-tertiary)] text-caption'>
        No trace data available
      </div>
    )
  }

  return (
    <div className='-mx-3.5 flex h-full min-h-0 flex-col'>
      {/* Header strip */}
      <div className='flex items-center gap-2 border-[var(--border)] border-b px-3.5 pb-2'>
        <Badge
          variant={runStatus === 'error' ? 'red' : 'green'}
          size='sm'
          className='flex-shrink-0'
        >
          {runStatus === 'error' ? 'Error' : 'Success'}
        </Badge>
        {firstErrorId && (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => setSelectedId(firstErrorId)}
          >
            Jump to error
          </Button>
        )}
        <span className='flex-shrink-0 font-medium text-[var(--text-secondary)] text-caption tabular-nums'>
          {formatDuration(totalDuration, { precision: 2 }) || '—'}
        </span>
        <span className='flex-shrink-0 font-medium text-[var(--text-tertiary)] text-caption'>
          {blockCount} {blockCount === 1 ? 'span' : 'spans'}
        </span>
        {(() => {
          const rootCost = formatCostAmount(normalizedSpans[0]?.cost?.total)
          return rootCost ? (
            <span className='flex-shrink-0 font-medium text-[var(--text-tertiary)] text-caption tabular-nums'>
              {rootCost}
            </span>
          ) : null
        })()}
        <div className='ml-auto flex items-center gap-1'>
          <div className='relative'>
            <Search className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-[7px] h-[11px] w-[11px] text-[var(--text-tertiary)]' />
            <Input
              type='text'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder='Filter spans'
              className='h-[24px] w-[140px] pl-[22px] text-caption'
            />
          </div>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                type='button'
                variant='ghost'
                className='!p-1'
                onClick={() => setExpandedNodes(new Set(allIds))}
                aria-label='Expand all'
              >
                <ChevronsUpDown className='h-[12px] w-[12px]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>Expand all</Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                type='button'
                variant='ghost'
                className='!p-1'
                onClick={() => setExpandedNodes(new Set())}
                aria-label='Collapse all'
              >
                <ChevronsDownUp className='h-[12px] w-[12px]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>Collapse all</Tooltip.Content>
          </Tooltip.Root>
        </div>
      </div>

      {/* Tree + detail split */}
      <div className='flex min-h-0 flex-1'>
        <div
          ref={treeRef}
          className='flex flex-shrink-0 flex-col overflow-y-auto pt-2'
          style={{ width: treePaneWidth }}
          role='tree'
        >
          {flatList.length === 0 && (
            <div className='p-3 text-[var(--text-tertiary)] text-caption'>No matching spans</div>
          )}
          {flatList.map((entry) => {
            const id = getSpanId(entry.span)
            const canExpand = getDisplayChildren(entry.span).length > 0
            return (
              <TraceTreeRow
                key={id}
                entry={entry}
                isSelected={id === selectedId}
                isExpanded={expandedNodes.has(id)}
                canExpand={canExpand}
                onSelect={handleSelect}
                onToggleExpand={handleToggleExpand}
                matchQuery={searchQuery}
                runStartMs={runStartMs}
                runTotalMs={totalDuration}
              />
            )
          })}
        </div>
        {/* Resize handle */}
        <div
          className='relative w-px flex-shrink-0 cursor-ew-resize bg-[var(--border)] transition-colors hover-hover:bg-[var(--border-1)]'
          onMouseDown={(e) => {
            isResizingRef.current = true
            startXRef.current = e.clientX
            startWidthRef.current = treePaneWidthRef.current
            document.body.style.cursor = 'ew-resize'
            document.body.style.userSelect = 'none'
          }}
        >
          <div className='-left-1 -right-1 absolute inset-y-0' />
        </div>
        <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
          <TraceDetailPane span={selectedSpan} />
        </div>
      </div>
    </div>
  )
})
