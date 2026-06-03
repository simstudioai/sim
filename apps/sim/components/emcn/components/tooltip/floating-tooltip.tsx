'use client'

import { memo, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/core/utils/cn'

const TOOLTIP_OFFSET = 16
const EDGE_GUTTER = 16
const EDGE_THRESHOLD = 360
const MIN_FRAME_MS = 16

/**
 * Resolved position and motion of a floating tooltip. `x`/`y` are viewport
 * coordinates the tooltip anchors to; `alignX`/`alignY` flip the tooltip away
 * from the nearest viewport edge; `skew`/`scale*` add the velocity-reactive
 * flourish while the pointer is moving.
 */
export interface FloatingTooltipState {
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

/**
 * Pointer/focus event handlers that drive a {@link useFloatingTooltip}. Spread
 * onto the element that should reveal the tooltip on hover or focus.
 */
export interface FloatingTooltipHandlers {
  onPointerEnter: (event: React.PointerEvent<HTMLElement>) => void
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void
  onPointerLeave: () => void
  onPointerDown: () => void
  onFocus: (event: React.FocusEvent<HTMLElement>) => void
  onBlur: () => void
}

const HIDDEN_STATE: FloatingTooltipState = {
  visible: false,
  x: 0,
  y: 0,
  skew: 0,
  scaleX: 1,
  scaleY: 1,
  alignX: 'left',
  alignY: 'below',
}

/**
 * Drives a pointer-reactive floating tooltip. `canShow` is queried on every
 * gesture with the event target, letting the caller gate the tooltip on its own
 * overflow measurement. Returns the current {@link FloatingTooltipState} to feed
 * a {@link FloatingTooltip} and a stable set of {@link FloatingTooltipHandlers}
 * to spread onto the trigger element.
 */
export function useFloatingTooltip(canShow: (target: HTMLElement) => boolean): {
  state: FloatingTooltipState
  handlers: FloatingTooltipHandlers
} {
  const canShowRef = useRef(canShow)
  canShowRef.current = canShow

  const lastPointerRef = useRef<PointerSnapshot | null>(null)
  const [state, setState] = useState<FloatingTooltipState>(HIDDEN_STATE)

  const handlers = useMemo<FloatingTooltipHandlers>(() => {
    const hide = () => {
      lastPointerRef.current = null
      setState((current) => (current.visible ? HIDDEN_STATE : current))
    }

    const showStatic = (clientX: number, clientY: number) => {
      lastPointerRef.current = { x: clientX, y: clientY, time: performance.now() }
      setState({
        visible: true,
        ...getTooltipPosition(clientX, clientY),
        skew: 0,
        scaleX: 1,
        scaleY: 1,
      })
    }

    return {
      onPointerEnter: (event) => {
        if (!canShowRef.current(event.currentTarget)) return
        showStatic(event.clientX, event.clientY)
      },
      onPointerMove: (event) => {
        if (!canShowRef.current(event.currentTarget)) return
        const now = performance.now()
        const previous = lastPointerRef.current
        const elapsed = previous ? Math.max(now - previous.time, MIN_FRAME_MS) : MIN_FRAME_MS
        const velocityX = previous ? ((event.clientX - previous.x) / elapsed) * MIN_FRAME_MS : 0
        const velocityY = previous ? ((event.clientY - previous.y) / elapsed) * MIN_FRAME_MS : 0
        const velocity = Math.hypot(velocityX, velocityY)

        lastPointerRef.current = { x: event.clientX, y: event.clientY, time: now }
        setState({
          visible: true,
          ...getTooltipPosition(event.clientX, event.clientY),
          skew: clamp(velocityX * 0.11, -6, 6),
          scaleX: 1 + Math.min(0.035, velocity / 1100),
          scaleY: 1 - Math.min(0.02, velocity / 1500),
        })
      },
      onPointerLeave: hide,
      onPointerDown: hide,
      onFocus: (event) => {
        const target = event.currentTarget
        if (!canShowRef.current(target)) return
        if (!isFocusVisible(target)) return
        const rect = target.getBoundingClientRect()
        lastPointerRef.current = null
        setState({
          visible: true,
          ...getTooltipPosition(rect.left + rect.width / 2, rect.bottom),
          skew: 0,
          scaleX: 1,
          scaleY: 1,
        })
      },
      onBlur: hide,
    }
  }, [])

  return { state, handlers }
}

/**
 * Tracks whether an element's text is horizontally clipped, re-measuring via a
 * `ResizeObserver` and window resizes.
 *
 * Returns a callback `ref` to attach to the element — the observer follows the
 * element across mount, unmount, and reassignment, so it is safe to use on
 * conditionally rendered children. `node` is a stable ref for reading the
 * current element (e.g. for live measurements in event handlers).
 */
export function useIsOverflowing<T extends HTMLElement = HTMLElement>(): {
  ref: (node: T | null) => void
  node: RefObject<T | null>
  isOverflowing: boolean
} {
  const [isOverflowing, setIsOverflowing] = useState(false)
  const nodeRef = useRef<T | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)

  const measure = useCallback(() => {
    const element = nodeRef.current
    if (element) setIsOverflowing(isTextClipped(element))
  }, [])

  const ref = useCallback(
    (node: T | null) => {
      observerRef.current?.disconnect()
      observerRef.current = null
      nodeRef.current = node
      if (!node) return

      measure()
      const observer = new ResizeObserver(measure)
      observer.observe(node)
      observerRef.current = observer
    },
    [measure]
  )

  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
      observerRef.current?.disconnect()
    }
  }, [measure])

  return { ref, node: nodeRef, isOverflowing }
}

/** Whether an element's content is wider than its visible box. */
export function isTextClipped(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth + 1
}

/** Clamps `value` to the inclusive `[min, max]` range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Whether an element currently matches `:focus-visible` (keyboard focus, not focus produced by a
 * mouse click). Used to keep the tooltip from re-appearing/repositioning when the trigger is
 * clicked. Falls back to `true` where the selector can't be queried.
 */
export function isFocusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible')
  } catch {
    return true
  }
}

/**
 * Portaled tooltip body positioned from a {@link FloatingTooltipState}. Renders
 * nothing while hidden or during SSR.
 */
export const FloatingTooltip = memo(function FloatingTooltip({
  label,
  children,
  state,
  className,
  role,
  id,
}: {
  /** Text shown when no `children` are provided (the overflow-tooltip case). */
  label?: string
  /** Arbitrary tooltip content; overrides `label` when provided (general tooltips). */
  children?: React.ReactNode
  state: FloatingTooltipState
  className?: string
  /** Set to `"tooltip"` for described/general tooltips; omit for decorative overflow tooltips. */
  role?: 'tooltip'
  /** Element id, used to wire `aria-describedby` on the trigger for general tooltips. */
  id?: string
}) {
  if (typeof document === 'undefined' || !state.visible) return null

  return createPortal(
    <div
      id={id}
      role={role}
      aria-hidden={role ? undefined : 'true'}
      className={cn(
        'pointer-events-none fixed top-0 left-0 z-[var(--z-tooltip)] w-fit max-w-[min(16rem,calc(100vw-2rem))] rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[var(--text-body)] text-caption opacity-100 shadow-sm transition-[opacity,filter,transform] duration-150 ease-out',
        'motion-reduce:transition-none',
        className
      )}
      style={{
        transform: `${getTooltipTranslate(state)} skew(${state.skew}deg) scale(${state.scaleX}, ${state.scaleY})`,
        transformOrigin: state.alignX === 'left' ? '12px 12px' : 'calc(100% - 12px) 12px',
      }}
    >
      {children ?? <span className='block whitespace-normal break-words text-left'>{label}</span>}
    </div>,
    document.body
  )
})

function getTooltipPosition(
  clientX: number,
  clientY: number
): Pick<FloatingTooltipState, 'x' | 'y' | 'alignX' | 'alignY'> {
  if (typeof window === 'undefined') {
    return { x: clientX, y: clientY, alignX: 'left', alignY: 'below' }
  }

  const alignX = window.innerWidth - clientX < EDGE_THRESHOLD ? 'right' : 'left'
  const alignY = window.innerHeight - clientY < EDGE_THRESHOLD / 2 ? 'above' : 'below'

  return {
    x: clamp(clientX, EDGE_GUTTER, window.innerWidth - EDGE_GUTTER),
    y: clamp(clientY, EDGE_GUTTER, window.innerHeight - EDGE_GUTTER),
    alignX,
    alignY,
  }
}

function getTooltipTranslate(state: FloatingTooltipState): string {
  const xOffset =
    state.alignX === 'left' ? `${TOOLTIP_OFFSET}px` : `calc(-100% - ${TOOLTIP_OFFSET}px)`
  const yOffset =
    state.alignY === 'below' ? `${TOOLTIP_OFFSET}px` : `calc(-100% - ${TOOLTIP_OFFSET}px)`

  return `translate3d(${state.x}px, ${state.y}px, 0) translate(${xOffset}, ${yOffset})`
}
