'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'
import { TOOLTIP_SURFACE_CLASS } from './tooltip-styles'

const TOOLTIP_OFFSET = 16
const EDGE_GUTTER = 16
const EDGE_THRESHOLD = 360
const MIN_FRAME_MS = 16

/** How often a visible tooltip re-verifies that its trigger is still visibly rendered, in ms. */
const TRIGGER_VISIBILITY_INTERVAL_MS = 150

/**
 * Exponential time constant for smoothing the pointer velocity that drives the
 * flourish, in ms. The flourish is deliberately never handed to a CSS transition:
 * Chrome only re-rasters a layer at its new scale when the scale changes via
 * script, not when a declarative animation interpolates it, so a transitioned
 * fractional scale leaves the tooltip's text resampled from a stale bitmap until
 * the animation settles — which is what read as a blur on every appear.
 *
 * Smoothing here replaces the smoothing that transition used to provide. ~3x the
 * time constant is where the value has effectively settled, so 50ms reproduces
 * the feel of the 150ms ease-out it stands in for.
 */
const VELOCITY_TIME_CONSTANT_MS = 50

/**
 * Resolved position and motion of a floating tooltip. `x`/`y` are whole-pixel
 * viewport coordinates the tooltip anchors to; `alignX`/`alignY` flip the tooltip
 * away from the nearest viewport edge; `skew`/`scale*` add the velocity-reactive
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

/** Velocity-derived flourish applied to the tooltip on a given frame. */
interface TooltipMotion {
  skew: number
  scaleX: number
  scaleY: number
}

const NEUTRAL_MOTION: TooltipMotion = { skew: 0, scaleX: 1, scaleY: 1 }

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
  ...NEUTRAL_MOTION,
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
export interface UseFloatingTooltipOptions {
  /**
   * Prefer placing the bubble above the cursor. Still flips below when the
   * pointer is too close to the top of the viewport.
   */
  preferAbove?: boolean
}

export function useFloatingTooltip(
  canShow: (target: HTMLElement) => boolean,
  options: UseFloatingTooltipOptions = {}
): {
  state: FloatingTooltipState
  handlers: FloatingTooltipHandlers
} {
  const canShowRef = React.useRef(canShow)
  canShowRef.current = canShow
  const preferAboveRef = React.useRef(options.preferAbove === true)
  preferAboveRef.current = options.preferAbove === true

  const lastPointerRef = React.useRef<PointerSnapshot | null>(null)
  const velocityRef = React.useRef({ x: 0, magnitude: 0 })
  const triggerRef = React.useRef<HTMLElement | null>(null)
  const [state, setState] = React.useState<FloatingTooltipState>(HIDDEN_STATE)

  const reset = React.useCallback(() => {
    lastPointerRef.current = null
    velocityRef.current.x = 0
    velocityRef.current.magnitude = 0
  }, [])

  const hide = React.useCallback(() => {
    reset()
    triggerRef.current = null
    setState((current) => (current.visible ? HIDDEN_STATE : current))
  }, [reset])

  const handlers = React.useMemo<FloatingTooltipHandlers>(() => {
    const apply = (clientX: number, clientY: number, motion: TooltipMotion) => {
      const next = { ...getTooltipPosition(clientX, clientY, preferAboveRef.current), ...motion }
      setState((current) =>
        current.visible &&
        current.x === next.x &&
        current.y === next.y &&
        current.alignX === next.alignX &&
        current.alignY === next.alignY &&
        current.skew === next.skew &&
        current.scaleX === next.scaleX &&
        current.scaleY === next.scaleY
          ? current
          : { visible: true, ...next }
      )
    }

    /** Reveals the tooltip at the pointer, seeding velocity tracking from it. */
    const showFromPointer = (clientX: number, clientY: number) => {
      reset()
      lastPointerRef.current = { x: clientX, y: clientY, time: performance.now() }
      apply(clientX, clientY, NEUTRAL_MOTION)
    }

    /**
     * Reveals the tooltip anchored to an element's box rather than the pointer.
     * Velocity tracking stays cleared: seeding it from the box would make the next
     * `pointermove` read the box-to-cursor delta as velocity and spike the flourish
     * when the pointer already happens to be over the trigger.
     */
    const showFromElement = (clientX: number, clientY: number) => {
      reset()
      apply(clientX, clientY, NEUTRAL_MOTION)
    }

    return {
      onPointerEnter: (event) => {
        if (!canShowRef.current(event.currentTarget)) return
        triggerRef.current = event.currentTarget
        showFromPointer(event.clientX, event.clientY)
      },
      onPointerMove: (event) => {
        if (!canShowRef.current(event.currentTarget)) return
        triggerRef.current = event.currentTarget
        const now = performance.now()
        const previous = lastPointerRef.current
        const delta = previous ? Math.max(now - previous.time, 1) : MIN_FRAME_MS
        const perFrame = Math.max(delta, MIN_FRAME_MS)
        const instantX = previous ? ((event.clientX - previous.x) / perFrame) * MIN_FRAME_MS : 0
        const instantY = previous ? ((event.clientY - previous.y) / perFrame) * MIN_FRAME_MS : 0

        /**
         * Derived from the real elapsed time rather than applied per event, so a
         * 120Hz pointer and a 60Hz one settle over the same wall-clock duration.
         */
        const smoothing = 1 - Math.exp(-delta / VELOCITY_TIME_CONSTANT_MS)
        const velocity = velocityRef.current
        velocity.x += (instantX - velocity.x) * smoothing
        velocity.magnitude += (Math.hypot(instantX, instantY) - velocity.magnitude) * smoothing

        lastPointerRef.current = { x: event.clientX, y: event.clientY, time: now }
        apply(event.clientX, event.clientY, {
          skew: quantize(clamp(velocity.x * 0.11, -6, 6)),
          scaleX: quantize(1 + Math.min(0.035, velocity.magnitude / 1100)),
          scaleY: quantize(1 - Math.min(0.02, velocity.magnitude / 1500)),
        })
      },
      onPointerLeave: hide,
      onPointerDown: hide,
      onFocus: (event) => {
        const target = event.currentTarget
        if (!canShowRef.current(target)) return
        if (!isFocusVisible(target)) return
        triggerRef.current = target
        const rect = target.getBoundingClientRect()
        /* Anchor on the edge the bubble grows away from, so a `preferAbove`
           tooltip measures from the trigger's top rather than its bottom. */
        showFromElement(rect.left + rect.width / 2, preferAboveRef.current ? rect.top : rect.bottom)
      },
      onBlur: hide,
    }
  }, [hide, reset])

  /**
   * A keyboard- or script-driven UI change can hide the trigger with no pointer or focus event —
   * browsers don't re-dispatch boundary events until the pointer next moves (e.g. an editor bubble
   * menu set to `visibility: hidden` by Cmd+A while a toolbar tooltip is open) — so while visible,
   * the tooltip re-verifies its trigger and dismisses itself once the trigger is gone or hidden.
   */
  React.useEffect(() => {
    if (!state.visible) return undefined
    const intervalId = window.setInterval(() => {
      const trigger = triggerRef.current
      if (!trigger || !isVisiblyRendered(trigger)) hide()
    }, TRIGGER_VISIBILITY_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [state.visible, hide])

  return { state, handlers }
}

const overflowMeasureByElement = new WeakMap<Element, () => void>()
const observedOverflowElements = new Set<Element>()
let sharedOverflowObserver: ResizeObserver | null = null

function observeOverflow(element: Element, measure: () => void): boolean {
  if (typeof ResizeObserver === 'undefined') return false
  sharedOverflowObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) overflowMeasureByElement.get(entry.target)?.()
  })
  overflowMeasureByElement.set(element, measure)
  observedOverflowElements.add(element)
  sharedOverflowObserver.observe(element)
  return true
}

function unobserveOverflow(element: Element | null) {
  if (!element) return
  sharedOverflowObserver?.unobserve(element)
  overflowMeasureByElement.delete(element)
  observedOverflowElements.delete(element)
  if (observedOverflowElements.size === 0) {
    sharedOverflowObserver?.disconnect()
    sharedOverflowObserver = null
  }
}

/**
 * Tracks whether an element's text is horizontally clipped, re-measuring via a
 * shared `ResizeObserver` (or window resizes when the API is unavailable).
 *
 * Returns a callback `ref` to attach to the element — the observer follows the
 * element across mount, unmount, and reassignment, so it is safe to use on
 * conditionally rendered children. `node` is a stable ref for reading the
 * current element (e.g. for live measurements in event handlers).
 */
export function useIsOverflowing<T extends HTMLElement = HTMLElement>(): {
  ref: (node: T | null) => void
  node: React.RefObject<T | null>
  isOverflowing: boolean
} {
  const [isOverflowing, setIsOverflowing] = React.useState(false)
  const nodeRef = React.useRef<T | null>(null)
  const usesResizeObserverRef = React.useRef(false)

  const measure = React.useCallback(() => {
    const element = nodeRef.current
    if (element) setIsOverflowing(isTextClipped(element))
  }, [])

  const ref = React.useCallback(
    (node: T | null) => {
      unobserveOverflow(nodeRef.current)
      nodeRef.current = node
      if (!node) return

      measure()
      usesResizeObserverRef.current = observeOverflow(node, measure)
    },
    [measure]
  )

  React.useEffect(() => {
    if (usesResizeObserverRef.current) return () => unobserveOverflow(nodeRef.current)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
      unobserveOverflow(nodeRef.current)
    }
  }, [measure])

  return { ref, node: nodeRef, isOverflowing }
}

/** Whether an element's content is wider than its visible box. */
export function isTextClipped(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth + 1
}

/**
 * Whether a tooltip trigger is still visibly rendered. `checkVisibility` (where available) catches
 * `display: none` and an inherited `visibility: hidden` anywhere up the tree. The fallback for
 * engines without it (Safari < 17.4, jsdom) reads the element's computed `visibility` — which
 * inherits from hidden ancestors — and then walks the ancestor chain for `display: none`, which
 * does not inherit. Computed styles, not layout (`getClientRects`/`offsetParent`), on purpose:
 * jsdom does no layout, so a layout-based check would misread every trigger as hidden in tests.
 */
function isVisiblyRendered(element: HTMLElement): boolean {
  if (!element.isConnected) return false
  if (typeof element.checkVisibility === 'function') {
    return element.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })
  }
  if (getComputedStyle(element).visibility === 'hidden') return false
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (getComputedStyle(node).display === 'none') return false
  }
  return true
}

/** Clamps `value` to the inclusive `[min, max]` range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Rounds a flourish value to 3 decimals so pointer jitter below the visible
 * threshold settles to a stable number instead of re-rendering every consumer.
 */
function quantize(value: number): number {
  return Math.round(value * 1000) / 1000
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
export const FloatingTooltip = React.memo(function FloatingTooltip({
  label,
  children,
  state,
  className,
  role,
  id,
  offset = TOOLTIP_OFFSET,
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
  /**
   * Cursor-to-bubble gap in px. Defaults to the standard 16; pass a smaller
   * value where the tooltip floats over miniaturized UI (e.g. a scaled product
   * preview) so the gap stays proportionate.
   */
  offset?: number
}) {
  if (typeof document === 'undefined' || !state.visible) return null

  return createPortal(
    <div
      id={id}
      role={role}
      aria-hidden={role ? undefined : 'true'}
      data-native-surface-overlay=''
      className={cn(
        TOOLTIP_SURFACE_CLASS,
        'pointer-events-none fixed top-0 left-0 z-[var(--z-tooltip)] px-2 py-1.5 opacity-100 transition-[opacity,translate] duration-150 ease-out',
        'motion-reduce:transition-none',
        className
      )}
      style={{
        translate: getTooltipTranslate(state, offset),
        scale: `${state.scaleX} ${state.scaleY}`,
        transform: `skew(${state.skew}deg)`,
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
  clientY: number,
  preferAbove = false
): Pick<FloatingTooltipState, 'x' | 'y' | 'alignX' | 'alignY'> {
  if (typeof window === 'undefined') {
    return {
      x: Math.round(clientX),
      y: Math.round(clientY),
      alignX: 'left',
      alignY: preferAbove ? 'above' : 'below',
    }
  }

  const alignX = window.innerWidth - clientX < EDGE_THRESHOLD ? 'right' : 'left'
  const nearTop = clientY < EDGE_THRESHOLD / 2
  const nearBottom = window.innerHeight - clientY < EDGE_THRESHOLD / 2
  const alignY = preferAbove ? (nearTop ? 'below' : 'above') : nearBottom ? 'above' : 'below'

  return {
    x: Math.round(clamp(clientX, EDGE_GUTTER, window.innerWidth - EDGE_GUTTER)),
    y: Math.round(clamp(clientY, EDGE_GUTTER, window.innerHeight - EDGE_GUTTER)),
    alignX,
    alignY,
  }
}

/**
 * Value for the `translate` CSS property. Kept off the `transform` property so the
 * velocity flourish (`scale` + `transform: skew()`) can stay out of the transition
 * list while the tooltip's position still eases toward the cursor.
 */
function getTooltipTranslate(state: FloatingTooltipState, offset: number): string {
  const x = state.alignX === 'left' ? `${state.x + offset}px` : `calc(${state.x - offset}px - 100%)`
  const y =
    state.alignY === 'below' ? `${state.y + offset}px` : `calc(${state.y - offset}px - 100%)`

  return `${x} ${y}`
}

/**
 * Kept for API compatibility with the previous tooltip. The floating tooltip has no shared hover
 * delay, so this is a passthrough — props are accepted but unused.
 */
const Provider = ({
  children,
}: {
  children: React.ReactNode
  delayDuration?: number
  skipDelayDuration?: number
  disableHoverableContent?: boolean
}) => <>{children}</>
Provider.displayName = 'Tooltip.Provider'

const ALWAYS_SHOW = () => true

interface TooltipContextValue {
  state: FloatingTooltipState
  handlers: FloatingTooltipHandlers
  contentId: string
}

const TooltipContext = React.createContext<TooltipContextValue | null>(null)

function useTooltipContext(component: string): TooltipContextValue {
  const context = React.useContext(TooltipContext)
  if (!context) {
    throw new Error(`Tooltip.${component} must be rendered within a Tooltip.Root`)
  }
  return context
}

interface RootProps {
  children: React.ReactNode
  /** Accepted for API compatibility; the floating tooltip has no hover delay. */
  delayDuration?: number
  /** Prefer placing the bubble above the trigger; flips near the viewport top. */
  preferAbove?: boolean
}

/**
 * Root of a single tooltip. Coordinates a cursor-following floating bubble between its `Trigger`
 * and `Content`.
 *
 * @example
 * ```tsx
 * <Tooltip.Root>
 *   <Tooltip.Trigger asChild>
 *     <Button>Hover me</Button>
 *   </Tooltip.Trigger>
 *   <Tooltip.Content>Tooltip text</Tooltip.Content>
 * </Tooltip.Root>
 * ```
 */
function Root({ children, preferAbove = false }: RootProps) {
  const contentId = React.useId()
  const { state, handlers } = useFloatingTooltip(ALWAYS_SHOW, { preferAbove })
  const value = React.useMemo<TooltipContextValue>(
    () => ({ state, handlers, contentId }),
    [state, handlers, contentId]
  )
  return <TooltipContext.Provider value={value}>{children}</TooltipContext.Provider>
}
Root.displayName = 'Tooltip.Root'

function composeHandlers<E extends React.SyntheticEvent>(
  theirHandler: ((event: E) => void) | undefined,
  ourHandler: (event: E) => void
) {
  return (event: E) => {
    theirHandler?.(event)
    if (!event.defaultPrevented) ourHandler(event)
  }
}

interface TriggerProps extends React.ComponentPropsWithoutRef<'button'> {
  /** Merge tooltip behavior onto the single child element instead of rendering a button. */
  asChild?: boolean
}

/**
 * Element that activates the tooltip on hover/focus. Use `asChild` to project onto your own element.
 */
const Trigger = React.forwardRef<HTMLButtonElement, TriggerProps>(
  ({ asChild = false, ...props }, ref) => {
    const ctx = useTooltipContext('Trigger')
    const Comp = asChild ? Slot : 'button'

    return (
      <Comp
        ref={ref as React.Ref<HTMLButtonElement>}
        aria-describedby={ctx.state.visible ? ctx.contentId : undefined}
        {...props}
        onPointerEnter={composeHandlers(props.onPointerEnter, (event) =>
          ctx.handlers.onPointerEnter(event)
        )}
        onPointerMove={composeHandlers(props.onPointerMove, (event) =>
          ctx.handlers.onPointerMove(event)
        )}
        onPointerLeave={composeHandlers(props.onPointerLeave, () => ctx.handlers.onPointerLeave())}
        onPointerDown={composeHandlers(props.onPointerDown, () => ctx.handlers.onPointerDown())}
        onFocus={composeHandlers(props.onFocus, (event) => ctx.handlers.onFocus(event))}
        onBlur={composeHandlers(props.onBlur, () => ctx.handlers.onBlur())}
      />
    )
  }
)
Trigger.displayName = 'Tooltip.Trigger'

interface ContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Cursor-to-bubble gap in px. Defaults to the standard 16; pass a smaller
   * value where the tooltip floats over miniaturized UI (e.g. a scaled product
   * preview) so the gap stays proportionate.
   */
  offset?: number
  /**
   * Legacy positioning props from the previous Radix tooltip. Accepted for drop-in compatibility
   * but ignored — the tooltip now follows the cursor.
   */
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  align?: 'start' | 'center' | 'end'
  alignOffset?: number
  avoidCollisions?: boolean
  collisionPadding?: number | Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>
  collisionBoundary?: unknown
  arrowPadding?: number
  sticky?: 'partial' | 'always'
  hideWhenDetached?: boolean
  asChild?: boolean
  forceMount?: boolean
}

/**
 * Tooltip content, rendered in a cursor-following floating bubble.
 *
 * @example
 * ```tsx
 * <Tooltip.Content>
 *   <p>Tooltip text</p>
 * </Tooltip.Content>
 * ```
 */
function Content({ className, children, offset }: ContentProps) {
  const ctx = useTooltipContext('Content')
  return (
    <FloatingTooltip
      state={ctx.state}
      role='tooltip'
      id={ctx.contentId}
      className={className}
      offset={offset}
    >
      {children}
    </FloatingTooltip>
  )
}
Content.displayName = 'Tooltip.Content'

interface ShortcutProps {
  /** The keyboard shortcut keys to display (e.g., "⌘D", "⌘K") */
  keys: string
  /** Optional additional class names */
  className?: string
  /** Optional children to display before the shortcut */
  children?: React.ReactNode
}

/**
 * Displays a keyboard shortcut within tooltip content.
 *
 * @example
 * ```tsx
 * <Tooltip.Content>
 *   <Tooltip.Shortcut keys="⌘D">Clear console</Tooltip.Shortcut>
 * </Tooltip.Content>
 * ```
 */
const Shortcut = ({ keys, className, children }: ShortcutProps) => (
  <span className={cn('flex items-center gap-2', className)}>
    {children && <span>{children}</span>}
    <span className='opacity-70'>{keys}</span>
  </span>
)
Shortcut.displayName = 'Tooltip.Shortcut'

interface PreviewProps {
  /** The URL of the image, GIF, or video to display */
  src: string
  /** Alt text for the media */
  alt?: string
  /** Width of the preview in pixels */
  width?: number
  /** Height of the preview in pixels */
  height?: number
  /** Whether video should loop */
  loop?: boolean
  /** Optional additional class names */
  className?: string
}

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.mov'] as const

/**
 * Displays a preview image, GIF, or video within tooltip content.
 *
 * @example
 * ```tsx
 * <Tooltip.Content>
 *   <p>Canvas error notifications</p>
 *   <Tooltip.Preview src="/tooltips/canvas-error-notification.mp4" alt="Error notification example" />
 * </Tooltip.Content>
 * ```
 */
const Preview = ({ src, alt = '', width = 240, height, loop = true, className }: PreviewProps) => {
  const pathname = src.toLowerCase().split('?')[0].split('#')[0]
  const isVideo = VIDEO_EXTENSIONS.some((ext) => pathname.endsWith(ext))
  const [isReady, setIsReady] = React.useState(!isVideo)

  return (
    <div className={cn('-mx-[6px] -mb-[1.5px] mt-1.5 overflow-hidden rounded-[4px]', className)}>
      {isVideo ? (
        <div className='relative'>
          {!isReady && (
            <div
              className='animate-pulse bg-white/5'
              style={{ aspectRatio: height ? `${width}/${height}` : '16/9' }}
            />
          )}
          <video
            src={src}
            width={width}
            height={height}
            className={cn(
              'block w-full transition-opacity duration-200',
              isReady ? 'opacity-100' : 'absolute inset-0 opacity-0'
            )}
            autoPlay
            loop={loop}
            muted
            playsInline
            preload='auto'
            aria-label={alt}
            onCanPlay={() => setIsReady(true)}
          />
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          className='block w-full'
          loading='lazy'
        />
      )}
    </div>
  )
}
Preview.displayName = 'Tooltip.Preview'

export const Tooltip = {
  Root,
  Trigger,
  Content,
  Provider,
  Shortcut,
  Preview,
}
