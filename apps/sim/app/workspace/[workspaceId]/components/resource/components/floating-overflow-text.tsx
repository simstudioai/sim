'use client'

import type React from 'react'
import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/core/utils/cn'

const FLOATING_TOOLTIP_OFFSET = 16
const FLOATING_TOOLTIP_EDGE_GUTTER = 16
const FLOATING_TOOLTIP_EDGE_THRESHOLD = 360

interface FloatingOverflowTextProps {
  label: string
  children?: React.ReactNode
  className?: string
  showWhen?: boolean
}

interface FloatingTooltipState {
  visible: boolean
  x: number
  y: number
  skew: number
  scaleX: number
  scaleY: number
  alignX: 'left' | 'right'
  alignY: 'above' | 'below'
}

interface PointerSnapshot {
  x: number
  y: number
  time: number
}

export const FloatingOverflowText = memo(function FloatingOverflowText({
  label,
  children,
  className,
  showWhen,
}: FloatingOverflowTextProps) {
  const textRef = useRef<HTMLSpanElement>(null)
  const lastPointerRef = useRef<PointerSnapshot | null>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [tooltipState, setTooltipState] = useState<FloatingTooltipState>({
    visible: false,
    x: 0,
    y: 0,
    skew: 0,
    scaleX: 1,
    scaleY: 1,
    alignX: 'left',
    alignY: 'below',
  })

  useEffect(() => {
    const element = textRef.current
    if (!element) return

    const updateOverflowState = () => {
      setIsOverflowing(isTextClipped(element))
    }

    updateOverflowState()

    const resizeObserver = new ResizeObserver(updateOverflowState)
    resizeObserver.observe(element)
    window.addEventListener('resize', updateOverflowState)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateOverflowState)
    }
  }, [])

  const canShowTooltip = (element: HTMLSpanElement | null) => {
    if (!element || label.length === 0) return false
    return Boolean(showWhen) || isTextClipped(element)
  }

  const handleTooltipMove = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (!canShowTooltip(textRef.current)) return

    const now = performance.now()
    const previous = lastPointerRef.current
    const elapsed = previous ? Math.max(now - previous.time, 16) : 16
    const velocityX = previous ? ((event.clientX - previous.x) / elapsed) * 16 : 0
    const velocityY = previous ? ((event.clientY - previous.y) / elapsed) * 16 : 0
    const velocity = Math.hypot(velocityX, velocityY)
    const position = getFloatingTooltipPosition(event.clientX, event.clientY)

    lastPointerRef.current = { x: event.clientX, y: event.clientY, time: now }
    setTooltipState({
      visible: true,
      ...position,
      skew: clamp(velocityX * 0.11, -6, 6),
      scaleX: 1 + Math.min(0.035, velocity / 1100),
      scaleY: 1 - Math.min(0.02, velocity / 1500),
    })
  }

  const showTooltip = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (!canShowTooltip(textRef.current)) return
    const position = getFloatingTooltipPosition(event.clientX, event.clientY)
    lastPointerRef.current = { x: event.clientX, y: event.clientY, time: performance.now() }
    setIsOverflowing(true)
    setTooltipState({
      visible: true,
      ...position,
      skew: 0,
      scaleX: 1,
      scaleY: 1,
    })
  }

  const showTooltipFromFocus = (event: React.FocusEvent<HTMLSpanElement>) => {
    if (!canShowTooltip(textRef.current)) return
    const rect = event.currentTarget.getBoundingClientRect()
    const position = getFloatingTooltipPosition(rect.left + rect.width / 2, rect.bottom)
    lastPointerRef.current = null
    setIsOverflowing(true)
    setTooltipState({
      visible: true,
      ...position,
      skew: 0,
      scaleX: 1,
      scaleY: 1,
    })
  }

  const hideTooltip = () => {
    lastPointerRef.current = null
    setTooltipState((current) => ({ ...current, visible: false, skew: 0, scaleX: 1, scaleY: 1 }))
  }

  return (
    <>
      <span
        ref={textRef}
        className={cn(
          'min-w-0',
          isOverflowing &&
            '[mask-image:linear-gradient(to_right,black_calc(100%-18px),transparent)] hover:[mask-image:none] focus-visible:[mask-image:none]',
          className
        )}
        onPointerEnter={showTooltip}
        onPointerMove={handleTooltipMove}
        onPointerLeave={hideTooltip}
        onPointerDown={hideTooltip}
        onFocus={showTooltipFromFocus}
        onBlur={hideTooltip}
      >
        {children ?? label}
      </span>
      <FloatingTooltip label={label} state={tooltipState} />
    </>
  )
})

function FloatingTooltip({ label, state }: { label: string; state: FloatingTooltipState }) {
  if (typeof document === 'undefined' || !state.visible) return null

  return createPortal(
    <div
      aria-hidden='true'
      className={cn(
        'pointer-events-none fixed top-0 left-0 z-[var(--z-tooltip)] w-fit max-w-[min(16rem,calc(100vw-2rem))] rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[var(--text-body)] text-xs opacity-100 shadow-sm transition-[opacity,filter,transform] duration-150 ease-out',
        'motion-reduce:transition-none'
      )}
      style={{
        transform: `${getFloatingTooltipTranslate(state)} skew(${state.skew}deg) scale(${state.scaleX}, ${state.scaleY})`,
        transformOrigin: state.alignX === 'left' ? '12px 12px' : 'calc(100% - 12px) 12px',
      }}
    >
      <span className='block whitespace-normal break-words text-left leading-[18px]'>{label}</span>
    </div>,
    document.body
  )
}

function isTextClipped(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth + 1
}

function getFloatingTooltipPosition(
  clientX: number,
  clientY: number
): Pick<FloatingTooltipState, 'x' | 'y' | 'alignX' | 'alignY'> {
  if (typeof window === 'undefined') {
    return { x: clientX, y: clientY, alignX: 'left', alignY: 'below' }
  }

  const alignX = window.innerWidth - clientX < FLOATING_TOOLTIP_EDGE_THRESHOLD ? 'right' : 'left'
  const alignY =
    window.innerHeight - clientY < FLOATING_TOOLTIP_EDGE_THRESHOLD / 2 ? 'above' : 'below'

  return {
    x: clamp(
      clientX,
      FLOATING_TOOLTIP_EDGE_GUTTER,
      window.innerWidth - FLOATING_TOOLTIP_EDGE_GUTTER
    ),
    y: clamp(
      clientY,
      FLOATING_TOOLTIP_EDGE_GUTTER,
      window.innerHeight - FLOATING_TOOLTIP_EDGE_GUTTER
    ),
    alignX,
    alignY,
  }
}

function getFloatingTooltipTranslate(state: FloatingTooltipState): string {
  const xOffset =
    state.alignX === 'left'
      ? `${FLOATING_TOOLTIP_OFFSET}px`
      : `calc(-100% - ${FLOATING_TOOLTIP_OFFSET}px)`
  const yOffset =
    state.alignY === 'below'
      ? `${FLOATING_TOOLTIP_OFFSET}px`
      : `calc(-100% - ${FLOATING_TOOLTIP_OFFSET}px)`

  return `translate3d(${state.x}px, ${state.y}px, 0) translate(${xOffset}, ${yOffset})`
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
