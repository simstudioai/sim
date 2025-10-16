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

  if (!traceSpans || traceSpans.length === 0) {
    return <div className='text-muted-foreground text-sm'>No trace data available</div>
  }

  const workflowStartTime = traceSpans.reduce((earliest, span) => {
    const startTime = new Date(span.startTime).getTime()
    return startTime < earliest ? startTime : earliest
  }, Number.POSITIVE_INFINITY)

  const workflowEndTime = traceSpans.reduce((latest, span) => {
    const endTime = span.endTime ? new Date(span.endTime).getTime() : 0
    return endTime > latest ? endTime : latest
  }, 0)

  const actualTotalDuration = workflowEndTime - workflowStartTime

  const handleSpanToggle = (spanId: string, expanded: boolean, hasSubItems: boolean) => {
    const newExpandedSpans = new Set(expandedSpans)
    if (expanded) {
      newExpandedSpans.add(spanId)
    } else {
      newExpandedSpans.delete(spanId)
    }
    setExpandedSpans(newExpandedSpans)

    if (onExpansionChange && hasSubItems) {
      onExpansionChange(newExpandedSpans.size > 0)
    }
  }

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

        {/* Time label for hover (keep top label, row lines render per-row) */}
        {hoveredPercent !== null && hoveredX !== null && (
          <div
            className='-translate-x-1/2 pointer-events-none absolute top-1 rounded bg-popover px-1.5 py-0.5 text-[10px] text-foreground shadow'
            style={{ left: hoveredX, zIndex: 20 }}
          >
            {formatDurationDisplay(Math.max(0, (hoveredWorkflowMs || 0) - workflowStartTime))}
          </div>
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
