'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Code, Cpu, ExternalLink } from 'lucide-react'
import {
  AgentIcon,
  ApiIcon,
  ChartBarIcon,
  CodeIcon,
  ConditionalIcon,
  ConnectIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import { TraceSpan } from '../../stores/types'

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
    return <div className="text-sm text-muted-foreground">No trace data available</div>
  }

  // Format total duration for better readability
  const formatTotalDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s (${ms}ms)`
  }

  // Find the earliest start time among all spans to be the workflow start time
  const workflowStartTime = traceSpans.reduce((earliest, span) => {
    const startTime = new Date(span.startTime).getTime()
    return startTime < earliest ? startTime : earliest
  }, Infinity)

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

  return (
    <div className="w-full">
      <div className="rounded-md border shadow-sm overflow-hidden">
        {traceSpans.map((span, index) => {
          const hasSubItems =
            (span.children && span.children.length > 0) ||
            (span.toolCalls && span.toolCalls.length > 0)
          return (
            <TraceSpanItem
              key={index}
              span={span}
              depth={0}
              totalDuration={totalDuration}
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

  // Calculate the position relative to the workflow start time (for Gantt chart style)
  const relativeStartPercent =
    totalDuration > 0 ? ((spanStartTime - workflowStartTime) / totalDuration) * 100 : 0
  const durationPercent = totalDuration > 0 ? (duration / totalDuration) * 100 : 0

  // Ensure values are within valid range
  const safeStartPercent = Math.min(100, Math.max(0, relativeStartPercent))
  const safeWidthPercent = Math.max(2, Math.min(100 - safeStartPercent, durationPercent))

  // For parent-relative timing display
  const startOffsetPercentage = totalDuration > 0 ? (startOffset / totalDuration) * 100 : 0

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
      return expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
    }

    // Block type specific icons
    if (type === 'agent') {
      return <AgentIcon className="h-3 w-3 text-[#802FFF]" />
    }

    if (type === 'evaluator') {
      return <ChartBarIcon className="h-3 w-3 text-[#2FA1FF]" />
    }

    if (type === 'condition') {
      return <ConditionalIcon className="h-3 w-3 text-[#FF972F]" />
    }

    if (type === 'router') {
      return <ConnectIcon className="h-3 w-3 text-[#2FA1FF]" />
    }

    if (type === 'model') {
      return <Cpu className="h-3 w-3 text-[#10a37f]" />
    }

    if (type === 'function') {
      return <CodeIcon className="h-3 w-3 text-[#FF402F]" />
    }

    if (type === 'tool') {
      return <ExternalLink className="h-3 w-3 text-[#f97316]" />
    }

    if (type === 'api') {
      return <ApiIcon className="h-3 w-3 text-[#2F55FF]" />
    }

    return <Code className="h-3 w-3 text-muted-foreground" />
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
    const modelMatch = spanName.match(/\(([\w\.-]+)\)/i)
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
            {modelName && <span className="text-xs opacity-75">({modelName})</span>}
          </>
        )
      } else if (span.name.includes('(iteration')) {
        const iterMatch = span.name.match(/\(iteration (\d+)\)/)
        const iterNum = iterMatch ? iterMatch[1] : ''
        return (
          <>
            Model response{' '}
            {iterNum && <span className="text-xs opacity-75">(iteration {iterNum})</span>}{' '}
            {modelName && <span className="text-xs opacity-75">({modelName})</span>}
          </>
        )
      } else if (span.name.includes('Model Generation')) {
        return (
          <>
            Model Generation{' '}
            {modelName && <span className="text-xs opacity-75">({modelName})</span>}
          </>
        )
      }
    }

    return span.name
  }

  return (
    <div
      className={cn(
        'border-b last:border-b-0 transition-colors',
        expanded ? 'bg-accent/30' : 'hover:bg-accent/20'
      )}
    >
      {/* Span header */}
      <div
        className={cn(
          'flex items-center py-1.5 px-2',
          hasNestedItems ? 'cursor-pointer' : 'cursor-default'
        )}
        onClick={handleSpanClick}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <div className="mr-2 flex-shrink-0 flex items-center justify-center w-5">
          {getSpanIcon()}
        </div>

        <div className="flex-1 flex items-center min-w-0 overflow-hidden gap-2">
          <div className="min-w-0 overflow-hidden flex-shrink">
            <div className="flex items-center space-x-2 mb-0.5">
              <span
                className={cn(
                  'text-sm font-medium truncate',
                  span.status === 'error' && 'text-red-500'
                )}
              >
                {formatSpanName(span)}
              </span>
              {depth > 0 && (
                <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                  {span.relativeStartMs !== undefined
                    ? `+${span.relativeStartMs}ms`
                    : formatRelativeTime(startOffset)}
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground block">{formatDuration(duration)}</span>
          </div>

          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            {/* Timeline visualization - responsive width based on container size */}
            <div className="h-2 bg-accent/40 rounded-full overflow-hidden relative flex-shrink-0 hidden sm:block sm:w-16 md:w-24 lg:w-32 xl:w-40">
              <div
                className="h-full rounded-full absolute"
                style={{
                  left: `${safeStartPercent}%`,
                  width: `${safeWidthPercent}%`,
                  backgroundColor: spanColor,
                }}
              />
            </div>

            {/* Duration text - always show in ms */}
            <span className="text-xs text-muted-foreground w-[52px] text-right font-mono tabular-nums flex-shrink-0">
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
              {span.children!.map((childSpan, index) => {
                const childHasSubItems =
                  (childSpan.children && childSpan.children.length > 0) ||
                  (childSpan.toolCalls && childSpan.toolCalls.length > 0)

                return (
                  <TraceSpanItem
                    key={index}
                    span={childSpan}
                    depth={depth + 1}
                    totalDuration={totalDuration}
                    isLast={index === span.children!.length - 1}
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
              {span.toolCalls!.map((toolCall, index) => {
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
                    isLast={index === span.toolCalls!.length - 1}
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
