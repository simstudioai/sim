'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { cn, FloatingTooltip, useFloatingTooltip } from '@sim/emcn'
import { RUN_BUCKETS } from '@/app/(landing)/components/shared/logs-run-graph/constants'

const BUCKET_HEIGHTS = {
  3: 'h-[30%]',
  4: 'h-[40%]',
  5: 'h-1/2',
  6: 'h-[60%]',
  7: 'h-[70%]',
  8: 'h-[80%]',
  9: 'h-[90%]',
  10: 'h-full',
} as const

/** Matches the bubble's fixed width so either viewport edge can constrain its anchor. */
const TOOLTIP_WIDTH = 176
const TOOLTIP_OFFSET = 10
const VIEWPORT_GUTTER = 16

interface LogsRunGraphProps {
  layout?: 'menu' | 'card'
}

/** Hourly sample runs, explorable by hover, keyboard, or a tap that leaves the tooltip open. */
export function LogsRunGraph({ layout = 'menu' }: LogsRunGraphProps) {
  const graphRef = useRef<HTMLButtonElement>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const tooltipId = useId()
  const [activeIndex, setActiveIndex] = useState(0)
  const { state, handlers } = useFloatingTooltip(() => true, { preferAbove: true })
  const bucket = RUN_BUCKETS[activeIndex]
  const timeRange =
    bucket.hour === 23 ? 'Last hour' : `${24 - bucket.hour}–${23 - bucket.hour} hours ago`
  const tooltipState =
    state.visible && typeof window !== 'undefined'
      ? {
          ...state,
          x:
            state.alignX === 'right'
              ? Math.max(TOOLTIP_WIDTH + TOOLTIP_OFFSET + VIEWPORT_GUTTER, state.x)
              : Math.min(
                  window.innerWidth - TOOLTIP_WIDTH - TOOLTIP_OFFSET - VIEWPORT_GUTTER,
                  state.x
                ),
        }
      : state

  useEffect(() => {
    if (!state.visible) return
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !graphRef.current?.contains(event.target)) {
        handlers.onPointerLeave()
      }
    }
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('scroll', handlers.onPointerLeave, true)
    window.addEventListener('resize', handlers.onPointerLeave)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('scroll', handlers.onPointerLeave, true)
      window.removeEventListener('resize', handlers.onPointerLeave)
    }
  }, [state.visible, handlers])

  return (
    <>
      <button
        ref={graphRef}
        type='button'
        data-run-overview-graph
        aria-label={`Hourly successful runs. ${timeRange}: ${bucket.count} succeeded. Use left and right arrows to explore.`}
        aria-describedby={state.visible ? tooltipId : undefined}
        className={cn(
          'pointer-events-auto flex w-full cursor-default items-end rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-[var(--text-icon)] focus-visible:outline-offset-4',
          layout === 'menu' ? 'mt-3 h-12 gap-0.5' : 'h-11 gap-[3px] pt-2.5 pb-[5px]'
        )}
        onMouseDown={(event) => event.preventDefault()}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') handlers.onPointerEnter(event)
        }}
        onPointerMove={(event) => {
          if (event.pointerType !== 'touch') handlers.onPointerMove(event)
        }}
        onPointerDown={(event) => {
          touchStartRef.current =
            event.pointerType === 'touch' ? { x: event.clientX, y: event.clientY } : null
          handlers.onPointerDown()
        }}
        onPointerUp={(event) => {
          const start = touchStartRef.current
          touchStartRef.current = null
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) {
            handlers.onPointerEnter(event)
          }
        }}
        onPointerCancel={() => {
          touchStartRef.current = null
          handlers.onPointerLeave()
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'touch') handlers.onPointerLeave()
        }}
        onFocus={handlers.onFocus}
        onBlur={handlers.onBlur}
        onKeyDown={(event) => {
          switch (event.key) {
            case 'ArrowLeft':
              setActiveIndex(Math.max(0, activeIndex - 1))
              break
            case 'ArrowRight':
              setActiveIndex(Math.min(RUN_BUCKETS.length - 1, activeIndex + 1))
              break
            case 'Home':
              setActiveIndex(0)
              break
            case 'End':
              setActiveIndex(RUN_BUCKETS.length - 1)
              break
            case 'Escape':
              handlers.onPointerLeave()
              break
            default:
              return
          }
          event.preventDefault()
        }}
      >
        {RUN_BUCKETS.map((item, index) => (
          <span
            key={item.hour}
            aria-hidden='true'
            data-run-count={item.count}
            className='flex h-full min-w-0 flex-1 items-end'
            onPointerEnter={() => setActiveIndex(index)}
            onPointerDown={() => setActiveIndex(index)}
          >
            <span
              data-run-bar
              className={cn(
                'block w-full rounded-[2px] bg-[var(--text-secondary)]',
                BUCKET_HEIGHTS[item.count]
              )}
            />
          </span>
        ))}
      </button>
      <FloatingTooltip
        state={tooltipState}
        role='tooltip'
        id={tooltipId}
        offset={TOOLTIP_OFFSET}
        className='w-[176px]'
      >
        <div className='flex flex-col gap-1 whitespace-nowrap'>
          <span className='text-[var(--text-secondary)]'>{timeRange}</span>
          <span className='flex items-center gap-1.5 tabular-nums'>
            <span className='size-1.5 rounded-full bg-[var(--text-secondary)]' />
            {bucket.count} succeeded
            <span className='text-[var(--text-secondary)]'>·</span>$
            {(bucket.count * 0.11).toFixed(2)}
          </span>
        </div>
      </FloatingTooltip>
    </>
  )
}
