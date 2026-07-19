'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'

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
  const canShowRef = React.useRef(canShow)
  canShowRef.current = canShow

  const lastPointerRef = React.useRef<PointerSnapshot | null>(null)
  const [state, setState] = React.useState<FloatingTooltipState>(HIDDEN_STATE)

  const handlers = React.useMemo<FloatingTooltipHandlers>(() => {
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
  node: React.RefObject<T | null>
  isOverflowing: boolean
} {
  const [isOverflowing, setIsOverflowing] = React.useState(false)
  const nodeRef = React.useRef<T | null>(null)
  const observerRef = React.useRef<ResizeObserver | null>(null)

  const measure = React.useCallback(() => {
    const element = nodeRef.current
    if (element) setIsOverflowing(isTextClipped(element))
  }, [])

  const ref = React.useCallback(
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

  React.useEffect(() => {
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
      className={cn(
        'pointer-events-none fixed top-0 left-0 z-[var(--z-tooltip)] w-fit max-w-[min(16rem,calc(100vw-2rem))] rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[var(--text-body)] text-caption opacity-100 shadow-sm transition-[opacity,filter,transform] duration-150 ease-out',
        'motion-reduce:transition-none',
        className
      )}
      style={{
        transform: `${getTooltipTranslate(state, offset)} skew(${state.skew}deg) scale(${state.scaleX}, ${state.scaleY})`,
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

function getTooltipTranslate(state: FloatingTooltipState, offset: number): string {
  const xOffset = state.alignX === 'left' ? `${offset}px` : `calc(-100% - ${offset}px)`
  const yOffset = state.alignY === 'below' ? `${offset}px` : `calc(-100% - ${offset}px)`

  return `translate3d(${state.x}px, ${state.y}px, 0) translate(${xOffset}, ${yOffset})`
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
function Root({ children }: RootProps) {
  const contentId = React.useId()
  const { state, handlers } = useFloatingTooltip(ALWAYS_SHOW)
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
