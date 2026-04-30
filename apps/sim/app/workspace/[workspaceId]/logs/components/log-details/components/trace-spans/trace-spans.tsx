'use client'

import type React from 'react'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { formatDuration } from '@sim/utils/formatting'
import { ArrowDown, ArrowUp, Check, Clipboard, Search, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
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
 * Formats a token count with locale-aware thousands separators.
 * Returns `undefined` for missing or non-positive counts so callers can
 * filter them out before rendering.
 */
function formatTokenCount(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return value.toLocaleString('en-US')
}

/**
 * Builds a compact, dot-separated token summary for a span:
 * `"1,234 in · 567 out · 1,801 total"` with cache/reasoning appended when
 * present. Returns `undefined` when the span has no meaningful token data.
 */
function formatTokensSummary(tokens: TraceSpan['tokens']): string | undefined {
  if (!tokens) return undefined
  const parts: string[] = []
  const input = formatTokenCount(tokens.input)
  const output = formatTokenCount(tokens.output)
  const total = formatTokenCount(tokens.total)
  const cacheRead = formatTokenCount(tokens.cacheRead)
  const cacheWrite = formatTokenCount(tokens.cacheWrite)
  const reasoning = formatTokenCount(tokens.reasoning)
  if (input) parts.push(`${input} in`)
  if (cacheRead) parts.push(`${cacheRead} cached`)
  if (cacheWrite) parts.push(`${cacheWrite} cache write`)
  if (output) parts.push(`${output} out`)
  if (reasoning) parts.push(`${reasoning} reasoning`)
  if (total) parts.push(`${total} total`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * Formats a USD cost value for display. Shows `<$0.0001` for non-zero sub-cent
 * amounts so the user sees it was counted.
 */
function formatCostAmount(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  if (value < 0.0001) return '<$0.0001'
  return `$${value.toFixed(4)}`
}

/**
 * Builds a compact cost summary: `"$0.0023 · $0.0001 in · $0.0022 out"`.
 * Falls back to whichever parts are present.
 */
function formatCostSummary(cost: TraceSpan['cost']): string | undefined {
  if (!cost) return undefined
  const parts: string[] = []
  const total = formatCostAmount(cost.total)
  const input = formatCostAmount(cost.input)
  const output = formatCostAmount(cost.output)
  if (total) parts.push(total)
  if (input) parts.push(`${input} in`)
  if (output) parts.push(`${output} out`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * Derives tokens-per-second from output tokens over segment duration.
 * Returns `undefined` when inputs are missing or non-positive.
 */
function formatTps(outputTokens: number | undefined, durationMs: number): string | undefined {
  if (typeof outputTokens !== 'number' || !(outputTokens > 0)) return undefined
  if (!(durationMs > 0)) return undefined
  const tps = Math.round(outputTokens / (durationMs / 1000))
  if (!(tps > 0)) return undefined
  return `${tps.toLocaleString('en-US')} tok/s`
}

/**
 * Formats time-to-first-token. Uses `ms` below 1000, `s` above.
 */
function formatTtft(ms: number | undefined): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return undefined
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
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
 * Checks if a span or any of its descendants has an error (any error).
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
 * Checks if a span or any of its descendants has an unhandled error.
 * Spans with errorHandled: true (including containers that propagate it)
 * are skipped. Used only for the root workflow span to match the actual
 * workflow status.
 */
function hasUnhandledErrorInTree(span: TraceSpan): boolean {
  if (span.status === 'error' && !span.errorHandled) return true
  if (span.children && span.children.length > 0) {
    return span.children.some((child) => hasUnhandledErrorInTree(child))
  }
  if (span.toolCalls && span.toolCalls.length > 0 && !span.errorHandled) {
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
    // Handle load_skill tool with the AgentSkillsIcon
    if (toolName === 'load_skill') {
      return { icon: AgentSkillsIcon, bgColor: '#8B5CF6' }
    }
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
      const duration = s.duration || endMs - startMs
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
  sectionType: 'input' | 'output' | 'thinking' | 'modelToolCalls' | 'errorMessage'
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
    if (typeof data === 'string') return data
    return JSON.stringify(data, null, 2)
  }, [data])

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
    setIsContextMenuOpen(true)
  }

  function closeContextMenu() {
    setIsContextMenuOpen(false)
  }

  function handleCopy() {
    navigator.clipboard.writeText(jsonString)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
    closeContextMenu()
  }

  function handleSearch() {
    activateSearch()
    closeContextMenu()
  }

  return (
    <div className='relative flex min-w-0 flex-col gap-1.5 overflow-hidden'>
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
            'font-medium text-caption transition-colors',
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
              className='!bg-[var(--surface-4)] dark:!bg-[var(--surface-3)] max-h-[300px] min-h-0 max-w-full rounded-md border-0 [word-break:break-all]'
              wrapText
              searchQuery={isSearchActive ? searchQuery : undefined}
              currentMatchIndex={currentMatchIndex}
              onMatchCountChange={handleMatchCountChange}
            />
            {/* Glass action buttons overlay */}
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

          {/* Search Overlay */}
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

          {/* Context Menu - rendered in portal to avoid transform/overflow clipping */}
          {typeof document !== 'undefined' &&
            createPortal(
              <DropdownMenu open={isContextMenuOpen} onOpenChange={closeContextMenu} modal={false}>
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
  const isRootWorkflow = depth === 0
  const isRootWorkflowSpan = isRootWorkflow && span.type?.toLowerCase() === 'workflow'
  const hasNestedError = isRootWorkflowSpan ? hasUnhandledErrorInTree(span) : hasErrorInTree(span)
  const showErrorStyle = isDirectError || hasNestedError

  const { icon: BlockIcon, bgColor } = getBlockIconAndColor(span.type, span.name)

  const displayChildren = useMemo(() => {
    const kids: TraceSpan[] = span.children?.length
      ? [...span.children]
      : (span.toolCalls ?? []).map((tc, i) => ({
          id: `${spanId}-tool-${i}`,
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
    if (isAgent && !hasToolCall) {
      return kids.filter((c) => c.type?.toLowerCase() !== 'model')
    }
    return kids
  }, [span])

  const hasChildren = displayChildren.length > 0
  const isExpanded = isRootWorkflow || expandedNodes.has(spanId)
  const isToggleable = !isRootWorkflow

  const hasInput = Boolean(span.input)
  const hasOutput = Boolean(span.output)
  const hasThinking = Boolean(span.thinking)
  const hasModelToolCalls = Boolean(span.modelToolCalls && span.modelToolCalls.length > 0)
  const hasFinishReason = Boolean(span.finishReason)
  const tokensSummary = formatTokensSummary(span.tokens)
  const hasTokens = Boolean(tokensSummary)
  const costSummary = formatCostSummary(span.cost)
  const hasCost = Boolean(costSummary)
  const isModelSpan = span.type?.toLowerCase() === 'model'
  const tpsSummary = isModelSpan ? formatTps(span.tokens?.output, duration) : undefined
  const hasTps = Boolean(tpsSummary)
  const ttftSummary = formatTtft(span.ttft)
  const hasTtft = Boolean(ttftSummary)
  const hasProvider = Boolean(span.provider)
  const hasErrorType = Boolean(span.errorType)
  const hasErrorMessage = Boolean(span.errorMessage)

  // For progress bar - show child segments for workflow/iteration types
  const lowerType = span.type?.toLowerCase() || ''
  const showChildrenInProgressBar =
    isIterationType(lowerType) || lowerType === 'workflow' || lowerType === 'workflow_input'

  return (
    <div className='flex min-w-0 flex-col'>
      {/* Node Header Row */}
      <div
        className={cn(
          'group flex items-center justify-between gap-2 py-1.5',
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
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          {!isIterationType(span.type) && (
            <div
              className='relative flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center overflow-hidden rounded-sm'
              style={{ background: bgColor }}
            >
              {BlockIcon && <BlockIcon className='h-[9px] w-[9px] text-white' />}
            </div>
          )}
          <span
            className='min-w-0 max-w-[180px] truncate font-medium text-caption'
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
        <span className='flex-shrink-0 font-medium text-[var(--text-tertiary)] text-caption'>
          {formatDuration(duration, { precision: 2 })}
        </span>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className='flex min-w-0 flex-col gap-2.5'>
          {/* Progress Bar */}
          <ProgressBar
            span={span}
            childSpans={showChildrenInProgressBar ? span.children : undefined}
            workflowStartTime={workflowStartTime}
            totalDuration={totalDuration}
          />

          {/* Input/Output Sections */}
          {(hasInput ||
            hasOutput ||
            hasThinking ||
            hasModelToolCalls ||
            hasFinishReason ||
            hasTokens ||
            hasCost ||
            hasTps ||
            hasTtft ||
            hasProvider ||
            hasErrorType ||
            hasErrorMessage) && (
            <div className='flex min-w-0 flex-col gap-1.5 overflow-hidden py-0.5'>
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

              {hasThinking && (
                <>
                  {(hasInput || hasOutput) && (
                    <div className='border-[var(--border)] border-t border-dashed' />
                  )}
                  <InputOutputSection
                    label='Thinking'
                    data={span.thinking}
                    isError={false}
                    spanId={spanId}
                    sectionType='thinking'
                    expandedSections={expandedSections}
                    onToggle={onToggleSection}
                  />
                </>
              )}

              {hasModelToolCalls && (
                <>
                  {(hasInput || hasOutput || hasThinking) && (
                    <div className='border-[var(--border)] border-t border-dashed' />
                  )}
                  <InputOutputSection
                    label='Tool calls'
                    data={span.modelToolCalls}
                    isError={false}
                    spanId={spanId}
                    sectionType='modelToolCalls'
                    expandedSections={expandedSections}
                    onToggle={onToggleSection}
                  />
                </>
              )}

              {hasErrorMessage && (
                <>
                  {(hasInput || hasOutput || hasThinking || hasModelToolCalls) && (
                    <div className='border-[var(--border)] border-t border-dashed' />
                  )}
                  <InputOutputSection
                    label='Error'
                    data={span.errorMessage}
                    isError
                    spanId={spanId}
                    sectionType='errorMessage'
                    expandedSections={expandedSections}
                    onToggle={onToggleSection}
                  />
                </>
              )}

              {hasErrorType && (
                <div className='flex items-center justify-between gap-2 font-medium text-caption'>
                  <span className='flex-shrink-0 text-[var(--text-tertiary)]'>Error type</span>
                  <span className='min-w-0 truncate text-right text-[var(--text-error)]'>
                    {span.errorType}
                  </span>
                </div>
              )}

              {hasFinishReason && (
                <div className='flex items-center justify-between font-medium text-caption'>
                  <span className='text-[var(--text-tertiary)]'>Finish reason</span>
                  <span className='text-[var(--text-secondary)]'>{span.finishReason}</span>
                </div>
              )}

              {hasProvider && (
                <div className='flex items-center justify-between gap-2 font-medium text-caption'>
                  <span className='flex-shrink-0 text-[var(--text-tertiary)]'>Provider</span>
                  <span className='min-w-0 truncate text-right text-[var(--text-secondary)]'>
                    {span.provider}
                  </span>
                </div>
              )}

              {hasTtft && (
                <div className='flex items-center justify-between gap-2 font-medium text-caption'>
                  <span className='flex-shrink-0 text-[var(--text-tertiary)]'>TTFT</span>
                  <span className='min-w-0 truncate text-right text-[var(--text-secondary)]'>
                    {ttftSummary}
                  </span>
                </div>
              )}

              {hasTokens && (
                <div className='flex items-center justify-between gap-2 font-medium text-caption'>
                  <span className='flex-shrink-0 text-[var(--text-tertiary)]'>Tokens</span>
                  <span className='min-w-0 truncate text-right text-[var(--text-secondary)]'>
                    {tokensSummary}
                  </span>
                </div>
              )}

              {hasTps && (
                <div className='flex items-center justify-between gap-2 font-medium text-caption'>
                  <span className='flex-shrink-0 text-[var(--text-tertiary)]'>Throughput</span>
                  <span className='min-w-0 truncate text-right text-[var(--text-secondary)]'>
                    {tpsSummary}
                  </span>
                </div>
              )}

              {hasCost && (
                <div className='flex items-center justify-between gap-2 font-medium text-caption'>
                  <span className='flex-shrink-0 text-[var(--text-tertiary)]'>Cost</span>
                  <span className='min-w-0 truncate text-right text-[var(--text-secondary)]'>
                    {costSummary}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Nested Children */}
          {hasChildren && (
            <div className='flex min-w-0 flex-col gap-0.5 border-[var(--border)] border-l pl-2.5'>
              {displayChildren.map((child, index) => (
                <div key={child.id || `${spanId}-child-${index}`} className='pl-1.5'>
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
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set())
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
    return <div className='text-[var(--text-secondary)] text-caption'>No trace data available</div>
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
