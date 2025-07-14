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
import { cn, redactApiKeys } from '@/lib/utils'
import type { TraceSpan } from '../../stores/types'

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
}

function CollapsibleInputOutput({ span, spanId }: CollapsibleInputOutputProps) {
  const [inputExpanded, setInputExpanded] = useState(false)
  const [outputExpanded, setOutputExpanded] = useState(false)

  return (
    <div className='mt-2 mr-4 mb-4 ml-8 space-y-3 overflow-hidden'>
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
      return <span className='break-all text-green-700 dark:text-green-400'>"{value}"</span>
    }

    if (typeof value === 'number') {
      return <span className='text-blue-700 dark:text-blue-400'>{value}</span>
    }

    if (typeof value === 'boolean') {
      return <span className='text-purple-700 dark:text-purple-400'>{value.toString()}</span>
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return <span className='text-muted-foreground'>[]</span>
      return (
        <div className='space-y-1'>
          <span className='text-muted-foreground'>[</span>
          <div className='ml-4 space-y-1'>
            {value.map((item, index) => (
              <div key={index} className='flex min-w-0 gap-2'>
                <span className='flex-shrink-0 text-muted-foreground text-xs'>{index}:</span>
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
        <div className='space-y-1'>
          {entries.map(([objKey, objValue]) => (
            <div key={objKey} className='flex min-w-0 gap-2'>
              <span className='flex-shrink-0 font-medium text-orange-700 dark:text-orange-400'>
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
            <div className='space-y-1'>
              {Object.entries(transformedData)
                .filter(([key]) => key !== 'error' && key !== 'success')
                .map(([key, value]) => (
                  <div key={key} className='flex gap-2'>
                    <span className='font-medium text-orange-700 dark:text-orange-400'>{key}:</span>
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

export function TraceSpansDisplay({
  traceSpans,
  totalDuration = 0,
  onExpansionChange,
}: TraceSpansDisplayProps) {
  // Keep track of expanded spans
  const [expandedSpans, setExpandedSpans] = useState<Set<string>>(new Set())

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

  return (
    <div className='w-full'>
      <div className='mb-2 flex items-center justify-between'>
        <div className='font-medium text-muted-foreground text-xs'>Workflow Execution</div>
      </div>
      <div className='w-full overflow-hidden rounded-md border shadow-sm'>
        {traceSpans.map((span, index) => {
          const hasSubItems = Boolean(
            (span.children && span.children.length > 0) ||
              (span.toolCalls && span.toolCalls.length > 0) ||
              span.input ||
              span.output
          )
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

          <div className='ml-auto flex w-[40%] flex-shrink-0 items-center gap-2'>
            {/* Timeline visualization - responsive width based on container size */}
            <div className='relative hidden h-2 min-w-[15%] flex-1 flex-shrink-0 overflow-hidden rounded-full bg-accent/40 sm:block'>
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

      {/* Expanded content */}
      {expanded && (
        <div>
          {/* Block Input/Output Data - Collapsible */}
          {(span.input || span.output) && <CollapsibleInputOutput span={span} spanId={spanId} />}

          {/* Children and tool calls */}
          {/* Render child spans */}
          {hasChildren && (
            <div>
              {span.children?.map((childSpan, index) => {
                const childHasSubItems = Boolean(
                  (childSpan.children && childSpan.children.length > 0) ||
                    (childSpan.toolCalls && childSpan.toolCalls.length > 0) ||
                    childSpan.input ||
                    childSpan.output
                )

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
