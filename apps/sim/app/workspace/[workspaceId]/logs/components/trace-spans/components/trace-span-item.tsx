import type React from 'react'
import { ChevronDown, ChevronRight, Code, Cpu, ExternalLink } from 'lucide-react'
import {
  AgentIcon,
  ApiIcon,
  ChartBarIcon,
  CodeIcon,
  ConditionalIcon,
  ConnectIcon,
} from '@/components/icons'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  CollapsibleInputOutput,
  normalizeChildWorkflowSpan,
} from '@/app/workspace/[workspaceId]/logs/components/trace-spans'
import { getBlock } from '@/blocks/registry'
import { getProviderIcon } from '@/providers/utils'
import type { TraceSpan } from '@/stores/logs/filters/types'
import { getTool } from '@/tools/utils'

interface TraceSpanItemProps {
  span: TraceSpan
  depth: number
  totalDuration: number
  isLast: boolean
  parentStartTime: number
  workflowStartTime: number
  onToggle: (spanId: string, expanded: boolean, hasSubItems: boolean) => void
  expandedSpans: Set<string>
  hasSubItems?: boolean
  hoveredPercent?: number | null
  hoveredWorkflowMs?: number | null
  forwardHover: (clientX: number, clientY: number) => void
  gapBeforeMs?: number
  gapBeforePercent?: number
  showRelativeChip?: boolean
  chipVisibility?: {
    model: boolean
    toolProvider: boolean
    tokens: boolean
    cost: boolean
    relative: boolean
  }
}

export function TraceSpanItem({
  span,
  depth,
  totalDuration,
  parentStartTime,
  workflowStartTime,
  onToggle,
  expandedSpans,
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

  const spanStartTime = new Date(span.startTime).getTime()
  const spanEndTime = new Date(span.endTime).getTime()
  const duration = span.duration || spanEndTime - spanStartTime
  const startOffset = spanStartTime - parentStartTime

  const relativeStartPercent =
    totalDuration > 0 ? ((spanStartTime - workflowStartTime) / totalDuration) * 100 : 0

  const actualDurationPercent = totalDuration > 0 ? (duration / totalDuration) * 100 : 0

  const safeStartPercent = Math.min(100, Math.max(0, relativeStartPercent))
  const safeWidthPercent = Math.max(2, Math.min(100 - safeStartPercent, actualDurationPercent))

  const handleSpanClick = () => {
    if (hasNestedItems) {
      onToggle(spanId, !expanded, hasNestedItems)
    }
  }

  const getSpanIcon = () => {
    const type = span.type.toLowerCase()
    if (hasNestedItems) {
      return expanded ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />
    }
    if (type === 'agent')
      return <AgentIcon className='h-3 w-3 text-[var(--brand-primary-hover-hex)]' />
    if (type === 'evaluator') return <ChartBarIcon className='h-3 w-3 text-[#2FA1FF]' />
    if (type === 'condition') return <ConditionalIcon className='h-3 w-3 text-[#FF972F]' />
    if (type === 'router') return <ConnectIcon className='h-3 w-3 text-[#2FA1FF]' />
    if (type === 'model') return <Cpu className='h-3 w-3 text-[#10a37f]' />
    if (type === 'function') return <CodeIcon className='h-3 w-3 text-[#FF402F]' />
    if (type === 'tool') {
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
    if (type === 'api') return <ApiIcon className='h-3 w-3 text-[#2F55FF]' />
    return <Code className='h-3 w-3 text-muted-foreground' />
  }

  const formatRelativeTime = (ms: number) => {
    if (ms === 0) return 'start'
    return `+${ms}ms`
  }

  const getSpanColor = (type: string) => {
    switch (type.toLowerCase()) {
      case 'agent':
        return 'var(--brand-primary-hover-hex)'
      case 'provider':
        return '#818cf8'
      case 'model':
        return '#10a37f'
      case 'function':
        return '#FF402F'
      case 'tool':
        return '#f97316'
      case 'router':
        return '#2FA1FF'
      case 'condition':
        return '#FF972F'
      case 'evaluator':
        return '#2FA1FF'
      case 'api':
        return '#2F55FF'
      default:
        return '#6b7280'
    }
  }

  const spanColor = getSpanColor(span.type)

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const extractModelName = (spanName: string) => {
    const modelMatch = spanName.match(/\(([\w.-]+)\)/i)
    return modelMatch ? modelMatch[1] : ''
  }

  const formatSpanName = (span: TraceSpan) => {
    if (span.type === 'tool') {
      const raw = String(span.name || '')
      const tool = getTool(raw)
      const displayName = (() => {
        if (tool?.name) return tool.name
        const parts = raw.split('_')
        const label = parts.slice(1).join(' ')
        if (label) {
          return label.replace(/\b\w/g, (c) => c.toUpperCase())
        }
        return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      })()
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
      {depth > 0 && (
        <div
          className='pointer-events-none absolute top-0 bottom-0 border-border/60 border-l'
          style={{ left: `${depth * 16 + 6}px` }}
        />
      )}
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

          <div
            className='absolute right-[73px] hidden h-full items-center sm:flex'
            style={{ width: 'calc(45% - 73px)', pointerEvents: 'none' }}
          >
            <div
              className='relative h-2 w-full overflow-visible rounded-full bg-accent/30'
              style={{ pointerEvents: 'auto' }}
              onPointerMove={(e) => forwardHover(e.clientX, e.clientY)}
            >
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
                const isDark =
                  typeof document !== 'undefined' &&
                  document.documentElement.classList.contains('dark')
                // Use a slightly stronger neutral in both modes; keep dark a bit lighter
                const neutralRail = isDark
                  ? 'rgba(148, 163, 184, 0.28)'
                  : 'rgba(148, 163, 184, 0.32)'
                const baseColor = !hasSegs && colorizedTypes.has(type) ? spanColor : neutralRail
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
              <div className='absolute inset-x-0 inset-y-[-12px] cursor-crosshair' />
            </div>
          </div>

          <span className='absolute right-3.5 w-[65px] flex-shrink-0 text-right font-mono text-muted-foreground text-xs tabular-nums'>
            {`${duration}ms`}
          </span>
        </div>
      </div>

      {expanded && (
        <div>
          {(span.input || span.output) && (
            <CollapsibleInputOutput span={span} spanId={spanId} depth={depth} />
          )}

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

          {hasToolCalls && (
            <div>
              {span.toolCalls?.map((toolCall, index) => {
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
                  input: toolCall.input,
                  output: toolCall.error
                    ? { error: toolCall.error, ...(toolCall.output || {}) }
                    : toolCall.output,
                }

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
