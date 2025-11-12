import type React from 'react'
import { useState } from 'react'
import { ChevronDown, ChevronRight, Code, Cpu, ExternalLink } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import {
  AgentIcon,
  ApiIcon,
  ChartBarIcon,
  CodeIcon,
  ConditionalIcon,
  ConnectIcon,
} from '@/components/icons'
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
  onTimelineHover?: (clientX: number, clientY: number, rect: DOMRect) => void
  onTimelineLeave?: () => void
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
  onTimelineHover,
  onTimelineLeave,
  gapBeforeMs = 0,
  gapBeforePercent = 0,
  showRelativeChip = true,
  chipVisibility = { model: true, toolProvider: true, tokens: true, cost: true, relative: true },
}: TraceSpanItemProps): React.ReactNode {
  const [localHoveredPercent, setLocalHoveredPercent] = useState<number | null>(null)
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
    if (type === 'model') return <Cpu className='h-3 w-3 text-[var(--brand-primary-hover-hex)]' />
    if (type === 'function') return <CodeIcon className='h-3 w-3 text-[#FF402F]' />
    if (type === 'tool') {
      const toolId = String(span.name || '')
      const parts = toolId.split('_')
      for (let i = parts.length; i > 0; i--) {
        const candidate = parts.slice(0, i).join('_')
        const block = getBlock(candidate)
        if (block?.icon) {
          const Icon = block.icon as React.ComponentType<{
            className?: string
            style?: React.CSSProperties
          }>
          const color = (block as { bgColor?: string }).bgColor || '#f97316'
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
        return 'var(--brand-primary-hover-hex)' // Same purple as agent
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

  // Prefer registry-provided block color; fallback to legacy per-type colors
  const getBlockColor = (type: string) => {
    try {
      const block = getBlock(type)
      const color = (block as { bgColor?: string } | null)?.bgColor
      if (color) return color as string
    } catch {}
    return getSpanColor(type)
  }
  const spanColor = getBlockColor(span.type)

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

  // Utilities: soften block colors so they are less harsh in light mode and visible in dark mode
  const hexToRgb = (hex: string) => {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    if (!m) return null
    return {
      r: Number.parseInt(m[1], 16),
      g: Number.parseInt(m[2], 16),
      b: Number.parseInt(m[3], 16),
    }
  }

  const rgbToHex = (r: number, g: number, b: number) =>
    `#${[r, g, b]
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')}`

  const softenColor = (hex: string, isDark: boolean, factor = 0.22) => {
    const rgb = hexToRgb(hex)
    if (!rgb) return hex
    // Blend toward white a bit to reduce harshness and increase visibility in dark mode
    const t = isDark ? factor : factor + 0.08
    const r = rgb.r + (255 - rgb.r) * t
    const g = rgb.g + (255 - rgb.g) * t
    const b = rgb.b + (255 - rgb.b) * t
    return rgbToHex(r, g, b)
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
              {chipVisibility.model && span.model && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <span className='inline-flex cursor-default items-center gap-1 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums'>
                      {(() => {
                        const model = String(span.model) || ''
                        const IconComp = getProviderIcon(model) as React.ComponentType<{
                          className?: string
                        }> | null
                        return IconComp ? <IconComp className='h-3 w-3' /> : null
                      })()}
                      {String(span.model)}
                    </span>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>Model</Tooltip.Content>
                </Tooltip.Root>
              )}
              {chipVisibility.toolProvider &&
                span.type === 'tool' &&
                (() => {
                  const raw = String(span.name || '')
                  const parts = raw.split('_')
                  let block: ReturnType<typeof getBlock> | null = null
                  for (let i = parts.length; i > 0; i--) {
                    const candidate = parts.slice(0, i).join('_')
                    const b = getBlock(candidate)
                    if (b) {
                      block = b
                      break
                    }
                  }
                  if (!block?.icon) return null
                  const Icon = block.icon as React.ComponentType<{ className?: string }>
                  return (
                    <span className='inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground'>
                      <Icon className='h-3 w-3 text-muted-foreground' />
                    </span>
                  )
                })()}
              {chipVisibility.tokens && span.tokens && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <span className='cursor-default rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums'>
                      {(() => {
                        const t = span.tokens
                        const total =
                          typeof t === 'number' ? t : (t.total ?? (t.input || 0) + (t.output || 0))
                        return `T:${total}`
                      })()}
                    </span>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>
                    {(() => {
                      const t = span.tokens
                      if (typeof t === 'number') return <span>{t} tokens</span>
                      const hasIn = typeof t.input === 'number'
                      const hasOut = typeof t.output === 'number'
                      const input = hasIn ? t.input : undefined
                      const output = hasOut ? t.output : undefined
                      const total =
                        t.total ?? (hasIn && hasOut ? (t.input || 0) + (t.output || 0) : undefined)

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
                  </Tooltip.Content>
                </Tooltip.Root>
              )}
              {chipVisibility.cost && span.cost?.total !== undefined && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <span className='cursor-default rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums'>
                      {(() => {
                        try {
                          const { formatCost } = require('@/providers/utils')
                          return formatCost(Number(span.cost.total) || 0)
                        } catch {
                          return `$${Number.parseFloat(String(span.cost.total)).toFixed(4)}`
                        }
                      })()}
                    </span>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>
                    {(() => {
                      const c = span.cost || {}
                      const input = typeof c.input === 'number' ? c.input : undefined
                      const output = typeof c.output === 'number' ? c.output : undefined
                      const total =
                        typeof c.total === 'number'
                          ? c.total
                          : typeof input === 'number' && typeof output === 'number'
                            ? input + output
                            : undefined
                      let formatCostFn: (v: number) => string = (v: number) =>
                        `$${Number(v).toFixed(4)}`
                      try {
                        formatCostFn = require('@/providers/utils').formatCost as (
                          v: number
                        ) => string
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
                  </Tooltip.Content>
                </Tooltip.Root>
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
              className='relative h-2 w-full overflow-hidden bg-accent/30'
              style={{ pointerEvents: 'auto' }}
              onPointerMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                const clamped = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                setLocalHoveredPercent(clamped * 100)
                onTimelineHover?.(e.clientX, e.clientY, rect)
              }}
              onPointerLeave={() => {
                setLocalHoveredPercent(null)
                onTimelineLeave?.()
              }}
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
                const providerTiming = span.providerTiming
                const hasSegs =
                  Array.isArray(providerTiming?.segments) && providerTiming.segments.length > 0
                const type = String(span.type || '').toLowerCase()
                const isDark =
                  typeof document !== 'undefined' &&
                  document.documentElement.classList.contains('dark')
                // Base rail: keep workflow neutral so overlays stand out; otherwise use block color
                const neutralRail = isDark
                  ? 'rgba(148, 163, 184, 0.28)'
                  : 'rgba(148, 163, 184, 0.32)'
                const baseColor = type === 'workflow' ? neutralRail : softenColor(spanColor, isDark)
                return (
                  <div
                    className='absolute h-full'
                    style={{
                      left: `${safeStartPercent}%`,
                      width: `${safeWidthPercent}%`,
                      backgroundColor: baseColor,
                      zIndex: 5,
                    }}
                  />
                )
              })()}

              {(() => {
                const spanType = String(span.type || '').toLowerCase()
                if (spanType !== 'workflow' && spanType !== 'agent') return null
                const children = (span.children || []) as TraceSpan[]
                if (!children.length) return null
                const overlay = children
                  .filter(
                    (c) => c.type !== 'model' && c.name?.toLowerCase() !== 'streaming response'
                  )
                  .map((c) => ({
                    startMs: new Date(c.startTime).getTime(),
                    endMs: new Date(c.endTime).getTime(),
                    type: String(c.type || ''),
                    name: c.name || '',
                  }))
                  .sort((a, b) => a.startMs - b.startMs)

                if (!overlay.length) return null

                const render: React.ReactNode[] = []
                const isDark = document?.documentElement?.classList?.contains('dark') ?? false
                const msToPercent = (ms: number) =>
                  totalDuration > 0 ? (ms / totalDuration) * 100 : 0

                for (let i = 0; i < overlay.length; i++) {
                  const seg = overlay[i]
                  const prevEnd = i > 0 ? overlay[i - 1].endMs : undefined
                  // Render gap between previous and current overlay segment (like in row-level spans)
                  if (prevEnd && seg.startMs - prevEnd > 5) {
                    const gapStartPercent = msToPercent(prevEnd - workflowStartTime)
                    const gapWidthPercent = msToPercent(seg.startMs - prevEnd)
                    render.push(
                      <div
                        key={`wf-gap-${i}`}
                        className='absolute h-full border-yellow-500/40 border-r border-l bg-yellow-500/20'
                        style={{
                          left: `${Math.max(0, Math.min(100, gapStartPercent))}%`,
                          width: `${Math.max(0.1, Math.min(100, gapWidthPercent))}%`,
                          zIndex: 8,
                        }}
                        title={`${Math.round(seg.startMs - prevEnd)}ms between blocks`}
                      />
                    )
                  }

                  const segStartPercent = msToPercent(seg.startMs - workflowStartTime)
                  const segWidthPercent = msToPercent(seg.endMs - seg.startMs)
                  const childColor = softenColor(getBlockColor(seg.type), isDark, 0.18)
                  render.push(
                    <div
                      key={`wfseg-${i}`}
                      className='absolute h-full'
                      style={{
                        left: `${Math.max(0, Math.min(100, segStartPercent))}%`,
                        width: `${Math.max(0.1, Math.min(100, segWidthPercent))}%`,
                        backgroundColor: childColor,
                        opacity: 1,
                        zIndex: 6,
                      }}
                      title={`${seg.type}${seg.name ? `: ${seg.name}` : ''} - ${Math.round(
                        seg.endMs - seg.startMs
                      )}ms`}
                    />
                  )
                }

                return render
              })()}

              {(() => {
                const providerTiming = span.providerTiming
                const segments: Array<{
                  type: string
                  startTime: string | number
                  endTime: string | number
                  name?: string
                }> = []

                const isWorkflow = String(span.type || '').toLowerCase() === 'workflow'

                // For workflow rows, avoid duplicating model/streaming info on the base rail –
                // those are already represented inside Agent. Only show provider timing if present.
                if (
                  !hasChildren &&
                  providerTiming?.segments &&
                  Array.isArray(providerTiming.segments)
                ) {
                  providerTiming.segments.forEach((seg) =>
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
              {localHoveredPercent != null && (
                <div
                  className='pointer-events-none absolute inset-y-0 w-px bg-black/30 dark:bg-gray-600'
                  style={{
                    left: `${Math.max(0, Math.min(100, localHoveredPercent))}%`,
                    zIndex: 12,
                  }}
                />
              )}
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
                    onTimelineHover={onTimelineHover}
                    onTimelineLeave={onTimelineLeave}
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
                    onTimelineHover={onTimelineHover}
                    onTimelineLeave={onTimelineLeave}
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
