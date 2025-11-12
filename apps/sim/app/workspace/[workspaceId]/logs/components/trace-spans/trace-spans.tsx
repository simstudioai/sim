'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import {
  formatDurationDisplay,
  normalizeChildWorkflowSpan,
  TraceSpanItem,
} from '@/app/workspace/[workspaceId]/logs/components/trace-spans'
import type { TraceSpan } from '@/stores/logs/filters/types'

interface TraceSpansProps {
  traceSpans?: TraceSpan[]
  totalDuration?: number
  onExpansionChange?: (expanded: boolean) => void
}

export function TraceSpans({ traceSpans, totalDuration = 0, onExpansionChange }: TraceSpansProps) {
  const [expandedSpans, setExpandedSpans] = useState<Set<string>>(new Set())
  const [typeFilters, setTypeFilters] = useState<Record<string, boolean>>({})
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [hoveredWorkflowMs, setHoveredWorkflowMs] = useState<number | null>(null)
  const [hoveredX, setHoveredX] = useState<number | null>(null)
  const [hoveredY, setHoveredY] = useState<number | null>(null)
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

  const workflowStartTime = useMemo(() => {
    if (!traceSpans || traceSpans.length === 0) return 0
    return traceSpans.reduce((earliest, span) => {
      const startTime = new Date(span.startTime).getTime()
      return startTime < earliest ? startTime : earliest
    }, Number.POSITIVE_INFINITY)
  }, [traceSpans])

  const workflowEndTime = useMemo(() => {
    if (!traceSpans || traceSpans.length === 0) return 0
    return traceSpans.reduce((latest, span) => {
      const endTime = span.endTime ? new Date(span.endTime).getTime() : 0
      return endTime > latest ? endTime : latest
    }, 0)
  }, [traceSpans])

  const actualTotalDuration = workflowEndTime - workflowStartTime

  const handleSpanToggle = useCallback(
    (spanId: string, expanded: boolean, hasSubItems: boolean) => {
      setExpandedSpans((prev) => {
        const newExpandedSpans = new Set(prev)
        if (expanded) {
          newExpandedSpans.add(spanId)
        } else {
          newExpandedSpans.delete(spanId)
        }
        return newExpandedSpans
      })

      if (onExpansionChange && hasSubItems) {
        onExpansionChange(!expandedSpans.has(spanId))
      }
    },
    [onExpansionChange, expandedSpans]
  )

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
        if (s?.toolCalls?.length) set.add('tool')
      }
    }
    visit(traceSpans)
    return Array.from(set).sort()
  }, [traceSpans])

  const effectiveTypeFilters = useMemo(() => {
    if (!availableTypes.length) return {}
    if (Object.keys(typeFilters).length === 0) {
      const all: Record<string, boolean> = {}
      availableTypes.forEach((t) => (all[t] = true))
      return all
    }
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
          if (s?.toolCalls?.length) next.add(`${id}-tools`)
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
          if (tl === 'workflow') return true
          return allowed.has(tl)
        })
        .map((s) => ({
          ...s,
          children: s.children ? filterTree(s.children) : undefined,
        }))
    return traceSpans ? filterTree(traceSpans) : []
  }, [traceSpans, effectiveTypeFilters])

  const handleTimelineHover = useCallback(
    (clientX: number, clientY: number, timelineRect: DOMRect) => {
      if (!containerRef.current) return
      const containerRect = containerRef.current.getBoundingClientRect()
      const clamped = Math.max(0, Math.min(1, (clientX - timelineRect.left) / timelineRect.width))

      setHoveredWorkflowMs(workflowStartTime + clamped * actualTotalDuration)
      setHoveredX(timelineRect.left + clamped * timelineRect.width - containerRect.left)
      setHoveredY(timelineRect.top - containerRect.top)
    },
    [actualTotalDuration, workflowStartTime]
  )

  const handleTimelineLeave = useCallback(() => {
    setHoveredWorkflowMs(null)
    setHoveredX(null)
    setHoveredY(null)
  }, [])

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const ro = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      const width = entries?.[0]?.contentRect?.width || el.clientWidth
      setContainerWidth(width)
    })
    ro.observe(el)
    setContainerWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Early return after all hooks are declared to comply with React's Rules of Hooks
  if (!traceSpans || traceSpans.length === 0) {
    return <div className='text-muted-foreground text-sm'>No trace data available</div>
  }

  return (
    <div className='relative w-full'>
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
      <div ref={containerRef} className='relative w-full overflow-hidden border shadow-sm'>
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
              onTimelineHover={handleTimelineHover}
              onTimelineLeave={handleTimelineLeave}
              gapBeforeMs={gapMs}
              gapBeforePercent={gapPercent}
              showRelativeChip={chipVisibility.relative}
              chipVisibility={chipVisibility}
            />
          )
        })}
      </div>

      {/* Time label for hover (positioned at top of timeline) */}
      {hoveredWorkflowMs !== null && hoveredX !== null && hoveredY !== null && (
        <div
          className='-translate-x-1/2 pointer-events-none absolute rounded border bg-popover px-1.5 py-0.5 font-mono text-[10px] text-foreground shadow-lg'
          style={{ left: hoveredX, top: hoveredY, zIndex: 20 }}
        >
          {formatDurationDisplay(Math.max(0, (hoveredWorkflowMs || 0) - workflowStartTime))}
        </div>
      )}
    </div>
  )
}
