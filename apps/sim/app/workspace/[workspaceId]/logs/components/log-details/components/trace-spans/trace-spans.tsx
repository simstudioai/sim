'use client'

import type React from 'react'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  Button,
  ChevronDown,
  Code,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'
import { WorkflowIcon } from '@/components/icons'
import { cn } from '@/lib/core/utils/cn'
import { LoopTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/loop/loop-config'
import { ParallelTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/parallel/parallel-config'
import { getBlock, getBlockByToolName } from '@/blocks'
import { useCodeViewerFeatures } from '@/hooks/use-code-viewer'
import type { TraceSpan } from '@/stores/logs/filters/types'

interface TraceSpansProps {
  traceSpans?: TraceSpan[]
  totalDuration?: number
}

/**
 * Checks if a span type is a loop or parallel iteration
 */
function isIterationType(type: string): boolean {
  const lower = type?.toLowerCase() || ''
  return lower === 'loop-iteration' || lower === 'parallel-iteration'
}

/**
 * Creates a toggle handler for Set-based state
 */
function useSetToggle() {
  return useCallback(
    <T extends string>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, key: T) => {
      setter((prev) => {
        const next = new Set(prev)
        if (next.has(key)) {
          next.delete(key)
        } else {
          next.add(key)
        }
        return next
      })
    },
    []
  )
}

/**
 * Generates a unique key for a trace span
 */
function getSpanKey(span: TraceSpan): string {
  if (span.id) {
    return span.id
  }
  const name = span.name || 'span'
  const start = span.startTime || 'unknown-start'
  const end = span.endTime || 'unknown-end'
  return `${name}|${start}|${end}`
}

/**
 * Merges multiple arrays of trace span children, deduplicating by span key
 */
function mergeTraceSpanChildren(...groups: TraceSpan[][]): TraceSpan[] {
  const merged: TraceSpan[] = []
  const seen = new Set<string>()

  groups.forEach((group) => {
    group.forEach((child) => {
      const key = getSpanKey(child)
      if (seen.has(key)) {
        return
      }
      seen.add(key)
      merged.push(child)
    })
  })

  return merged
}

/**
 * Parses a time value to milliseconds
 */
function parseTime(value?: string | number | null): number {
  if (!value) return 0
  const ms = typeof value === 'number' ? value : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/**
 * Normalizes and sorts trace spans recursively.
 * Merges children from both span.children and span.output.childTraceSpans,
 * deduplicates them, and sorts by start time.
 */
function normalizeAndSortSpans(spans: TraceSpan[]): TraceSpan[] {
  return spans
    .map((span) => {
      const enrichedSpan: TraceSpan = { ...span }

      // Clean output by removing childTraceSpans after extracting
      if (enrichedSpan.output && typeof enrichedSpan.output === 'object') {
        enrichedSpan.output = { ...enrichedSpan.output }
        if ('childTraceSpans' in enrichedSpan.output) {
          const { childTraceSpans, ...cleanOutput } = enrichedSpan.output as {
            childTraceSpans?: TraceSpan[]
          } & Record<string, unknown>
          enrichedSpan.output = cleanOutput
        }
      }

      // Merge and deduplicate children from both sources
      const directChildren = Array.isArray(span.children) ? span.children : []
      const outputChildren = Array.isArray(span.output?.childTraceSpans)
        ? (span.output!.childTraceSpans as TraceSpan[])
        : []

      const mergedChildren = mergeTraceSpanChildren(directChildren, outputChildren)
      enrichedSpan.children =
        mergedChildren.length > 0 ? normalizeAndSortSpans(mergedChildren) : undefined

      return enrichedSpan
    })
    .sort((a, b) => {
      const startDiff = parseTime(a.startTime) - parseTime(b.startTime)
      if (startDiff !== 0) return startDiff
      return parseTime(a.endTime) - parseTime(b.endTime)
    })
}

const DEFAULT_BLOCK_COLOR = '#6b7280'

/**
 * Formats duration in ms
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/**
 * Gets icon and color for a span type using block config
 */
function getBlockIconAndColor(
  type: string,
  toolName?: string
): {
  icon: React.ComponentType<{ className?: string }> | null
  bgColor: string
} {
  const lowerType = type.toLowerCase()

  // Check for tool by name first (most specific)
  if (lowerType === 'tool' && toolName) {
    const toolBlock = getBlockByToolName(toolName)
    if (toolBlock) {
      return { icon: toolBlock.icon, bgColor: toolBlock.bgColor }
    }
  }

  // Special types not in block registry
  if (lowerType === 'loop' || lowerType === 'loop-iteration') {
    return { icon: LoopTool.icon, bgColor: LoopTool.bgColor }
  }
  if (lowerType === 'parallel' || lowerType === 'parallel-iteration') {
    return { icon: ParallelTool.icon, bgColor: ParallelTool.bgColor }
  }
  if (lowerType === 'workflow') {
    return { icon: WorkflowIcon, bgColor: '#6366F1' }
  }

  // Look up from block registry (model maps to agent)
  const blockType = lowerType === 'model' ? 'agent' : lowerType
  const blockConfig = getBlock(blockType)
  if (blockConfig) {
    return { icon: blockConfig.icon, bgColor: blockConfig.bgColor }
  }

  return { icon: null, bgColor: DEFAULT_BLOCK_COLOR }
}

/**
 * Renders the progress bar showing execution timeline
 */
function ProgressBar({
  span,
  childSpans,
  workflowStartTime,
  totalDuration,
}: {
  span: TraceSpan
  childSpans?: TraceSpan[]
  workflowStartTime: number
  totalDuration: number
}) {
  const segments = useMemo(() => {
    const computeSegment = (s: TraceSpan) => {
      const startMs = new Date(s.startTime).getTime()
      const endMs = new Date(s.endTime).getTime()
      const duration = endMs - startMs
      const startPercent =
        totalDuration > 0 ? ((startMs - workflowStartTime) / totalDuration) * 100 : 0
      const widthPercent = totalDuration > 0 ? (duration / totalDuration) * 100 : 0
      const { bgColor } = getBlockIconAndColor(s.type, s.name)

      return {
        startPercent: Math.max(0, Math.min(100, startPercent)),
        widthPercent: Math.max(0.5, Math.min(100, widthPercent)),
        color: bgColor,
      }
    }

    if (!childSpans || childSpans.length === 0) {
      return [computeSegment(span)]
    }

    return childSpans.map(computeSegment)
  }, [span, childSpans, workflowStartTime, totalDuration])

  return (
    <div className='relative mb-[8px] h-[5px] w-full overflow-hidden rounded-[18px] bg-[var(--divider)]'>
      {segments.map((segment, index) => (
        <div
          key={index}
          className='absolute h-full'
          style={{
            left: `${segment.startPercent}%`,
            width: `${segment.widthPercent}%`,
            backgroundColor: segment.color,
          }}
        />
      ))}
    </div>
  )
}

interface ExpandableRowHeaderProps {
  name: string
  duration: number
  isError: boolean
  isExpanded: boolean
  hasChildren: boolean
  showIcon: boolean
  icon: React.ComponentType<{ className?: string }> | null
  bgColor: string
  onToggle: () => void
}

/**
 * Reusable expandable row header with chevron, icon, name, and duration
 */
function ExpandableRowHeader({
  name,
  duration,
  isError,
  isExpanded,
  hasChildren,
  showIcon,
  icon: Icon,
  bgColor,
  onToggle,
}: ExpandableRowHeaderProps) {
  return (
    <div
      className={clsx('group flex items-center justify-between', hasChildren && 'cursor-pointer')}
      onClick={hasChildren ? onToggle : undefined}
      onKeyDown={
        hasChildren
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onToggle()
              }
            }
          : undefined
      }
      role={hasChildren ? 'button' : undefined}
      tabIndex={hasChildren ? 0 : undefined}
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-label={hasChildren ? (isExpanded ? 'Collapse' : 'Expand') : undefined}
    >
      <div className='flex items-center gap-[8px]'>
        {hasChildren && (
          <ChevronDown
            className='h-[10px] w-[10px] flex-shrink-0 text-[var(--text-tertiary)] transition-transform duration-100 group-hover:text-[var(--text-primary)]'
            style={{ transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
          />
        )}
        {showIcon && (
          <div
            className='relative flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
            style={{ background: bgColor }}
          >
            {Icon && <Icon className={clsx('text-white', '!h-[9px] !w-[9px]')} />}
          </div>
        )}
        <span
          className='font-medium text-[12px]'
          style={{ color: isError ? 'var(--text-error)' : 'var(--text-secondary)' }}
        >
          {name}
        </span>
      </div>
      <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>
        {formatDuration(duration)}
      </span>
    </div>
  )
}

interface SpanContentProps {
  span: TraceSpan
  spanId: string
  isError: boolean
  workflowStartTime: number
  totalDuration: number
  expandedSections: Set<string>
  onToggle: (section: string) => void
}

/**
 * Reusable component for rendering span content (progress bar + input/output sections)
 */
function SpanContent({
  span,
  spanId,
  isError,
  workflowStartTime,
  totalDuration,
  expandedSections,
  onToggle,
}: SpanContentProps) {
  const hasInput = Boolean(span.input)
  const hasOutput = Boolean(span.output)

  return (
    <>
      <ProgressBar
        span={span}
        childSpans={span.children}
        workflowStartTime={workflowStartTime}
        totalDuration={totalDuration}
      />

      {hasInput && (
        <InputOutputSection
          label='Input'
          data={span.input}
          isError={false}
          spanId={spanId}
          sectionType='input'
          expandedSections={expandedSections}
          onToggle={onToggle}
        />
      )}

      {hasInput && hasOutput && <div className='border-[var(--border)] border-t border-dashed' />}

      {hasOutput && (
        <InputOutputSection
          label={isError ? 'Error' : 'Output'}
          data={span.output}
          isError={isError}
          spanId={spanId}
          sectionType='output'
          expandedSections={expandedSections}
          onToggle={onToggle}
        />
      )}
    </>
  )
}

/**
 * Renders input/output section with collapsible content, context menu, and search
 */
function InputOutputSection({
  label,
  data,
  isError,
  spanId,
  sectionType,
  expandedSections,
  onToggle,
}: {
  label: string
  data: unknown
  isError: boolean
  spanId: string
  sectionType: 'input' | 'output'
  expandedSections: Set<string>
  onToggle: (section: string) => void
}) {
  const sectionKey = `${spanId}-${sectionType}`
  const isExpanded = expandedSections.has(sectionKey)
  const contentRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Context menu state
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false)
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })

  // Code viewer features
  const {
    wrapText,
    toggleWrapText,
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
    if (!data) return ''
    return JSON.stringify(data, null, 2)
  }, [data])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
    setIsContextMenuOpen(true)
  }, [])

  const closeContextMenu = useCallback(() => {
    setIsContextMenuOpen(false)
  }, [])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(jsonString)
    closeContextMenu()
  }, [jsonString, closeContextMenu])

  const handleSearch = useCallback(() => {
    activateSearch()
    closeContextMenu()
  }, [activateSearch, closeContextMenu])

  const handleToggleWrap = useCallback(() => {
    toggleWrapText()
    closeContextMenu()
  }, [toggleWrapText, closeContextMenu])

  return (
    <div className='relative flex min-w-0 flex-col gap-[8px] overflow-hidden'>
      <div
        className='group flex cursor-pointer items-center justify-between'
        onClick={() => onToggle(sectionKey)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle(sectionKey)
          }
        }}
        role='button'
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${label.toLowerCase()}`}
      >
        <span
          className={clsx(
            'font-medium text-[12px] transition-colors',
            isError
              ? 'text-[var(--text-error)]'
              : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]'
          )}
        >
          {label}
        </span>
        <ChevronDown
          className={clsx(
            'h-[10px] w-[10px] text-[var(--text-tertiary)] transition-colors transition-transform group-hover:text-[var(--text-primary)]'
          )}
          style={{
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </div>
      {isExpanded && (
        <>
          <div ref={contentRef} onContextMenu={handleContextMenu}>
            <Code.Viewer
              code={jsonString}
              language='json'
              className='!bg-[var(--surface-3)] max-h-[300px] min-h-0 max-w-full rounded-[6px] border-0 [word-break:break-all]'
              wrapText={wrapText}
              searchQuery={isSearchActive ? searchQuery : undefined}
              currentMatchIndex={currentMatchIndex}
              onMatchCountChange={handleMatchCountChange}
            />
          </div>

          {/* Search Overlay */}
          {isSearchActive && (
            <div
              className='absolute top-0 right-0 z-30 flex h-[34px] items-center gap-[6px] rounded-[4px] border border-[var(--border)] bg-[var(--surface-1)] px-[6px] shadow-sm'
              onClick={(e) => e.stopPropagation()}
            >
              <Input
                ref={searchInputRef}
                type='text'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder='Search...'
                className='mr-[2px] h-[23px] w-[94px] text-[12px]'
              />
              <span
                className={cn(
                  'min-w-[45px] text-center text-[11px]',
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

          {/* Context Menu - rendered in portal to avoid transform/overflow clipping */}
          {typeof document !== 'undefined' &&
            createPortal(
              <Popover
                open={isContextMenuOpen}
                onOpenChange={closeContextMenu}
                variant='secondary'
                size='sm'
                colorScheme='inverted'
              >
                <PopoverAnchor
                  style={{
                    position: 'fixed',
                    left: `${contextMenuPosition.x}px`,
                    top: `${contextMenuPosition.y}px`,
                    width: '1px',
                    height: '1px',
                  }}
                />
                <PopoverContent ref={menuRef} align='start' side='bottom' sideOffset={4}>
                  <PopoverItem onClick={handleCopy}>Copy</PopoverItem>
                  <PopoverDivider />
                  <PopoverItem onClick={handleSearch}>Search</PopoverItem>
                  <PopoverItem showCheck={wrapText} onClick={handleToggleWrap}>
                    Wrap Text
                  </PopoverItem>
                </PopoverContent>
              </Popover>,
              document.body
            )}
        </>
      )}
    </div>
  )
}

interface NestedBlockItemProps {
  span: TraceSpan
  parentId: string
  index: number
  expandedSections: Set<string>
  onToggle: (section: string) => void
  workflowStartTime: number
  totalDuration: number
  expandedChildren: Set<string>
  onToggleChildren: (spanId: string) => void
}

/**
 * Recursive component for rendering nested blocks at any depth
 */
function NestedBlockItem({
  span,
  parentId,
  index,
  expandedSections,
  onToggle,
  workflowStartTime,
  totalDuration,
  expandedChildren,
  onToggleChildren,
}: NestedBlockItemProps): React.ReactNode {
  const spanId = span.id || `${parentId}-nested-${index}`
  const isError = span.status === 'error'
  const { icon: SpanIcon, bgColor } = getBlockIconAndColor(span.type, span.name)
  const hasChildren = Boolean(span.children && span.children.length > 0)
  const isChildrenExpanded = expandedChildren.has(spanId)

  return (
    <div className='flex min-w-0 flex-col gap-[8px] overflow-hidden'>
      <ExpandableRowHeader
        name={span.name}
        duration={span.duration || 0}
        isError={isError}
        isExpanded={isChildrenExpanded}
        hasChildren={hasChildren}
        showIcon={!isIterationType(span.type)}
        icon={SpanIcon}
        bgColor={bgColor}
        onToggle={() => onToggleChildren(spanId)}
      />

      <SpanContent
        span={span}
        spanId={spanId}
        isError={isError}
        workflowStartTime={workflowStartTime}
        totalDuration={totalDuration}
        expandedSections={expandedSections}
        onToggle={onToggle}
      />

      {/* Nested children */}
      {hasChildren && isChildrenExpanded && (
        <div className='mt-[2px] flex min-w-0 flex-col gap-[10px] overflow-hidden border-[var(--border)] border-l pl-[10px]'>
          {span.children!.map((child, childIndex) => (
            <NestedBlockItem
              key={child.id || `${spanId}-child-${childIndex}`}
              span={child}
              parentId={spanId}
              index={childIndex}
              expandedSections={expandedSections}
              onToggle={onToggle}
              workflowStartTime={workflowStartTime}
              totalDuration={totalDuration}
              expandedChildren={expandedChildren}
              onToggleChildren={onToggleChildren}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface TraceSpanItemProps {
  span: TraceSpan
  totalDuration: number
  workflowStartTime: number
  isFirstSpan?: boolean
}

/**
 * Individual trace span card component.
 * Memoized to prevent re-renders when sibling spans change.
 */
const TraceSpanItem = memo(function TraceSpanItem({
  span,
  totalDuration,
  workflowStartTime,
  isFirstSpan = false,
}: TraceSpanItemProps): React.ReactNode {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [expandedChildren, setExpandedChildren] = useState<Set<string>>(new Set())
  const [isCardExpanded, setIsCardExpanded] = useState(false)
  const toggleSet = useSetToggle()

  const spanId = span.id || `span-${span.name}-${span.startTime}`
  const spanStartTime = new Date(span.startTime).getTime()
  const spanEndTime = new Date(span.endTime).getTime()
  const duration = span.duration || spanEndTime - spanStartTime

  const hasChildren = Boolean(span.children && span.children.length > 0)
  const hasToolCalls = Boolean(span.toolCalls && span.toolCalls.length > 0)
  const isError = span.status === 'error'

  const inlineChildTypes = new Set([
    'tool',
    'model',
    'loop-iteration',
    'parallel-iteration',
    'workflow',
  ])

  // For workflow-in-workflow blocks, all children should be rendered inline/nested
  const isWorkflowBlock = span.type?.toLowerCase().includes('workflow')
  const inlineChildren = isWorkflowBlock
    ? span.children || []
    : span.children?.filter((child) => inlineChildTypes.has(child.type?.toLowerCase() || '')) || []
  const otherChildren = isWorkflowBlock
    ? []
    : span.children?.filter((child) => !inlineChildTypes.has(child.type?.toLowerCase() || '')) || []

  const toolCallSpans = useMemo(() => {
    if (!hasToolCalls) return []
    return span.toolCalls!.map((toolCall, index) => {
      const toolStartTime = toolCall.startTime
        ? new Date(toolCall.startTime).getTime()
        : spanStartTime
      const toolEndTime = toolCall.endTime
        ? new Date(toolCall.endTime).getTime()
        : toolStartTime + (toolCall.duration || 0)

      return {
        id: `${spanId}-tool-${index}`,
        name: toolCall.name,
        type: 'tool',
        duration: toolCall.duration || toolEndTime - toolStartTime,
        startTime: new Date(toolStartTime).toISOString(),
        endTime: new Date(toolEndTime).toISOString(),
        status: toolCall.error ? ('error' as const) : ('success' as const),
        input: toolCall.input,
        output: toolCall.error
          ? { error: toolCall.error, ...(toolCall.output || {}) }
          : toolCall.output,
      } as TraceSpan
    })
  }, [hasToolCalls, span.toolCalls, spanId, spanStartTime])

  const handleSectionToggle = useCallback(
    (section: string) => toggleSet(setExpandedSections, section),
    [toggleSet]
  )

  const handleChildrenToggle = useCallback(
    (childSpanId: string) => toggleSet(setExpandedChildren, childSpanId),
    [toggleSet]
  )

  const { icon: BlockIcon, bgColor } = getBlockIconAndColor(span.type, span.name)

  // Check if this card has expandable inline content
  const hasInlineContent =
    (isWorkflowBlock && inlineChildren.length > 0) ||
    (!isWorkflowBlock && (toolCallSpans.length > 0 || inlineChildren.length > 0))

  const isExpandable = !isFirstSpan && hasInlineContent

  return (
    <>
      <div className='flex min-w-0 flex-col gap-[8px] overflow-hidden rounded-[6px] bg-[var(--surface-1)] px-[10px] py-[8px]'>
        <ExpandableRowHeader
          name={span.name}
          duration={duration}
          isError={isError}
          isExpanded={isCardExpanded}
          hasChildren={isExpandable}
          showIcon={!isFirstSpan}
          icon={BlockIcon}
          bgColor={bgColor}
          onToggle={() => setIsCardExpanded((prev) => !prev)}
        />

        <SpanContent
          span={span}
          spanId={spanId}
          isError={isError}
          workflowStartTime={workflowStartTime}
          totalDuration={totalDuration}
          expandedSections={expandedSections}
          onToggle={handleSectionToggle}
        />

        {/* For workflow blocks, keep children nested within the card (not as separate cards) */}
        {!isFirstSpan && isWorkflowBlock && inlineChildren.length > 0 && isCardExpanded && (
          <div className='mt-[2px] flex min-w-0 flex-col gap-[10px] overflow-hidden border-[var(--border)] border-l pl-[10px]'>
            {inlineChildren.map((childSpan, index) => (
              <NestedBlockItem
                key={childSpan.id || `${spanId}-nested-${index}`}
                span={childSpan}
                parentId={spanId}
                index={index}
                expandedSections={expandedSections}
                onToggle={handleSectionToggle}
                workflowStartTime={workflowStartTime}
                totalDuration={totalDuration}
                expandedChildren={expandedChildren}
                onToggleChildren={handleChildrenToggle}
              />
            ))}
          </div>
        )}

        {/* For non-workflow blocks, render inline children/tool calls */}
        {!isFirstSpan && !isWorkflowBlock && isCardExpanded && (
          <div className='mt-[2px] flex min-w-0 flex-col gap-[10px] overflow-hidden border-[var(--border)] border-l pl-[10px]'>
            {[...toolCallSpans, ...inlineChildren].map((childSpan, index) => {
              const childId = childSpan.id || `${spanId}-inline-${index}`
              const childIsError = childSpan.status === 'error'
              const childLowerType = childSpan.type?.toLowerCase() || ''
              const hasNestedChildren = Boolean(childSpan.children && childSpan.children.length > 0)
              const isNestedExpanded = expandedChildren.has(childId)
              const showChildrenInProgressBar =
                isIterationType(childLowerType) || childLowerType === 'workflow'
              const { icon: ChildIcon, bgColor: childBgColor } = getBlockIconAndColor(
                childSpan.type,
                childSpan.name
              )

              return (
                <div
                  key={`inline-${childId}`}
                  className='flex min-w-0 flex-col gap-[8px] overflow-hidden'
                >
                  <ExpandableRowHeader
                    name={childSpan.name}
                    duration={childSpan.duration || 0}
                    isError={childIsError}
                    isExpanded={isNestedExpanded}
                    hasChildren={hasNestedChildren}
                    showIcon={!isIterationType(childSpan.type)}
                    icon={ChildIcon}
                    bgColor={childBgColor}
                    onToggle={() => handleChildrenToggle(childId)}
                  />

                  <ProgressBar
                    span={childSpan}
                    childSpans={showChildrenInProgressBar ? childSpan.children : undefined}
                    workflowStartTime={workflowStartTime}
                    totalDuration={totalDuration}
                  />

                  {childSpan.input && (
                    <InputOutputSection
                      label='Input'
                      data={childSpan.input}
                      isError={false}
                      spanId={childId}
                      sectionType='input'
                      expandedSections={expandedSections}
                      onToggle={handleSectionToggle}
                    />
                  )}

                  {childSpan.input && childSpan.output && (
                    <div className='border-[var(--border)] border-t border-dashed' />
                  )}

                  {childSpan.output && (
                    <InputOutputSection
                      label={childIsError ? 'Error' : 'Output'}
                      data={childSpan.output}
                      isError={childIsError}
                      spanId={childId}
                      sectionType='output'
                      expandedSections={expandedSections}
                      onToggle={handleSectionToggle}
                    />
                  )}

                  {/* Nested children */}
                  {showChildrenInProgressBar && hasNestedChildren && isNestedExpanded && (
                    <div className='mt-[2px] flex min-w-0 flex-col gap-[10px] overflow-hidden border-[var(--border)] border-l pl-[10px]'>
                      {childSpan.children!.map((nestedChild, nestedIndex) => (
                        <NestedBlockItem
                          key={nestedChild.id || `${childId}-nested-${nestedIndex}`}
                          span={nestedChild}
                          parentId={childId}
                          index={nestedIndex}
                          expandedSections={expandedSections}
                          onToggle={handleSectionToggle}
                          workflowStartTime={workflowStartTime}
                          totalDuration={totalDuration}
                          expandedChildren={expandedChildren}
                          onToggleChildren={handleChildrenToggle}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* For the first span (workflow execution), render all children as separate top-level cards */}
      {isFirstSpan &&
        hasChildren &&
        span.children!.map((childSpan, index) => (
          <TraceSpanItem
            key={childSpan.id || `${spanId}-child-${index}`}
            span={childSpan}
            totalDuration={totalDuration}
            workflowStartTime={workflowStartTime}
            isFirstSpan={false}
          />
        ))}

      {!isFirstSpan &&
        otherChildren.map((childSpan, index) => (
          <TraceSpanItem
            key={childSpan.id || `${spanId}-other-${index}`}
            span={childSpan}
            totalDuration={totalDuration}
            workflowStartTime={workflowStartTime}
            isFirstSpan={false}
          />
        ))}
    </>
  )
})

/**
 * Displays workflow execution trace spans with nested structure.
 * Memoized to prevent re-renders when parent LogDetails updates.
 */
export const TraceSpans = memo(function TraceSpans({
  traceSpans,
  totalDuration = 0,
}: TraceSpansProps) {
  const { workflowStartTime, actualTotalDuration, normalizedSpans } = useMemo(() => {
    if (!traceSpans || traceSpans.length === 0) {
      return { workflowStartTime: 0, actualTotalDuration: totalDuration, normalizedSpans: [] }
    }

    let earliest = Number.POSITIVE_INFINITY
    let latest = 0

    for (const span of traceSpans) {
      const start = parseTime(span.startTime)
      const end = parseTime(span.endTime)
      if (start < earliest) earliest = start
      if (end > latest) latest = end
    }

    return {
      workflowStartTime: earliest,
      actualTotalDuration: latest - earliest,
      normalizedSpans: normalizeAndSortSpans(traceSpans),
    }
  }, [traceSpans, totalDuration])

  if (!traceSpans || traceSpans.length === 0) {
    return <div className='text-[12px] text-[var(--text-secondary)]'>No trace data available</div>
  }

  return (
    <div className='flex w-full min-w-0 flex-col gap-[6px] overflow-hidden rounded-[6px] bg-[var(--surface-2)] px-[10px] py-[8px]'>
      <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>Trace Span</span>
      <div className='flex min-w-0 flex-col gap-[8px] overflow-hidden'>
        {normalizedSpans.map((span, index) => (
          <TraceSpanItem
            key={span.id || index}
            span={span}
            totalDuration={actualTotalDuration}
            workflowStartTime={workflowStartTime}
            isFirstSpan={index === 0}
          />
        ))}
      </div>
    </div>
  )
})
