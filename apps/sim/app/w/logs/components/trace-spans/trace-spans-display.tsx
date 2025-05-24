'use client'

import { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronDownSquare,
  ChevronRight,
  ChevronUpSquare,
  Code,
  Cpu,
  ExternalLink,
} from 'lucide-react'
import {
  AgentIcon,
  ApiIcon,
  ChartBarIcon,
  CodeIcon,
  ConditionalIcon,
  ConnectIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import type { TraceSpan } from '../../stores/types'

interface TraceSpansDisplayProps {
  traceSpans?: TraceSpan[]
  totalDuration?: number
  onExpansionChange?: (expanded: boolean) => void
}

export function TraceSpansDisplay({
  traceSpans,
  totalDuration = 0,
  onExpansionChange,
}: TraceSpansDisplayProps) {
  // Keep track of expanded spans
  const [expandedSpans, setExpandedSpans] = useState<Set<string>>(new Set())

  if (!traceSpans || traceSpans.length === 0) {
    return <div className='text-muted-foreground text-sm'>No trace data available</div>
  }

  // Format total duration for better readability
  const _formatTotalDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s (${ms}ms)`
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

  // Function to collect all span IDs recursively (for expand all functionality)
  const collectAllSpanIds = (spans: TraceSpan[]): string[] => {
    const ids: string[] = []

    const collectIds = (span: TraceSpan) => {
      const spanId = span.id || `span-${span.name}-${span.startTime}`
      ids.push(spanId)

      // Process children
      if (span.children && span.children.length > 0) {
        span.children.forEach(collectIds)
      }
    }

    spans.forEach(collectIds)
    return ids
  }

  const allSpanIds = useMemo(() => collectAllSpanIds(traceSpans), [traceSpans])

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

  // Handle expand all / collapse all
  const handleExpandAll = () => {
    const newExpandedSpans = new Set(allSpanIds)
    setExpandedSpans(newExpandedSpans)

    if (onExpansionChange) {
      onExpansionChange(true)
    }
  }

  const handleCollapseAll = () => {
    setExpandedSpans(new Set())

    if (onExpansionChange) {
      onExpansionChange(false)
    }
  }

  // Determine if all spans are currently expanded
  const allExpanded = allSpanIds.length > 0 && allSpanIds.every((id) => expandedSpans.has(id))

  return (
    <div className='w-full'>
      <div className='mb-2 flex items-center justify-between'>
        <div className='font-medium text-muted-foreground text-xs'>Trace Spans</div>
        <button
          onClick={allExpanded ? handleCollapseAll : handleExpandAll}
          className='flex items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground'
          title={allExpanded ? 'Collapse all spans' : 'Expand all spans'}
        >
          {allExpanded ? (
            <>
              <ChevronUpSquare className='h-3.5 w-3.5' />
              <span>Collapse</span>
            </>
          ) : (
            <>
              <ChevronDownSquare className='h-3.5 w-3.5' />
              <span>Expand</span>
            </>
          )}
        </button>
      </div>
      <div className='overflow-hidden rounded-md border shadow-sm'>
        {traceSpans.map((span, index) => {
          const hasSubItems =
            (span.children && span.children.length > 0) ||
            (span.toolCalls && span.toolCalls.length > 0)
          return (
            <TraceSpanItem
              key={index}
              span={span}
              depth={0}
              totalDuration={
                actualTotalDuration !== undefined ? actualTotalDuration : totalDuration
              }
              isLast={index === traceSpans.length - 1}
              parentStartTime={new Date(span.startTime).getTime()}
              workflowStartTime={workflowStartTime}
              onToggle={handleSpanToggle}
              expandedSpans={expandedSpans}
              hasSubItems={hasSubItems}
            />
          )
        })}
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
}: TraceSpanItemProps): React.ReactNode {
  const spanId = span.id || `span-${span.name}-${span.startTime}`
  const expanded = expandedSpans.has(spanId)
  const hasChildren = span.children && span.children.length > 0
  const hasToolCalls = span.toolCalls && span.toolCalls.length > 0
  const hasNestedItems = hasChildren || hasToolCalls

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

  // For parent-relative timing display
  const _startOffsetPercentage = totalDuration > 0 ? (startOffset / totalDuration) * 100 : 0

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
      return <AgentIcon className='h-3 w-3 text-[#802FFF]' />
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
        return '#802FFF' // Purple from AgentBlock
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
        const iterMatch = span.name.match(/\(iteration (\d+)\)/)
        const iterNum = iterMatch ? iterMatch[1] : ''
        return (
          <>
            Model response{' '}
            {iterNum && <span className='text-xs opacity-75'>(iteration {iterNum})</span>}{' '}
            {modelName && <span className='text-xs opacity-75'>({modelName})</span>}
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
        'border-b transition-colors last:border-b-0',
        expanded ? 'bg-accent/30' : 'hover:bg-accent/20'
      )}
    >
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
          <div className='min-w-0 flex-shrink overflow-hidden'>
            <div className='mb-0.5 flex items-center space-x-2'>
              <span
                className={cn(
                  'truncate font-medium text-sm',
                  span.status === 'error' && 'text-red-500'
                )}
              >
                {formatSpanName(span)}
              </span>
              {depth > 0 && (
                <span className='flex-shrink-0 whitespace-nowrap text-muted-foreground text-xs'>
                  {span.relativeStartMs !== undefined
                    ? `+${span.relativeStartMs}ms`
                    : formatRelativeTime(startOffset)}
                </span>
              )}
              {depth === 0 && (
                <span
                  className='flex-shrink-0 whitespace-nowrap text-muted-foreground text-xs'
                  title={`Start time: ${new Date(span.startTime).toLocaleTimeString()}`}
                >
                  {new Date(span.startTime).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                  })}
                </span>
              )}
            </div>
            <span className='block text-muted-foreground text-xs'>{formatDuration(duration)}</span>
          </div>

          <div className='ml-auto flex flex-shrink-0 items-center gap-2'>
            {/* Timeline visualization - responsive width based on container size */}
            <div className='relative hidden h-2 flex-shrink-0 overflow-hidden rounded-full bg-accent/40 sm:block sm:w-24 md:w-32 lg:w-40 xl:w-56'>
              <div
                className='absolute h-full rounded-full'
                style={{
                  left: `${safeStartPercent}%`,
                  width: `${safeWidthPercent}%`,
                  backgroundColor: spanColor,
                }}
                title={`Start: ${new Date(span.startTime).toISOString()}, End: ${new Date(span.endTime).toISOString()}, Duration: ${duration}ms`}
              />
            </div>

            {/* Duration text - always show in ms */}
            <span className='w-[65px] flex-shrink-0 text-right font-mono text-muted-foreground text-xs tabular-nums'>
              {`${duration}ms`}
            </span>
          </div>
        </div>
      </div>

      {/* Children and tool calls */}
      {expanded && (
        <div>
          {/* Render child spans */}
          {hasChildren && (
            <div>
              {span.children?.map((childSpan, index) => {
                const childHasSubItems =
                  (childSpan.children && childSpan.children.length > 0) ||
                  (childSpan.toolCalls && childSpan.toolCalls.length > 0)

                return (
                  <TraceSpanItem
                    key={index}
                    span={childSpan}
                    depth={depth + 1}
                    totalDuration={totalDuration}
                    isLast={index === (span.children?.length || 0) - 1}
                    parentStartTime={spanStartTime}
                    workflowStartTime={workflowStartTime}
                    onToggle={onToggle}
                    expandedSpans={expandedSpans}
                    hasSubItems={childHasSubItems}
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
                }

                // Tool calls typically don't have sub-items
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
                    hasSubItems={false}
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
