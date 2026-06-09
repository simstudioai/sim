'use client'

import {
  type ComponentType,
  createContext,
  type ReactNode,
  type SVGProps,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { generateId } from '@sim/utils/id'
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import { createPortal } from 'react-dom'
import { Button } from '@/components/emcn/components/button/button'
import { Chip } from '@/components/emcn/components/chip/chip'
import { Bell } from '@/components/emcn/icons/bell'
import { CircleAlert } from '@/components/emcn/icons/circle-alert'
import { CircleCheck } from '@/components/emcn/icons/circle-check'
import { CircleInfo } from '@/components/emcn/icons/circle-info'
import { TriangleAlert } from '@/components/emcn/icons/triangle-alert'
import { X } from '@/components/emcn/icons/x'
import { cn } from '@/lib/core/utils/cn'

const AUTO_DISMISS_MS = 5000
/** Auto-dismiss countdown for the whole stack once the dismiss-all control appears (2+ toasts). */
const STACK_DISMISS_MS = 6000
/** Toast count at which the dismiss-all control appears and the stack countdown takes over. */
const STACK_DISMISS_THRESHOLD = 2

/** Card width; tracks the workflow-panel inset on narrow viewports. */
const TOAST_WIDTH = 'min(100vw - 2rem, 280px)'

/**
 * Stack behavior, modeled on the Sonner / Base-UI toast: a collapsed pile that
 * fans open upward on hover.
 *
 * - `STACK_LIMIT` — most toasts kept alive at once; arrivals beyond this evict
 *   the oldest. Both the collapsed pile and the expanded fan show up to this
 *   many.
 * - `COLLAPSED_OFFSET_PX` / `COLLAPSED_SCALE_STEP` — per-depth lift and shrink
 *   that make stacked cards peek above the front one when collapsed.
 * - `EXPAND_GAP_PX` — vertical gap between cards once the stack is expanded.
 */
const STACK_LIMIT = 3
const COLLAPSED_OFFSET_PX = 13
const COLLAPSED_SCALE_STEP = 0.05
const EXPAND_GAP_PX = 8

/** Fallback card height used for the expanded fan-out before a toast is measured. */
const ESTIMATED_TOAST_HEIGHT = 56

/** Top + bottom border of a card, added to the measured content so the clamped `<li>` height matches the border box. */
const CARD_BORDER_PX = 2

/**
 * Shared expo-out easing for every toast motion (stack reshuffle, enter, text
 * resize). One fixed-duration tween — not a spring — so rapid arrivals all move
 * with identical timing and settle in unison, instead of a re-targeted spring
 * carrying velocity and making one card look like it lags behind the others.
 */
const TOAST_EASE = [0.22, 1, 0.36, 1] as const
/** Duration for stack reshuffle + card enter. */
const STACK_DURATION = 0.4
/** Duration for the text-reveal resize (tail grow + blur). */
const RESIZE_DURATION = 0.3

/**
 * Cards at or below roughly one line of text use a tighter corner radius — the
 * concentric 16px reads as a pill on a short card. Taller cards (multi-line, or
 * with a description / action) keep the concentric 16px.
 */
const COMPACT_CARD_HEIGHT_PX = 46
const COMPACT_RADIUS_PX = 12
const CONCENTRIC_RADIUS_PX = 16

type ToastVariant = 'default' | 'info' | 'success' | 'warning' | 'error'

/**
 * Leading icon per variant. Rendered inline at the start of the message in a
 * neutral icon color (no tint, no badge) — variant intent reads from the icon
 * shape and the message copy rather than color.
 */
const VARIANT_ICON: Record<ToastVariant, ComponentType<SVGProps<SVGSVGElement>>> = {
  default: Bell,
  info: CircleInfo,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
}

interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastData {
  id: string
  message: string
  description?: string
  variant: ToastVariant
  action?: ToastAction
  duration: number
}

type ToastInput = {
  message: string
  description?: string
  variant?: ToastVariant
  action?: ToastAction
  duration?: number
}

type ToastFn = {
  (input: ToastInput): string
  success: (message: string, options?: Omit<ToastInput, 'message' | 'variant'>) => string
  error: (message: string, options?: Omit<ToastInput, 'message' | 'variant'>) => string
  warning: (message: string, options?: Omit<ToastInput, 'message' | 'variant'>) => string
  info: (message: string, options?: Omit<ToastInput, 'message' | 'variant'>) => string
  /** Dismisses a single toast by id. No-op if the id is unknown or the provider is unmounted. */
  dismiss: (id: string) => void
  /** Dismisses every visible toast. No-op when the provider is unmounted. */
  dismissAll: () => void
}

interface ToastContextValue {
  toast: ToastFn
  dismiss: (id: string) => void
  dismissAll: () => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let globalToast: ToastFn | null = null
let globalDismiss: ((id: string) => void) | null = null
let globalDismissAll: (() => void) | null = null

function createToastFn(add: (input: ToastInput) => string): ToastFn {
  const fn = ((input: ToastInput) => add(input)) as ToastFn
  fn.success = (message, options) => add({ ...options, message, variant: 'success' })
  fn.error = (message, options) => add({ ...options, message, variant: 'error' })
  fn.warning = (message, options) => add({ ...options, message, variant: 'warning' })
  fn.info = (message, options) => add({ ...options, message, variant: 'info' })
  fn.dismiss = (id) => globalDismiss?.(id)
  fn.dismissAll = () => globalDismissAll?.()
  return fn
}

/**
 * Imperative toast function. Requires `<ToastProvider>` to be mounted.
 *
 * Variants — `default` (neutral), `info`, `success`, `warning`, `error` —
 * each render a distinct tinted leading icon. A toast carrying an `action`
 * persists until dismissed unless an explicit `duration` is passed.
 *
 * @example
 * ```tsx
 * toast.error('Upload failed', { description: 'Network timed out' })
 * toast.warning('Usage nearing limit')
 * toast.info('Sync in progress')
 * toast.success('Saved', { action: { label: 'View', onClick: () => router.push('/x') } })
 * toast({ message: 'Hello', variant: 'default' })
 * ```
 */
export const toast: ToastFn = createToastFn((input) => {
  if (!globalToast) {
    throw new Error('toast() called before <ToastProvider> mounted')
  }
  return globalToast(input)
})

/** Hook to access the toast function and dismiss helper from context. */
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

interface ToastGeometry {
  /** Vertical lift from the bottom anchor (negative = upward). */
  y: number
  /** Depth shrink; `1` when expanded or for the front card. */
  scale: number
  /**
   * Rendered card height. Collapsed back cards are clamped to the front card's
   * height so each reveals a consistent strip; expanded and front cards take
   * their natural height.
   */
  height: number
  /** Paint order — the front card sits on top. */
  zIndex: number
}

interface ToastItemProps {
  toast: ToastData
  geometry: ToastGeometry
  reduceMotion: boolean
  onDismiss: (id: string) => void
  onMeasure: (id: string, height: number) => void
}

interface RevealTextProps {
  text: string
  /** Whether the parent card is hovered — the trigger for revealing hidden lines. */
  expanded: boolean
  /** Lines kept visible before truncation. */
  clampLines: number
  /** Line height in px; must match the text's leading so the head/tail split lands on a line boundary. */
  lineHeightPx: number
  /**
   * Optional inline icon rendered at the start of the text. Included in both
   * head and tail so wrapping stays identical (the tail's copy lands on line 1,
   * shifted out of view).
   */
  leadingIcon?: ReactNode
  className?: string
  reduceMotion: boolean
}

/**
 * Truncated text that reveals its hidden lines on hover. The head shows the
 * first `clampLines` lines and never moves or animates. When the card is
 * hovered AND the text actually overflows, the remaining lines mount below as
 * a "tail" and blur in — so only the previously-hidden text animates. The
 * head/tail split lands on an exact line boundary (`clampLines * lineHeightPx`)
 * and the tail renders the same text shifted up by that height, so the two
 * read as one continuous block. Text that fits within the clamp is never
 * truncated, has no tail, and the card never grows for it.
 */
function RevealText({
  text,
  expanded,
  clampLines,
  lineHeightPx,
  leadingIcon,
  className,
  reduceMotion,
}: RevealTextProps) {
  const headRef = useRef<HTMLDivElement>(null)
  const [truncated, setTruncated] = useState(false)
  const clampHeight = clampLines * lineHeightPx

  useLayoutEffect(() => {
    const el = headRef.current
    if (!el) return
    const check = () => setTruncated(el.scrollHeight - el.clientHeight > 1)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text])

  const open = expanded && truncated
  // Fade the last ~1.5 lines (not just a sliver) so the truncation reads as
  // "more text, faded" rather than a hard cut.
  const fadeStart = Math.max(0, clampHeight - lineHeightPx * 1.5)
  const collapsedMask = `linear-gradient(to bottom, #000 ${fadeStart}px, transparent ${clampHeight}px)`

  return (
    <div>
      <div
        ref={headRef}
        className={cn('overflow-hidden', className)}
        style={{
          maxHeight: clampHeight,
          // Soft bottom edge hints at more text while collapsed; dropped once
          // the tail takes over so the head/tail seam stays crisp.
          maskImage: truncated && !open ? collapsedMask : undefined,
          WebkitMaskImage: truncated && !open ? collapsedMask : undefined,
        }}
      >
        {leadingIcon}
        {text}
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            className='overflow-hidden'
            aria-hidden
            initial={reduceMotion ? false : { height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: RESIZE_DURATION, ease: TOAST_EASE }
            }
          >
            <motion.div
              className={className}
              style={{ marginTop: -clampHeight }}
              initial={reduceMotion ? false : { opacity: 0, filter: 'blur(5px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              transition={
                reduceMotion ? { duration: 0 } : { duration: RESIZE_DURATION, ease: [0.2, 0, 0, 1] }
              }
            >
              {leadingIcon}
              {text}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function ToastItem({ toast: t, geometry, reduceMotion, onDismiss, onMeasure }: ToastItemProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  /**
   * Hovering a single card reveals the hidden lines of any truncated text it
   * holds (see `RevealText`); the content grows and the measured height feeds
   * the stack layout so the card expands in place to fit. Cards with no
   * truncated text don't react.
   */
  const [hovered, setHovered] = useState(false)
  const Icon = VARIANT_ICON[t.variant]

  /**
   * Report the card's natural height so the provider can lay out the expanded
   * fan and the collapsed clamp against real (not estimated) heights. Measured
   * on the inner content element — which is never height-constrained — so the
   * clamp applied to the outer `<li>` can't feed back into the measurement.
   * `useLayoutEffect` measures before paint to avoid an initial height jump;
   * safe here because the portal only renders on the client.
   */
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const report = () => onMeasure(t.id, el.offsetHeight + CARD_BORDER_PX)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [t.id, onMeasure])

  const dismiss = useCallback(() => onDismiss(t.id), [onDismiss, t.id])

  const { y, scale, height, zIndex } = geometry
  const cornerRadius = height <= COMPACT_CARD_HEIGHT_PX ? COMPACT_RADIUS_PX : CONCENTRIC_RADIUS_PX
  /**
   * One fixed-duration tween drives `y`/`scale`/`opacity` so every card in the
   * stack reshuffles with identical timing — no card lags. The expo-out ease is
   * steep at the start, so an entering card is mostly opaque by the time it
   * slides over the cards behind it (no doubled-text bleed) without needing a
   * separate opacity ramp.
   */
  const transition = reduceMotion
    ? { duration: 0 }
    : {
        duration: STACK_DURATION,
        ease: TOAST_EASE,
        // Height tracks the content instantly: the smooth growth comes from the
        // tail's own height animation (RevealText), so the measured card height
        // equals the content every frame. The action button stays pinned to the
        // bottom and rides the morph instead of being clipped while a spring
        // catches up.
        height: { duration: 0 },
      }

  return (
    <motion.li
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      /**
       * Enter from below the stack (one card-height down) rather than cross-
       * fading in place, so the card rises into its slot already opaque.
       */
      initial={{ opacity: 0, y: height }}
      animate={{ opacity: 1, y, scale, height }}
      exit={{
        opacity: 0,
        scale: 0.95,
        transition: reduceMotion ? { duration: 0 } : { duration: 0.15, ease: 'easeIn' },
      }}
      transition={transition}
      /**
       * Concentric radius: the action Chip is `rounded-lg` (8px) inset by the
       * `p-2` (8px) padding, so a card with content is 8 + 8 = 16px — keeping
       * the corner consistent whether or not a Chip is present. Single-line
       * cards drop to a tighter radius (`cornerRadius`) so they don't read as
       * pills.
       */
      style={{ zIndex, transformOrigin: 'bottom', width: TOAST_WIDTH, borderRadius: cornerRadius }}
      className='pointer-events-auto absolute right-0 bottom-0 m-0 overflow-hidden border border-[var(--border-1)] bg-[var(--bg)] shadow-[var(--shadow-overlay)]'
    >
      <div ref={contentRef} className='flex flex-col gap-2 p-2'>
        <div className='flex items-start gap-2'>
          <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
            {/*
             * Title vs. subtext hierarchy: the message is the title — `font-medium`
             * in the primary text color — while the description is lighter,
             * smaller body copy. The variant icon flows inline at the start of
             * the title so wrapped lines run full width with no hanging indent;
             * `inline-block` + `align-middle` + the `-2px` nudge optically center
             * the `size-[14px]` glyph on the first line's cap height.
             */}
            <RevealText
              text={t.message}
              expanded={hovered}
              clampLines={2}
              lineHeightPx={20}
              leadingIcon={
                <Icon className='mr-[5px] inline-block size-[14px] translate-y-[-2px] align-middle text-[var(--text-icon)]' />
              }
              className='font-medium text-[14px] text-[var(--text-primary)] leading-5'
              reduceMotion={reduceMotion}
            />
            {t.description ? (
              <RevealText
                text={t.description}
                expanded={hovered}
                clampLines={3}
                lineHeightPx={18}
                className='text-[13px] text-[var(--text-secondary)] leading-[18px]'
                reduceMotion={reduceMotion}
              />
            ) : null}
          </div>
          <div className='flex h-5 flex-shrink-0 items-center'>
            <Button
              variant='quiet'
              onClick={dismiss}
              aria-label='Dismiss notification'
              title='Dismiss'
              className='flex size-[18px] flex-shrink-0 items-center justify-center rounded-sm p-0'
            >
              <X className='size-[14px] text-[var(--text-icon)]' />
            </Button>
          </div>
        </div>
        {t.action ? (
          <Chip
            variant='filled'
            fullWidth
            flush
            onClick={() => {
              t.action!.onClick()
              dismiss()
            }}
            className='justify-center'
          >
            {t.action.label}
          </Chip>
        ) : null}
      </div>
    </motion.li>
  )
}

interface StackDismissProps {
  /** When held (stack hovered), the countdown pauses so it can't dismiss mid-read. */
  paused: boolean
  reduceMotion: boolean
  /** Changes whenever a new toast arrives; restarts the countdown from zero. */
  resetKey: string
  onDismiss: () => void
}

/**
 * A small control that floats just outside the bottom-left of the stack once
 * multiple toasts pile up. A linear ring fills over `STACK_DISMISS_MS` (linear
 * because it represents elapsed time) and clears the whole stack when full;
 * hovering the stack or the control holds it, and clicking dismisses
 * immediately. It enters with a spring "pop" (overshoot-and-settle) so the
 * secondary control arrives with a little life without stealing focus.
 */
function StackDismiss({ paused, reduceMotion, resetKey, onDismiss }: StackDismissProps) {
  const progress = useMotionValue(0)
  const onDismissRef = useRef(onDismiss)
  const controlsRef = useRef<ReturnType<typeof animate> | null>(null)
  const [hovered, setHovered] = useState(false)

  const held = paused || hovered
  const heldRef = useRef(held)
  useEffect(() => {
    heldRef.current = held
  }, [held])

  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])

  // Restart the countdown from zero whenever a new toast arrives (`resetKey`
  // changes), so every fresh arrival gives the whole stack the full window
  // again rather than inheriting the older, already-elapsed timer.
  useEffect(() => {
    progress.set(0)
    const controls = animate(progress, 1, {
      duration: STACK_DISMISS_MS / 1000,
      ease: 'linear',
      onComplete: () => onDismissRef.current(),
    })
    controlsRef.current = controls
    if (heldRef.current) controls.pause()
    return () => controls.stop()
  }, [progress, resetKey])

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    if (held) controls.pause()
    else controls.play()
  }, [held])

  return (
    <motion.button
      type='button'
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onDismissRef.current()}
      aria-label='Dismiss all notifications'
      initial={reduceMotion ? false : { opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={
        reduceMotion
          ? { opacity: 0 }
          : { opacity: 0, scale: 0.5, transition: { duration: 0.12, ease: 'easeIn' } }
      }
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 24 }}
      className='pointer-events-auto absolute bottom-[8px] left-[-30px] z-50 flex size-[22px] items-center justify-center rounded-full bg-[var(--bg)] text-[var(--text-icon)] shadow-[var(--shadow-overlay)] transition-colors hover-hover:text-[var(--text-body)]'
    >
      {/*
       * The ring rides the circle's edge (no separate inner border): the track
       * is the card-like outline and the progress fills over it. `r=10` with a
       * 1.5px stroke lands the outer edge ~flush with the 22px button.
       */}
      <svg
        viewBox='0 0 22 22'
        className='-rotate-90 absolute inset-0 size-full'
        fill='none'
        aria-hidden
      >
        <circle cx='11' cy='11' r='10' stroke='var(--border-1)' strokeWidth='1.5' />
        <motion.circle
          cx='11'
          cy='11'
          r='10'
          stroke='currentColor'
          strokeWidth='1.5'
          strokeLinecap='round'
          style={{ pathLength: progress }}
        />
      </svg>
      <X className='size-[10px]' />
    </motion.button>
  )
}

/**
 * Toast container that renders toasts via portal. Mount once in your root
 * layout. Toasts pile bottom-right as a collapsed stack — newest in front,
 * older cards scaled and lifted behind it — and fan open upward on hover (or
 * keyboard focus) so the whole stack is readable, mirroring the Sonner /
 * Base-UI toast interaction. Hovering also pauses every auto-dismiss timer so
 * a toast can't vanish while it's being read.
 *
 * @example
 * ```tsx
 * <ToastProvider />
 * ```
 */
export function ToastProvider({ children }: { children?: ReactNode }) {
  const pathname = usePathname()
  const reduceMotion = useReducedMotion() ?? false
  /**
   * On workflow pages the toast portal must sit inside the workflow surface
   * — not over the right-side panel or the bottom terminal. Mirrors the
   * `ModalContent` workflow-aware inset using the same `--panel-width` and
   * `--terminal-height` CSS variables maintained by the panel + terminal
   * stores.
   */
  const isWorkflowPage = pathname?.includes('/w/') ?? false

  const [toasts, setToasts] = useState<ToastData[]>([])
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [expanded, setExpanded] = useState(false)
  const [mounted, setMounted] = useState(false)
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    setMounted(true)
  }, [])

  const addToast = useCallback((input: ToastInput): string => {
    const id = generateId()
    const data: ToastData = {
      id,
      message: input.message,
      description: input.description,
      variant: input.variant ?? 'default',
      action: input.action,
      /**
       * Actionable toasts persist until dismissed (`duration: 0`) so the
       * action — e.g. "Fix in Copilot" — can't disappear before the user
       * reacts. An explicit `duration` always wins. Everything else auto-
       * dismisses after the default window.
       */
      duration: input.duration ?? (input.action ? 0 : AUTO_DISMISS_MS),
    }
    setToasts((prev) => [...prev, data].slice(-STACK_LIMIT))
    return id
  }, [])

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((t) => t.id !== id))
    setHeights((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const dismissAllToasts = useCallback(() => {
    for (const timer of timersRef.current.values()) clearTimeout(timer)
    timersRef.current.clear()
    setToasts([])
    setHeights({})
  }, [])

  const measureToast = useCallback((id: string, height: number) => {
    setHeights((prev) => (prev[id] === height ? prev : { ...prev, [id]: height }))
  }, [])

  /**
   * Per-toast auto-dismiss timers, used only for a lone toast. Hovering
   * (`expanded`) holds them, and once the stack reaches the dismiss-all
   * threshold the single ring countdown (`StackDismiss`) takes over for the
   * whole stack, so per-toast timers stand down.
   */
  useEffect(() => {
    const timers = timersRef.current
    if (toasts.length === 0 || expanded || toasts.length >= STACK_DISMISS_THRESHOLD) {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      return
    }

    for (const t of toasts) {
      if (t.duration <= 0 || timers.has(t.id)) continue
      timers.set(
        t.id,
        setTimeout(() => {
          timers.delete(t.id)
          dismissToast(t.id)
        }, t.duration)
      )
    }

    for (const [id, timer] of timers) {
      if (!toasts.some((t) => t.id === id)) {
        clearTimeout(timer)
        timers.delete(id)
      }
    }
  }, [toasts, expanded, dismissToast])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
    }
  }, [])

  /**
   * Toasts are scoped to the route that raised them. Navigating clears the
   * stack so a notification never trails the user across the platform — it
   * previously persisted and visibly jumped when the workflow-aware portal
   * inset (`--panel-width` / `--terminal-height`) changed between pages.
   * Runs once on mount against an empty stack, which is a no-op.
   */
  useEffect(() => {
    dismissAllToasts()
  }, [pathname, dismissAllToasts])

  /**
   * Stable across mounts because `addToast` is memoized with no deps. Capturing
   * once at mount lets the module-level `toast` re-export bind to the live
   * provider without re-allocating wrappers on every render.
   */
  const toastFn = useRef<ToastFn>(createToastFn(addToast))

  useEffect(() => {
    globalToast = toastFn.current
    globalDismiss = dismissToast
    globalDismissAll = dismissAllToasts
    return () => {
      globalToast = null
      globalDismiss = null
      globalDismissAll = null
    }
  }, [dismissToast, dismissAllToasts])

  const ctx = useMemo<ToastContextValue>(
    () => ({ toast: toastFn.current, dismiss: dismissToast, dismissAll: dismissAllToasts }),
    [dismissToast, dismissAllToasts]
  )

  /** Front-first order: `ordered[0]` is the newest card. */
  const ordered = [...toasts].reverse()
  const frontHeight = heights[ordered[0]?.id ?? ''] ?? ESTIMATED_TOAST_HEIGHT
  let cumulative = 0
  const layout = ordered.map((toast, index) => {
    const naturalHeight = heights[toast.id] ?? ESTIMATED_TOAST_HEIGHT
    const offsetBefore = cumulative
    cumulative += naturalHeight + EXPAND_GAP_PX
    const geometry: ToastGeometry = {
      y: expanded ? -offsetBefore : -index * COLLAPSED_OFFSET_PX,
      scale: expanded ? 1 : 1 - index * COLLAPSED_SCALE_STEP,
      height: expanded || index === 0 ? naturalHeight : frontHeight,
      zIndex: ordered.length - index,
    }
    return { toast, geometry }
  })

  const collapsedHeight =
    frontHeight + Math.max(0, Math.min(ordered.length, STACK_LIMIT) - 1) * COLLAPSED_OFFSET_PX
  const expandedHeight = cumulative > 0 ? cumulative - EXPAND_GAP_PX : frontHeight
  const containerHeight = expanded ? expandedHeight : collapsedHeight

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {mounted && toasts.length > 0
        ? createPortal(
            <motion.ol
              aria-live='polite'
              aria-label='Notifications'
              className='fixed z-[var(--z-toast)] m-0 list-none p-0'
              style={{
                right: isWorkflowPage ? 'calc(var(--panel-width) + 16px)' : '16px',
                bottom: isWorkflowPage ? 'calc(var(--terminal-height) + 16px)' : '16px',
                width: TOAST_WIDTH,
                height: containerHeight,
              }}
            >
              <AnimatePresence initial={false}>
                {toasts.length >= STACK_DISMISS_THRESHOLD ? (
                  <StackDismiss
                    key='dismiss-all'
                    paused={expanded}
                    reduceMotion={reduceMotion}
                    resetKey={toasts[toasts.length - 1]?.id ?? ''}
                    onDismiss={dismissAllToasts}
                  />
                ) : null}
              </AnimatePresence>
              {/*
               * Expand-on-hover is scoped to the cards only. The dismiss control
               * sits outside this region, so hovering (or resting near) it pauses
               * the countdown without fanning the stack open — the stack stays
               * collapsed until the cards themselves are hovered.
               */}
              <div
                onMouseEnter={() => setExpanded(true)}
                onMouseLeave={() => setExpanded(false)}
                onFocusCapture={() => setExpanded(true)}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setExpanded(false)
                  }
                }}
                className='absolute inset-0'
              >
                <AnimatePresence>
                  {layout.map(({ toast, geometry }) => (
                    <ToastItem
                      key={toast.id}
                      toast={toast}
                      geometry={geometry}
                      reduceMotion={reduceMotion}
                      onDismiss={dismissToast}
                      onMeasure={measureToast}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </motion.ol>,
            document.body
          )
        : null}
    </ToastContext.Provider>
  )
}
