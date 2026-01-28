'use client'

import type React from 'react'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Clipboard, Search, X } from 'lucide-react'
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
  Tooltip,
} from '@/components/emcn'
import { WorkflowIcon } from '@/components/icons'
import { cn } from '@/lib/core/utils/cn'
import { formatDuration } from '@/lib/core/utils/formatting'
import { LoopTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/loop/loop-config'
import { ParallelTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/parallel/parallel-config'
import { getBlock, getBlockByToolName } from '@/blocks'
import { useCodeViewerFeatures } from '@/hooks/use-code-viewer'
import type { TraceSpan } from '@/stores/logs/filters/types'

interface TraceSpansProps {
  traceSpans?: TraceSpan[]
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
 * Parses a time value to milliseconds
 */
function parseTime(value?: string | number | null): number {
  if (!value) return 0
  const ms = typeof value === 'number' ? value : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/**
 * Checks if a span or any of its descendants has an error
 */
function hasErrorInTree(span: TraceSpan): boolean {
  if (span.status === 'error') return true
  if (span.children && span.children.length > 0) {
    return span.children.some((child) => hasErrorInTree(child))
  }
  if (span.toolCalls && span.toolCalls.length > 0) {
    return span.toolCalls.some((tc) => tc.error)
  }
  return false
}

/**
 * Normalizes and sorts trace spans recursively.
 * Deduplicates children and sorts by start time.
 */
function normalizeAndSortSpans(spans: TraceSpan[]): TraceSpan[] {
  return spans
    .map((span) => {
      const enrichedSpan: TraceSpan = { ...span }

      // Process and deduplicate children
      const children = Array.isArray(span.children) ? span.children : []
      enrichedSpan.children = children.length > 0 ? normalizeAndSortSpans(children) : undefined

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
    <div className='relative h-[5px] w-full overflow-hidden rounded-[18px] bg-[var(--divider)]'>
      {segments.map((segment, index) => (
        <div
          key={index}
          className='absolute h-full opacity-70'
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

  // Context menu state
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false)
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })
  const [copied, setCopied] = useState(false)

  // Code viewer features
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
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
    closeContextMenu()
  }, [jsonString, closeContextMenu])

  const handleSearch = useCallback(() => {
    activateSearch()
    closeContextMenu()
  }, [activateSearch, closeContextMenu])

  return (
    <div className='relative flex min-w-0 flex-col gap-[6px] overflow-hidden'>
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
          className={cn(
            'font-medium text-[12px] transition-colors',
            isError
              ? 'text-[var(--text-error)]'
              : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]'
          )}
        >
          {label}
        </span>
        <ChevronDown
          className='h-[8px] w-[8px] text-[var(--text-tertiary)] transition-colors transition-transform group-hover:text-[var(--text-primary)]'
          style={{
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </div>
      {isExpanded && (
        <>
          <div ref={contentRef} onContextMenu={handleContextMenu} className='relative'>
            <Code.Viewer
              code={jsonString}
              language='json'
              className='!bg-[var(--surface-4)] dark:!bg-[var(--surface-3)] max-h-[300px] min-h-0 max-w-full rounded-[6px] border-0 [word-break:break-all]'
              wrapText
              searchQuery={isSearchActive ? searchQuery : undefined}
              currentMatchIndex={currentMatchIndex}
              onMatchCountChange={handleMatchCountChange}
            />
            {/* Glass action buttons overlay */}
            {!isSearchActive && (
              <div className='absolute top-[7px] right-[6px] z-10 flex gap-[4px]'>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      type='button'
                      variant='default'
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCopy()
                      }}
                      className='h-[20px] w-[20px] cursor-pointer border border-[var(--border-1)] bg-transparent p-0 backdrop-blur-sm hover:bg-[var(--surface-3)]'
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
                      className='h-[20px] w-[20px] cursor-pointer border border-[var(--border-1)] bg-transparent p-0 backdrop-blur-sm hover:bg-[var(--surface-3)]'
                    >
                      <Search className='h-[10px] w-[10px]' />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>Search</Tooltip.Content>
                </Tooltip.Root>
              </div>
            )}
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
                <PopoverContent align='start' side='bottom' sideOffset={4}>
                  <PopoverItem onClick={handleCopy}>Copy</PopoverItem>
                  <PopoverDivider />
                  <PopoverItem onClick={handleSearch}>Search</PopoverItem>
                </PopoverContent>
              </Popover>,
              document.body
            )}
        </>
      )}
    </div>
  )
}

interface TraceSpanNodeProps {
  span: TraceSpan
  workflowStartTime: number
  totalDuration: number
  depth: number
  expandedNodes: Set<string>
  expandedSections: Set<string>
  onToggleNode: (nodeId: string) => void
  onToggleSection: (section: string) => void
}

/**
 * Recursive tree node component for rendering trace spans
 */
const TraceSpanNode = memo(function TraceSpanNode({
  span,
  workflowStartTime,
  totalDuration,
  depth,
  expandedNodes,
  expandedSections,
  onToggleNode,
  onToggleSection,
}: TraceSpanNodeProps): React.ReactNode {
  const spanId = span.id || `span-${span.name}-${span.startTime}`
  const spanStartTime = new Date(span.startTime).getTime()
  const spanEndTime = new Date(span.endTime).getTime()
  const duration = span.duration || spanEndTime - spanStartTime

  const isDirectError = span.status === 'error'
  const hasNestedError = hasErrorInTree(span)
  const showErrorStyle = isDirectError || hasNestedError

  const { icon: BlockIcon, bgColor } = getBlockIconAndColor(span.type, span.name)

  // Root workflow execution is always expanded and has no toggle
  const isRootWorkflow = depth === 0

  // Build all children including tool calls
  const allChildren = useMemo(() => {
    const children: TraceSpan[] = []

    // Add tool calls as child spans
    if (span.toolCalls && span.toolCalls.length > 0) {
      span.toolCalls.forEach((toolCall, index) => {
        const toolStartTime = toolCall.startTime
          ? new Date(toolCall.startTime).getTime()
          : spanStartTime
        const toolEndTime = toolCall.endTime
          ? new Date(toolCall.endTime).getTime()
          : toolStartTime + (toolCall.duration || 0)

        children.push({
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
        } as TraceSpan)
      })
    }

    // Add regular children
    if (span.children && span.children.length > 0) {
      children.push(...span.children)
    }

    // Sort by start time
    return children.sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime))
  }, [span, spanId, spanStartTime])

  // Hide empty model timing segments for agents without tool calls
  const filteredChildren = useMemo(() => {
    const isAgent = span.type?.toLowerCase() === 'agent'
    const hasToolCalls =
      (span.toolCalls?.length ?? 0) > 0 || allChildren.some((c) => c.type?.toLowerCase() === 'tool')

    if (isAgent && !hasToolCalls) {
      return allChildren.filter((c) => c.type?.toLowerCase() !== 'model')
    }
    return allChildren
  }, [allChildren, span.type, span.toolCalls])

  const hasChildren = filteredChildren.length > 0
  const isExpanded = isRootWorkflow || expandedNodes.has(spanId)
  const isToggleable = !isRootWorkflow

  const hasInput = Boolean(span.input)
  const hasOutput = Boolean(span.output)

  // For progress bar - show child segments for workflow/iteration types
  const lowerType = span.type?.toLowerCase() || ''
  const showChildrenInProgressBar =
    isIterationType(lowerType) || lowerType === 'workflow' || lowerType === 'workflow_input'

  return (
    <div className='flex min-w-0 flex-col'>
      {/* Node Header Row */}
      <div
        className={cn(
          'group flex items-center justify-between gap-[8px] py-[6px]',
          isToggleable && 'cursor-pointer'
        )}
        onClick={isToggleable ? () => onToggleNode(spanId) : undefined}
        onKeyDown={
          isToggleable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onToggleNode(spanId)
                }
              }
            : undefined
        }
        role={isToggleable ? 'button' : undefined}
        tabIndex={isToggleable ? 0 : undefined}
        aria-expanded={isToggleable ? isExpanded : undefined}
        aria-label={isToggleable ? (isExpanded ? 'Collapse' : 'Expand') : undefined}
      >
        <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
          {!isIterationType(span.type) && (
            <div
              className='relative flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
              style={{ background: bgColor }}
            >
              {BlockIcon && <BlockIcon className='h-[9px] w-[9px] text-white' />}
            </div>
          )}
          <span
            className='min-w-0 max-w-[180px] truncate font-medium text-[12px]'
            style={{ color: showErrorStyle ? 'var(--text-error)' : 'var(--text-secondary)' }}
          >
            {span.name}
          </span>
          {isToggleable && (
            <ChevronDown
              className='h-[8px] w-[8px] flex-shrink-0 text-[var(--text-tertiary)] transition-colors transition-transform duration-100 group-hover:text-[var(--text-primary)]'
              style={{
                transform: `translateY(-0.25px) ${isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)'}`,
              }}
            />
          )}
        </div>
        <span className='flex-shrink-0 font-medium text-[12px] text-[var(--text-tertiary)]'>
          {formatDuration(duration, { precision: 2 })}
        </span>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className='flex min-w-0 flex-col gap-[10px]'>
          {/* Progress Bar */}
          <ProgressBar
            span={span}
            childSpans={showChildrenInProgressBar ? span.children : undefined}
            workflowStartTime={workflowStartTime}
            totalDuration={totalDuration}
          />

          {/* Input/Output Sections */}
          {(hasInput || hasOutput) && (
            <div className='flex min-w-0 flex-col gap-[6px] overflow-hidden py-[2px]'>
              {hasInput && (
                <InputOutputSection
                  label='Input'
                  data={span.input}
                  isError={false}
                  spanId={spanId}
                  sectionType='input'
                  expandedSections={expandedSections}
                  onToggle={onToggleSection}
                />
              )}

              {hasInput && hasOutput && (
                <div className='border-[var(--border)] border-t border-dashed' />
              )}

              {hasOutput && (
                <InputOutputSection
                  label={isDirectError ? 'Error' : 'Output'}
                  data={span.output}
                  isError={isDirectError}
                  spanId={spanId}
                  sectionType='output'
                  expandedSections={expandedSections}
                  onToggle={onToggleSection}
                />
              )}
            </div>
          )}

          {/* Nested Children */}
          {hasChildren && (
            <div className='flex min-w-0 flex-col gap-[2px] border-[var(--border)] border-l pl-[10px]'>
              {filteredChildren.map((child, index) => (
                <div key={child.id || `${spanId}-child-${index}`} className='pl-[6px]'>
                  <TraceSpanNode
                    span={child}
                    workflowStartTime={workflowStartTime}
                    totalDuration={totalDuration}
                    depth={depth + 1}
                    expandedNodes={expandedNodes}
                    expandedSections={expandedSections}
                    onToggleNode={onToggleNode}
                    onToggleSection={onToggleSection}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

/**
 * Displays workflow execution trace spans with nested tree structure.
 * Memoized to prevent re-renders when parent LogDetails updates.
 */
export const TraceSpans = memo(function TraceSpans({ traceSpans }: TraceSpansProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set())
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const toggleSet = useSetToggle()

  const { workflowStartTime, actualTotalDuration, normalizedSpans } = useMemo(() => {
    if (!traceSpans || traceSpans.length === 0) {
      return { workflowStartTime: 0, actualTotalDuration: 0, normalizedSpans: [] }
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
  }, [traceSpans])

  const handleToggleNode = useCallback(
    (nodeId: string) => toggleSet(setExpandedNodes, nodeId),
    [toggleSet]
  )

  const handleToggleSection = useCallback(
    (section: string) => toggleSet(setExpandedSections, section),
    [toggleSet]
  )

  if (!traceSpans || traceSpans.length === 0) {
    return <div className='text-[12px] text-[var(--text-secondary)]'>No trace data available</div>
  }

  return (
    <div className='flex w-full min-w-0 flex-col overflow-hidden'>
      {normalizedSpans.map((span, index) => (
        <TraceSpanNode
          key={span.id || index}
          span={span}
          workflowStartTime={workflowStartTime}
          totalDuration={actualTotalDuration}
          depth={0}
          expandedNodes={expandedNodes}
          expandedSections={expandedSections}
          onToggleNode={handleToggleNode}
          onToggleSection={handleToggleSection}
        />
      ))}
    </div>
  )
})
