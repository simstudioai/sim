'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Code,
  Cpu,
  ExternalLink,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import {
  AgentIcon,
  ApiIcon,
  ChartBarIcon,
  CodeIcon,
  ConditionalIcon,
  ConnectIcon,
} from '@/components/icons'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, redactApiKeys } from '@/lib/utils'
import { getBlock } from '@/blocks/registry'
import { getProviderIcon } from '@/providers/utils'
import type { TraceSpan } from '@/stores/logs/filters/types'
import { getTool } from '@/tools/utils'

function getSpanKey(span: TraceSpan): string {
  if (span.id) {
    return span.id
  }

  const name = span.name || 'span'
  const start = span.startTime || 'unknown-start'
  const end = span.endTime || 'unknown-end'

  return `${name}|${start}|${end}`
}

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

function normalizeChildWorkflowSpan(span: TraceSpan): TraceSpan {
  const enrichedSpan: TraceSpan = { ...span }

  if (enrichedSpan.output && typeof enrichedSpan.output === 'object') {
    enrichedSpan.output = { ...enrichedSpan.output }
  }

  const normalizedChildren = Array.isArray(span.children)
    ? span.children.map((childSpan) => normalizeChildWorkflowSpan(childSpan))
    : []

  const outputChildSpans = Array.isArray(span.output?.childTraceSpans)
    ? (span.output!.childTraceSpans as TraceSpan[]).map((childSpan) =>
        normalizeChildWorkflowSpan(childSpan)
      )
    : []

  const mergedChildren = mergeTraceSpanChildren(normalizedChildren, outputChildSpans)

  if (enrichedSpan.output && 'childTraceSpans' in enrichedSpan.output) {
    const { childTraceSpans, ...cleanOutput } = enrichedSpan.output as {
      childTraceSpans?: TraceSpan[]
    } & Record<string, unknown>
    enrichedSpan.output = cleanOutput
  }

  enrichedSpan.children = mergedChildren.length > 0 ? mergedChildren : undefined

  return enrichedSpan
}

interface TraceSpansDisplayProps {
  traceSpans?: TraceSpan[]
  totalDuration?: number
  onExpansionChange?: (expanded: boolean) => void
}

// Transform raw block data into clean, user-friendly format
function transformBlockData(data: any, blockType: string, isInput: boolean) {
  if (!data) return null

  // For input data, filter out sensitive information
  if (isInput) {
    const cleanInput = redactApiKeys(data)

    // Remove null/undefined values for cleaner display
    Object.keys(cleanInput).forEach((key) => {
      if (cleanInput[key] === null || cleanInput[key] === undefined) {
        delete cleanInput[key]
      }
    })

    return cleanInput
  }

  // For output data, extract meaningful information based on block type
  if (data.response) {
    const response = data.response

    switch (blockType) {
      case 'agent':
        return {
          content: response.content,
          model: data.model,
          tokens: data.tokens,
          toolCalls: response.toolCalls,
          ...(data.cost && { cost: data.cost }),
        }

      case 'function':
        return {
          result: response.result,
          stdout: response.stdout,
          ...(response.executionTime && { executionTime: `${response.executionTime}ms` }),
        }

      case 'api':
        return {
          data: response.data,
          status: response.status,
          headers: response.headers,
        }

      case 'tool':
        // For tool calls, show the result data directly
        return response

      default:
        // For other block types, show the response content
        return response
    }
  }

  return data
}

// Collapsible Input/Output component
interface CollapsibleInputOutputProps {
  span: TraceSpan
  spanId: string
  depth: number
}

function CollapsibleInputOutput({ span, spanId, depth }: CollapsibleInputOutputProps) {
  const [inputExpanded, setInputExpanded] = useState(false)
  const [outputExpanded, setOutputExpanded] = useState(false)

  // Calculate the left margin based on depth to match the parent span's indentation
  const leftMargin = depth * 16 + 8 + 24 // Base depth indentation + icon width + extra padding

  return (
    <div
      className='mt-2 mr-4 mb-4 space-y-3 overflow-hidden'
      style={{ marginLeft: `${leftMargin}px` }}
    >
      {/* Input Data - Collapsible */}
      {span.input && (
        <div>
          <button
            onClick={() => setInputExpanded(!inputExpanded)}
            className='mb-2 flex items-center gap-2 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground'
          >
            {inputExpanded ? (
              <ChevronDown className='h-3 w-3' />
            ) : (
              <ChevronRight className='h-3 w-3' />
            )}
            Input
          </button>
          {inputExpanded && (
            <div className='mb-2 overflow-hidden rounded-md bg-secondary/30 p-3'>
              <BlockDataDisplay data={span.input} blockType={span.type} isInput={true} />
            </div>
          )}
        </div>
      )}

      {/* Output Data - Collapsible */}
      {span.output && (
        <div>
          <button
            onClick={() => setOutputExpanded(!outputExpanded)}
            className='mb-2 flex items-center gap-2 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground'
          >
            {outputExpanded ? (
              <ChevronDown className='h-3 w-3' />
            ) : (
              <ChevronRight className='h-3 w-3' />
            )}
            {span.status === 'error' ? 'Error Details' : 'Output'}
          </button>
          {outputExpanded && (
            <div className='mb-2 overflow-hidden rounded-md bg-secondary/30 p-3'>
              <BlockDataDisplay
                data={span.output}
                blockType={span.type}
                isInput={false}
                isError={span.status === 'error'}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Component to display block input/output data in a clean, readable format
function BlockDataDisplay({
  data,
  blockType,
  isInput = false,
  isError = false,
}: {
  data: any
  blockType?: string
  isInput?: boolean
  isError?: boolean
}) {
  if (!data) return null

  // Handle different data types
  const renderValue = (value: any, key?: string): React.ReactNode => {
    if (value === null) return <span className='text-muted-foreground italic'>null</span>
    if (value === undefined) return <span className='text-muted-foreground italic'>undefined</span>

    if (typeof value === 'string') {
      return <span className='break-all text-emerald-700 dark:text-emerald-400'>"{value}"</span>
    }

    if (typeof value === 'number') {
      return <span className='font-mono text-blue-700 dark:text-blue-400'>{value}</span>
    }

    if (typeof value === 'boolean') {
      return (
        <span className='font-mono text-amber-700 dark:text-amber-400'>{value.toString()}</span>
      )
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return <span className='text-muted-foreground'>[]</span>
      return (
        <div className='space-y-0.5'>
          <span className='text-muted-foreground'>[</span>
          <div className='ml-2 space-y-0.5'>
            {value.map((item, index) => (
              <div key={index} className='flex min-w-0 gap-1.5'>
                <span className='flex-shrink-0 font-mono text-slate-600 text-xs dark:text-slate-400'>
                  {index}:
                </span>
                <div className='min-w-0 flex-1 overflow-hidden'>{renderValue(item)}</div>
              </div>
            ))}
          </div>
          <span className='text-muted-foreground'>]</span>
        </div>
      )
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value)
      if (entries.length === 0) return <span className='text-muted-foreground'>{'{}'}</span>

      return (
        <div className='space-y-0.5'>
          {entries.map(([objKey, objValue]) => (
            <div key={objKey} className='flex min-w-0 gap-1.5'>
              <span className='flex-shrink-0 font-medium text-indigo-700 dark:text-indigo-400'>
                {objKey}:
              </span>
              <div className='min-w-0 flex-1 overflow-hidden'>{renderValue(objValue, objKey)}</div>
            </div>
          ))}
        </div>
      )
    }

    return <span>{String(value)}</span>
  }

  // Transform the data for better display
  const transformedData = transformBlockData(data, blockType || 'unknown', isInput)

  // Special handling for error output
  if (isError && data.error) {
    return (
      <div className='space-y-2 text-xs'>
        <div className='rounded border border-red-200 bg-red-50 p-2 dark:border-red-800 dark:bg-red-950/20'>
          <div className='mb-1 font-medium text-red-800 dark:text-red-400'>Error</div>
          <div className='text-red-700 dark:text-red-300'>{data.error}</div>
        </div>
        {/* Show other output data if available */}
        {transformedData &&
          Object.keys(transformedData).filter((key) => key !== 'error' && key !== 'success')
            .length > 0 && (
            <div className='space-y-0.5'>
              {Object.entries(transformedData)
                .filter(([key]) => key !== 'error' && key !== 'success')
                .map(([key, value]) => (
                  <div key={key} className='flex gap-1.5'>
                    <span className='font-medium text-indigo-700 dark:text-indigo-400'>{key}:</span>
                    {renderValue(value, key)}
                  </div>
                ))}
            </div>
          )}
      </div>
    )
  }

  return (
    <div className='space-y-1 overflow-hidden text-xs'>{renderValue(transformedData || data)}</div>
  )
}

function formatDurationDisplay(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`
  }
  return `${(ms / 1000).toFixed(2)}s`
}

export function TraceSpansDisplay({
  traceSpans,
  totalDuration = 0,
  onExpansionChange,
}: TraceSpansDisplayProps) {
  // Keep track of expanded spans
  const [expandedSpans, setExpandedSpans] = useState<Set<string>>(new Set())
  // UI controls
  const [typeFilters, setTypeFilters] = useState<Record<string, boolean>>({})
  // Shared hover position across rows (percentage of total workflow timeline)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const timelineHitboxRef = useRef<HTMLDivElement | null>(null)
  const [hoveredPercent, setHoveredPercent] = useState<number | null>(null)
  const [hoveredWorkflowMs, setHoveredWorkflowMs] = useState<number | null>(null)
  const [hoveredX, setHoveredX] = useState<number | null>(null)
  const [containerWidth, setContainerWidth] = useState<number>(0)

  type ChipVisibility = {
    model: boolean
    toolProvider: boolean
    tokens: boolean
    cost: boolean
    relative: boolean
  }

  const chipVisibility: ChipVisibility = useMemo(() => {
    const leftBudget = containerWidth * 0.55
    return {
      model: leftBudget >= 300, // first to reveal
      toolProvider: leftBudget >= 300, // alongside model
      tokens: leftBudget >= 380, // then tokens
      cost: leftBudget >= 460, // then cost
      relative: leftBudget >= 540, // finally relative timing
    }
  }, [containerWidth])

  // Early return after all hooks
  if (!traceSpans || traceSpans.length === 0) {
    return <div className='text-muted-foreground text-sm'>No trace data available</div>
  }

  // Find the earliest start time among all spans to be the workflow start time
  const workflowStartTime = traceSpans.reduce((earliest, span) => {
    const startTime = new Date(span.startTime).getTime()
    return startTime < earliest ? startTime : earliest
  }, Number.POSITIVE_INFINITY)

  // Find the latest end time among all spans
  const workflowEndTime = traceSpans.reduce((latest, span) => {
    const endTime = span.endTime ? new Date(span.endTime).getTime() : 0
    return endTime > latest ? endTime : latest
  }, 0)

  // Calculate the actual total workflow duration from start to end
  // This ensures parallel spans are represented correctly in the timeline
  const actualTotalDuration = workflowEndTime - workflowStartTime

  // Handle span toggling
  const handleSpanToggle = (spanId: string, expanded: boolean, hasSubItems: boolean) => {
    const newExpandedSpans = new Set(expandedSpans)
    if (expanded) {
      newExpandedSpans.add(spanId)
    } else {
      newExpandedSpans.delete(spanId)
    }
    setExpandedSpans(newExpandedSpans)

    // Only notify parent component if this span has children or tool calls
    if (onExpansionChange && hasSubItems) {
      onExpansionChange(newExpandedSpans.size > 0)
    }
  }

  // Helper: collect all types present to build filters once
  const availableTypes = useMemo(() => {
    const set = new Set<string>()
    const visit = (spans?: TraceSpan[]) => {
      if (!spans) return
      for (const s of spans) {
        if (s?.type) {
          const tl = s.type.toLowerCase()
          if (tl !== 'workflow') set.add(tl) // Never expose 'workflow' as a filter
        }
        if (s?.children?.length) visit(s.children)
        if ((s as any)?.toolCalls?.length) set.add('tool')
      }
    }
    visit(traceSpans)
    return Array.from(set).sort()
  }, [traceSpans])

  // Initialize filters on first render of a given set of types
  const effectiveTypeFilters = useMemo(() => {
    if (!availableTypes.length) return {}
    // if user hasn't set anything, default all to true
    if (Object.keys(typeFilters).length === 0) {
      const all: Record<string, boolean> = {}
      availableTypes.forEach((t) => (all[t] = true))
      return all
    }
    // ensure newly appearing types default to true
    const merged = { ...typeFilters }
    availableTypes.forEach((t) => {
      if (merged[t] === undefined) merged[t] = true
    })
    return merged
  }, [availableTypes, typeFilters])

  const toggleAll = (expand: boolean) => {
    if (!traceSpans) return
    const next = new Set<string>()
    if (expand) {
      const collect = (spans: TraceSpan[]) => {
        for (const s of spans) {
          const id = s.id || `span-${s.name}-${s.startTime}`
          next.add(id)
          if (s.children?.length) collect(s.children)
          if ((s as any)?.toolCalls?.length) next.add(`${id}-tools`)
        }
      }
      collect(traceSpans)
    }
    setExpandedSpans(next)
    onExpansionChange?.(expand)
  }

  const filtered = useMemo(() => {
    const allowed = new Set(
      Object.entries(effectiveTypeFilters)
        .filter(([, v]) => v)
        .map(([k]) => k)
    )
    const filterTree = (spans: TraceSpan[]): TraceSpan[] =>
      spans
        .map((s) => ({ ...s }))
        .filter((s) => {
          const tl = s.type?.toLowerCase?.() || ''
          // Always keep workflow container spans visible
          if (tl === 'workflow') return true
          return allowed.has(tl)
        })
        .map((s) => ({
          ...s,
          children: s.children ? filterTree(s.children) : undefined,
        }))
    return traceSpans ? filterTree(traceSpans) : []
  }, [traceSpans, effectiveTypeFilters])

  const forwardHover = useCallback(
    (clientX: number, clientY: number) => {
      if (!timelineHitboxRef.current || !containerRef.current) return

      const railRect = timelineHitboxRef.current.getBoundingClientRect()
      const containerRect = containerRef.current.getBoundingClientRect()

      const withinX = clientX >= railRect.left && clientX <= railRect.right
      const withinY = clientY >= railRect.top && clientY <= railRect.bottom

      if (!withinX || !withinY) {
        setHoveredPercent(null)
        setHoveredWorkflowMs(null)
        setHoveredX(null)
        return
      }

      const clamped = Math.max(0, Math.min(1, (clientX - railRect.left) / railRect.width))
      setHoveredPercent(clamped * 100)
      setHoveredWorkflowMs(workflowStartTime + clamped * actualTotalDuration)
      setHoveredX(railRect.left + clamped * railRect.width - containerRect.left)
    },
    [actualTotalDuration, workflowStartTime]
  )

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      forwardHover(event.clientX, event.clientY)
    }

    window.addEventListener('pointermove', handleMove)
    return () => window.removeEventListener('pointermove', handleMove)
  }, [forwardHover])

  // Observe container width to drive progressive chip visibility
  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const ro = new (window as any).ResizeObserver((entries: any[]) => {
      const width = entries?.[0]?.contentRect?.width || el.clientWidth
      setContainerWidth(width)
    })
    ro.observe(el)
    // Initialize immediately
    setContainerWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    return () => {
      // onTimelineHover?.(null) // This line was removed as per the edit hint
    }
  }, []) // Removed onTimelineHover from dependency array

  return (
    <div className='w-full'>
      <div className='mb-2 flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <div className='font-medium text-muted-foreground text-xs'>Workflow Execution</div>
        </div>
        <div className='flex items-center gap-1'>
          {(() => {
            const anyExpanded = expandedSpans.size > 0
            return (
              <button
                onClick={() => toggleAll(!anyExpanded)}
                className='rounded px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-accent'
                title={anyExpanded ? 'Collapse all' : 'Expand all'}
              >
                {anyExpanded ? (
                  <>
                    <Minimize2 className='mr-1 inline h-3.5 w-3.5' /> Collapse
                  </>
                ) : (
                  <>
                    <Maximize2 className='mr-1 inline h-3.5 w-3.5' /> Expand
                  </>
                )}
              </button>
            )
          })()}
        </div>
      </div>
      <div
        ref={containerRef}
        className='relative w-full overflow-hidden rounded-md border shadow-sm'
        onMouseLeave={() => {
          setHoveredPercent(null)
          setHoveredWorkflowMs(null)
          setHoveredX(null)
        }}
      >
        {filtered.map((span, index) => {
          const normalizedSpan = normalizeChildWorkflowSpan(span)
          const hasSubItems = Boolean(
            (normalizedSpan.children && normalizedSpan.children.length > 0) ||
              (normalizedSpan.toolCalls && normalizedSpan.toolCalls.length > 0) ||
              normalizedSpan.input ||
              normalizedSpan.output
          )

          // Calculate gap from previous span (for sequential execution visualization)
          let gapMs = 0
          let gapPercent = 0
          if (index > 0) {
            const prevSpan = filtered[index - 1]
            const prevEndTime = new Date(prevSpan.endTime).getTime()
            const currentStartTime = new Date(normalizedSpan.startTime).getTime()
            gapMs = currentStartTime - prevEndTime
            if (gapMs > 0 && actualTotalDuration > 0) {
              gapPercent = (gapMs / actualTotalDuration) * 100
            }
          }

          return (
            <TraceSpanItem
              key={index}
              span={normalizedSpan}
              depth={0}
              totalDuration={
                actualTotalDuration !== undefined ? actualTotalDuration : totalDuration
              }
              isLast={index === traceSpans.length - 1}
              parentStartTime={new Date(normalizedSpan.startTime).getTime()}
              workflowStartTime={workflowStartTime}
              onToggle={handleSpanToggle}
              expandedSpans={expandedSpans}
              hasSubItems={hasSubItems}
              hoveredPercent={hoveredPercent}
              hoveredWorkflowMs={hoveredWorkflowMs}
              forwardHover={forwardHover}
              gapBeforeMs={gapMs}
              gapBeforePercent={gapPercent}
              showRelativeChip={chipVisibility.relative}
              chipVisibility={chipVisibility}
            />
          )
        })}

        {/* Global crosshair spanning all rows with visible time label */}
        {hoveredPercent !== null && hoveredX !== null && (
          <>
            <div
              className='pointer-events-none absolute inset-y-0 w-px bg-black/30 dark:bg-white/45'
              style={{ left: hoveredX, zIndex: 20 }}
            />
            <div
              className='-translate-x-1/2 pointer-events-none absolute top-1 rounded bg-popover px-1.5 py-0.5 text-[10px] text-foreground shadow'
              style={{ left: hoveredX, zIndex: 20 }}
            >
              {formatDurationDisplay(Math.max(0, (hoveredWorkflowMs || 0) - workflowStartTime))}
            </div>
          </>
        )}

        {/* Hover capture area - aligned to timeline bars, not extending to edge */}
        <div
          ref={timelineHitboxRef}
          className='pointer-events-auto absolute inset-y-0 right-[73px] w-[calc(45%-73px)]'
          onPointerMove={(e) => forwardHover(e.clientX, e.clientY)}
          onPointerLeave={() => {
            setHoveredPercent(null)
            setHoveredWorkflowMs(null)
            setHoveredX(null)
          }}
        />
      </div>
    </div>
  )
}

interface TraceSpanItemProps {
  span: TraceSpan
  depth: number
  totalDuration: number
  isLast: boolean
  parentStartTime: number // Start time of the parent span for offset calculation
  workflowStartTime: number // Start time of the entire workflow
  onToggle: (spanId: string, expanded: boolean, hasSubItems: boolean) => void
  expandedSpans: Set<string>
  hasSubItems?: boolean
  hoveredPercent?: number | null
  hoveredWorkflowMs?: number | null
  forwardHover: (clientX: number, clientY: number) => void
  gapBeforeMs?: number // Gap duration before this span in ms
  gapBeforePercent?: number // Gap as percentage of total duration
  showRelativeChip?: boolean
  chipVisibility?: {
    model: boolean
    toolProvider: boolean
    tokens: boolean
    cost: boolean
    relative: boolean
  }
}

function TraceSpanItem({
  span,
  depth,
  totalDuration,
  isLast,
  parentStartTime,
  workflowStartTime,
  onToggle,
  expandedSpans,
  hasSubItems = false,
  hoveredPercent = null,
  hoveredWorkflowMs = null,
  forwardHover,
  gapBeforeMs = 0,
  gapBeforePercent = 0,
  showRelativeChip = true,
  chipVisibility = { model: true, toolProvider: true, tokens: true, cost: true, relative: true },
}: TraceSpanItemProps): React.ReactNode {
  const spanId = span.id || `span-${span.name}-${span.startTime}`
  const expanded = expandedSpans.has(spanId)
  const hasChildren = span.children && span.children.length > 0
  const hasToolCalls = span.toolCalls && span.toolCalls.length > 0
  const hasInputOutput = Boolean(span.input || span.output)
  const hasNestedItems = hasChildren || hasToolCalls || hasInputOutput

  // Calculate timing information
  const spanStartTime = new Date(span.startTime).getTime()
  const spanEndTime = new Date(span.endTime).getTime()
  const duration = span.duration || spanEndTime - spanStartTime
  const startOffset = spanStartTime - parentStartTime // Time from parent start to this span's start

  // Calculate the position relative to the workflow start time for accurate timeline visualization
  // For parallel execution, this ensures spans align correctly based on their actual start time
  const relativeStartPercent =
    totalDuration > 0 ? ((spanStartTime - workflowStartTime) / totalDuration) * 100 : 0

  // Calculate width based on the span's actual duration relative to total workflow duration
  const actualDurationPercent = totalDuration > 0 ? (duration / totalDuration) * 100 : 0

  // Ensure values are within valid range
  const safeStartPercent = Math.min(100, Math.max(0, relativeStartPercent))
  const safeWidthPercent = Math.max(2, Math.min(100 - safeStartPercent, actualDurationPercent))

  // Handle click to expand/collapse this span
  const handleSpanClick = () => {
    if (hasNestedItems) {
      onToggle(spanId, !expanded, hasNestedItems)
    }
  }

  // Get appropriate icon based on span type
  const getSpanIcon = () => {
    const type = span.type.toLowerCase()

    // Expand/collapse for spans with children
    if (hasNestedItems) {
      return expanded ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />
    }

    // Block type specific icons
    if (type === 'agent') {
      return <AgentIcon className='h-3 w-3 text-[var(--brand-primary-hover-hex)]' />
    }

    if (type === 'evaluator') {
      return <ChartBarIcon className='h-3 w-3 text-[#2FA1FF]' />
    }

    if (type === 'condition') {
      return <ConditionalIcon className='h-3 w-3 text-[#FF972F]' />
    }

    if (type === 'router') {
      return <ConnectIcon className='h-3 w-3 text-[#2FA1FF]' />
    }

    if (type === 'model') {
      return <Cpu className='h-3 w-3 text-[#10a37f]' />
    }

    if (type === 'function') {
      return <CodeIcon className='h-3 w-3 text-[#FF402F]' />
    }

    if (type === 'tool') {
      // Try to resolve provider icon from block registry using the longest matching prefix
      const toolId = String(span.name || '')
      const parts = toolId.split('_')
      for (let i = parts.length; i > 0; i--) {
        const candidate = parts.slice(0, i).join('_')
        const block = getBlock(candidate)
        if (block?.icon) {
          const Icon = block.icon as any
          const color = (block as any).bgColor || '#f97316'
          return <Icon className='h-3 w-3' style={{ color }} />
        }
      }
      return <ExternalLink className='h-3 w-3 text-[#f97316]' />
    }

    if (type === 'api') {
      return <ApiIcon className='h-3 w-3 text-[#2F55FF]' />
    }

    return <Code className='h-3 w-3 text-muted-foreground' />
  }

  // Format milliseconds as +XXms for relative timing
  const formatRelativeTime = (ms: number) => {
    if (ms === 0) return 'start'
    return `+${ms}ms`
  }

  // Get color based on span type
  const getSpanColor = (type: string) => {
    switch (type.toLowerCase()) {
      case 'agent':
        return 'var(--brand-primary-hover-hex)' // Purple from AgentBlock
      case 'provider':
        return '#818cf8' // Indigo for provider
      case 'model':
        return '#10a37f' // Green from OpenAIBlock
      case 'function':
        return '#FF402F' // Orange-red from FunctionBlock
      case 'tool':
        return '#f97316' // Orange for tools
      case 'router':
        return '#2FA1FF' // Blue from RouterBlock
      case 'condition':
        return '#FF972F' // Orange from ConditionBlock
      case 'evaluator':
        return '#2FA1FF' // Blue from EvaluatorBlock
      case 'api':
        return '#2F55FF' // Blue from ApiBlock
      default:
        return '#6b7280' // Gray for others
    }
  }

  const spanColor = getSpanColor(span.type)

  // Format duration to be more readable
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  // Extract model name from span name using a more general pattern
  const extractModelName = (spanName: string) => {
    // Try to match model name in parentheses
    const modelMatch = spanName.match(/\(([\w.-]+)\)/i)
    return modelMatch ? modelMatch[1] : ''
  }

  // Format span name for display
  const formatSpanName = (span: TraceSpan) => {
    // Humanize tool names: use tool registry name when available
    if (span.type === 'tool') {
      const raw = String(span.name || '')
      const tool = getTool(raw)
      const displayName = (() => {
        if (tool?.name) return tool.name
        // Fallback: drop provider prefix and title-case
        const parts = raw.split('_')
        const label = parts.slice(1).join(' ')
        if (label) {
          return label.replace(/\b\w/g, (c) => c.toUpperCase())
        }
        return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      })()

      // Return just the display name; provider icon chip will render in the metadata area
      return displayName
    }
    if (span.type === 'model') {
      const modelName = extractModelName(span.name)

      if (span.name.includes('Initial response')) {
        return (
          <>
            Initial response{' '}
            {modelName && <span className='text-xs opacity-75'>({modelName})</span>}
          </>
        )
      }
      if (span.name.includes('(iteration')) {
        return (
          <>
            Model response {modelName && <span className='text-xs opacity-75'>({modelName})</span>}
          </>
        )
      }
      if (span.name.includes('Model Generation')) {
        return (
          <>
            Model Generation{' '}
            {modelName && <span className='text-xs opacity-75'>({modelName})</span>}
          </>
        )
      }
    }

    return span.name
  }

  return (
    <div
      className={cn(
        'relative border-b transition-colors last:border-b-0',
        expanded ? 'bg-muted/50 dark:bg-accent/30' : 'hover:bg-muted/30 hover:dark:bg-accent/20'
      )}
    >
      {/* Left rail connector for nested levels */}
      {depth > 0 && (
        <div
          className='pointer-events-none absolute top-0 bottom-0 border-border/60 border-l'
          style={{ left: `${depth * 16 + 6}px` }}
        />
      )}
      {/* Span header */}
      <div
        className={cn(
          'flex items-center px-2 py-1.5',
          hasNestedItems ? 'cursor-pointer' : 'cursor-default'
        )}
        onClick={handleSpanClick}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <div className='mr-2 flex w-5 flex-shrink-0 items-center justify-center'>
          {getSpanIcon()}
        </div>

        <div className='flex min-w-0 flex-1 items-center gap-2 overflow-hidden'>
          <div
            className='min-w-0 flex-shrink overflow-hidden'
            style={{ paddingRight: 'calc(45% + 80px)' }}
          >
            <div className='mb-0.5 flex items-center space-x-2'>
              <span
                className={cn(
                  'truncate font-medium text-sm',
                  span.status === 'error' && 'text-red-500'
                )}
              >
                {formatSpanName(span)}
              </span>
              {/* Metadata badges */}
              {chipVisibility.model && (span as any).model && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className='inline-flex cursor-default items-center gap-1 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums'>
                        {(() => {
                          const Icon = getProviderIcon(String((span as any).model) || '') as any
                          return Icon ? <Icon className='h-3 w-3' /> : null
                        })()}
                        {String((span as any).model)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side='top'>Model</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {/* Provider chip for tools – grayscale icon chip to the right of tool name */}
              {chipVisibility.toolProvider &&
                span.type === 'tool' &&
                (() => {
                  const raw = String((span as any).name || '')
                  const parts = raw.split('_')
                  let block: any
                  for (let i = parts.length; i > 0; i--) {
                    const candidate = parts.slice(0, i).join('_')
                    const b = getBlock(candidate)
                    if (b) {
                      block = b
                      break
                    }
                  }
                  if (!block?.icon) return null
                  const Icon = block.icon as any
                  return (
                    <span className='inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground'>
                      <Icon className='h-3 w-3 text-muted-foreground' />
                    </span>
                  )
                })()}
              {chipVisibility.tokens && (span as any).tokens && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className='cursor-default rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums'>
                        {(() => {
                          const t = (span as any).tokens
                          const total =
                            typeof t === 'number'
                              ? t
                              : (t.total ?? (t.input || 0) + (t.output || 0))
                          return `T:${total}`
                        })()}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side='top'>
                      {(() => {
                        const t = (span as any).tokens
                        if (typeof t === 'number') return <span>{t} tokens</span>
                        const hasIn = typeof t.input === 'number'
                        const hasOut = typeof t.output === 'number'
                        const input = hasIn ? t.input : undefined
                        const output = hasOut ? t.output : undefined
                        const total =
                          t.total ??
                          (hasIn && hasOut ? (t.input || 0) + (t.output || 0) : undefined)

                        if (hasIn || hasOut) {
                          return (
                            <span className='font-normal text-xs'>
                              {`${hasIn ? input : '—'} in / ${hasOut ? output : '—'} out`}
                              {typeof total === 'number' ? ` (total ${total})` : ''}
                            </span>
                          )
                        }
                        if (typeof total === 'number')
                          return <span className='font-normal text-xs'>Total {total} tokens</span>
                        return <span className='font-normal text-xs'>Tokens unavailable</span>
                      })()}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {chipVisibility.cost && (span as any).cost?.total !== undefined && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className='cursor-default rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums'>
                        {(() => {
                          try {
                            const { formatCost } = require('@/providers/utils')
                            return formatCost(Number((span as any).cost.total) || 0)
                          } catch {
                            return `$${Number.parseFloat(String((span as any).cost.total)).toFixed(4)}`
                          }
                        })()}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side='top'>
                      {(() => {
                        const c = (span as any).cost || {}
                        const input = typeof c.input === 'number' ? c.input : undefined
                        const output = typeof c.output === 'number' ? c.output : undefined
                        const total =
                          typeof c.total === 'number'
                            ? c.total
                            : typeof input === 'number' && typeof output === 'number'
                              ? input + output
                              : undefined
                        let formatCostFn: any = (v: number) => `$${Number(v).toFixed(4)}`
                        try {
                          formatCostFn = require('@/providers/utils').formatCost
                        } catch {}
                        return (
                          <div className='space-y-0.5'>
                            {typeof input === 'number' && (
                              <div className='text-xs'>Input: {formatCostFn(input)}</div>
                            )}
                            {typeof output === 'number' && (
                              <div className='text-xs'>Output: {formatCostFn(output)}</div>
                            )}
                            {typeof total === 'number' && (
                              <div className='border-t pt-0.5 text-xs'>
                                Total: {formatCostFn(total)}
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {/* Relative timing chip (responsive) */}
              {showRelativeChip && depth > 0 && (
                <span className='inline-flex items-center rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums'>
                  {span.relativeStartMs !== undefined
                    ? `+${span.relativeStartMs}ms`
                    : formatRelativeTime(startOffset)}
                </span>
              )}
            </div>
            <span className='block text-muted-foreground text-xs'>{formatDuration(duration)}</span>
          </div>

          {/* Timeline visualization - absolutely positioned to ensure alignment across all rows */}
          <div
            className='absolute right-[73px] hidden h-full items-center sm:flex'
            style={{ width: 'calc(45% - 73px)', pointerEvents: 'none' }}
          >
            <div
              className='relative h-2 w-full overflow-visible rounded-full bg-accent/30'
              style={{ pointerEvents: 'auto' }}
              onPointerMove={(e) => forwardHover(e.clientX, e.clientY)}
            >
              {/* Gap indicator - shows idle time before this span starts */}
              {gapBeforeMs > 5 && (
                <div
                  className='absolute h-full border-yellow-500/40 border-r border-l bg-yellow-500/20'
                  style={{
                    left: `${Math.max(0, safeStartPercent - gapBeforePercent)}%`,
                    width: `${gapBeforePercent}%`,
                    zIndex: 4,
                  }}
                  title={`${gapBeforeMs.toFixed(0)}ms between blocks`}
                />
              )}

              {(() => {
                const providerTiming = (span as any).providerTiming
                const hasSegs =
                  Array.isArray(providerTiming?.segments) && providerTiming.segments.length > 0
                const type = String(span.type || '').toLowerCase()
                const colorizedTypes = new Set(['model', 'tool', 'api', 'function'])
                const baseColor =
                  !hasSegs && colorizedTypes.has(type) ? spanColor : 'rgba(148, 163, 184, 0.28)'
                const isFlatBase = colorizedTypes.has(type)
                return (
                  <div
                    className='absolute h-full'
                    style={{
                      left: `${safeStartPercent}%`,
                      width: `${safeWidthPercent}%`,
                      backgroundColor: baseColor,
                      borderRadius: isFlatBase ? 0 : 9999,
                      zIndex: 5,
                    }}
                  />
                )
              })()}

              {/* Micro segments within the bar (model/tool/provider timing) */}
              {(() => {
                const providerTiming = (span as any).providerTiming
                const segments: Array<{
                  type: string
                  startTime: string | number
                  endTime: string | number
                  name?: string
                }> = []

                if (hasChildren) {
                  ;(span.children || [])
                    .filter((c) => c.type === 'model' || c.type === 'tool')
                    .forEach((c) =>
                      segments.push({
                        type: c.type,
                        startTime: c.startTime,
                        endTime: c.endTime,
                        name: c.name,
                      })
                    )
                } else if (providerTiming?.segments && Array.isArray(providerTiming.segments)) {
                  providerTiming.segments.forEach((seg: any) =>
                    segments.push({
                      type: seg.type || 'segment',
                      startTime: seg.startTime,
                      endTime: seg.endTime,
                      name: seg.name,
                    })
                  )
                }
                if (!segments.length || safeWidthPercent <= 0) return null

                return segments
                  .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                  .map((seg, index) => {
                    const startMs = new Date(seg.startTime).getTime()
                    const endMs = new Date(seg.endTime).getTime()
                    const segDuration = endMs - startMs

                    // Calculate position on the GLOBAL workflow timeline
                    // This ensures overlay segments align with their corresponding child rows
                    const segmentStartPercent =
                      totalDuration > 0 ? ((startMs - workflowStartTime) / totalDuration) * 100 : 0
                    const segmentWidthPercent =
                      totalDuration > 0 ? (segDuration / totalDuration) * 100 : 0

                    const color = seg.type === 'tool' ? getSpanColor('tool') : getSpanColor('model')

                    return (
                      <div
                        key={`${seg.type}-${index}`}
                        className='absolute h-full'
                        style={{
                          left: `${Math.max(0, Math.min(100, segmentStartPercent))}%`,
                          width: `${Math.max(0.1, Math.min(100, segmentWidthPercent))}%`,
                          backgroundColor: color,
                          zIndex: 6,
                        }}
                        title={`${seg.type}${seg.name ? `: ${seg.name}` : ''} - ${Math.round(segDuration)}ms`}
                      />
                    )
                  })
              })()}
              {/* Span-relative indicator removed; rely on global crosshair */}
              <div className='absolute inset-x-0 inset-y-[-12px] cursor-crosshair' />
            </div>
          </div>

          {/* Duration text - positioned absolutely to the right */}
          <span className='absolute right-3.5 w-[65px] flex-shrink-0 text-right font-mono text-muted-foreground text-xs tabular-nums'>
            {`${duration}ms`}
          </span>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div>
          {/* Block Input/Output Data - Collapsible */}
          {(span.input || span.output) && (
            <CollapsibleInputOutput span={span} spanId={spanId} depth={depth} />
          )}

          {/* Children and tool calls */}
          {/* Render child spans */}
          {hasChildren && (
            <div>
              {span.children?.map((childSpan, index) => {
                const enrichedChildSpan = normalizeChildWorkflowSpan(childSpan)

                const childHasSubItems = Boolean(
                  (enrichedChildSpan.children && enrichedChildSpan.children.length > 0) ||
                    (enrichedChildSpan.toolCalls && enrichedChildSpan.toolCalls.length > 0) ||
                    enrichedChildSpan.input ||
                    enrichedChildSpan.output
                )

                // Calculate gap from previous sibling child span
                let childGapMs = 0
                let childGapPercent = 0
                if (index > 0 && span.children) {
                  const prevChild = span.children[index - 1]
                  const prevEndTime = new Date(prevChild.endTime).getTime()
                  const currentStartTime = new Date(enrichedChildSpan.startTime).getTime()
                  childGapMs = currentStartTime - prevEndTime
                  if (childGapMs > 0 && totalDuration > 0) {
                    childGapPercent = (childGapMs / totalDuration) * 100
                  }
                }

                return (
                  <TraceSpanItem
                    key={index}
                    span={enrichedChildSpan}
                    depth={depth + 1}
                    totalDuration={totalDuration}
                    isLast={index === (span.children?.length || 0) - 1}
                    parentStartTime={spanStartTime}
                    workflowStartTime={workflowStartTime}
                    onToggle={onToggle}
                    expandedSpans={expandedSpans}
                    hasSubItems={childHasSubItems}
                    forwardHover={forwardHover}
                    gapBeforeMs={childGapMs}
                    gapBeforePercent={childGapPercent}
                    showRelativeChip={chipVisibility.relative}
                    chipVisibility={chipVisibility}
                  />
                )
              })}
            </div>
          )}

          {/* Render tool calls as spans */}
          {hasToolCalls && (
            <div>
              {span.toolCalls?.map((toolCall, index) => {
                // Create a pseudo-span for each tool call
                const toolStartTime = toolCall.startTime
                  ? new Date(toolCall.startTime).getTime()
                  : spanStartTime
                const toolEndTime = toolCall.endTime
                  ? new Date(toolCall.endTime).getTime()
                  : toolStartTime + (toolCall.duration || 0)

                const toolSpan: TraceSpan = {
                  id: `${spanId}-tool-${index}`,
                  name: toolCall.name,
                  type: 'tool',
                  duration: toolCall.duration || toolEndTime - toolStartTime,
                  startTime: new Date(toolStartTime).toISOString(),
                  endTime: new Date(toolEndTime).toISOString(),
                  status: toolCall.error ? 'error' : 'success',
                  // Include tool call arguments as input and result as output
                  input: toolCall.input,
                  output: toolCall.error
                    ? { error: toolCall.error, ...(toolCall.output || {}) }
                    : toolCall.output,
                }

                // Tool calls now have input/output data to display
                const hasToolCallData = Boolean(toolCall.input || toolCall.output || toolCall.error)

                return (
                  <TraceSpanItem
                    key={`tool-${index}`}
                    span={toolSpan}
                    depth={depth + 1}
                    totalDuration={totalDuration}
                    isLast={index === (span.toolCalls?.length || 0) - 1}
                    parentStartTime={spanStartTime}
                    workflowStartTime={workflowStartTime}
                    onToggle={onToggle}
                    expandedSpans={expandedSpans}
                    hasSubItems={hasToolCallData}
                    forwardHover={forwardHover}
                    showRelativeChip={chipVisibility.relative}
                    chipVisibility={chipVisibility}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
