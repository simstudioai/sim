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
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createPortal } from 'react-dom'
import { Button } from '@/components/emcn/components/button/button'
import { Chip } from '@/components/emcn/components/chip/chip'
import {
  chipContentIconClass,
  chipFilledFillTokens,
} from '@/components/emcn/components/chip/chip-chrome'
import { Bell } from '@/components/emcn/icons/bell'
import { CircleAlert } from '@/components/emcn/icons/circle-alert'
import { CircleCheck } from '@/components/emcn/icons/circle-check'
import { CircleInfo } from '@/components/emcn/icons/circle-info'
import { TriangleAlert } from '@/components/emcn/icons/triangle-alert'
import { X } from '@/components/emcn/icons/x'
import { cn } from '@/lib/core/utils/cn'

const AUTO_DISMISS_MS = 5000

/** Card width; tracks the workflow-panel inset on narrow viewports. */
const TOAST_WIDTH = 'min(100vw - 2rem, 280px)'

/** Most toasts kept alive at once; older arrivals are evicted. */
const STACK_LIMIT = 3
/** Per-depth lift and shrink that make collapsed cards peek above the front one. */
const COLLAPSED_OFFSET_PX = 13
const COLLAPSED_SCALE_STEP = 0.05
/** Vertical gap between cards once the stack is expanded. */
const EXPAND_GAP_PX = 8

/** Fallback card height used for the expanded fan-out before a toast is measured. */
const ESTIMATED_TOAST_HEIGHT = 56

/** Card border box, added to the measured content so the clamped `<li>` height matches. */
const CARD_BORDER_PX = 2

/** Shared expo-out easing so every card in the stack reshuffles with identical timing. */
const TOAST_EASE = [0.22, 1, 0.36, 1] as const
const STACK_DURATION = 0.4
const RESIZE_DURATION = 0.3

/** Single-line cards use a tighter corner radius; taller cards keep the concentric 16px. */
const COMPACT_CARD_HEIGHT_PX = 46
const COMPACT_RADIUS_PX = 12
const CONCENTRIC_RADIUS_PX = 16

type ToastVariant = 'default' | 'info' | 'success' | 'warning' | 'error'

/** Leading icon per variant; the shape alone signals intent, tinted with the canonical chip icon color. */
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
  persistAcrossRoutes: boolean
}

type ToastInput = {
  message: string
  description?: string
  variant?: ToastVariant
  action?: ToastAction
  duration?: number
  /**
   * Keep the toast across navigation. The stack is otherwise cleared on every
   * route change (route-scoped notifications shouldn't trail the user); set
   * this for global, ongoing-state toasts like a connection/reconnect status.
   * @default false
   */
  persistAcrossRoutes?: boolean
}

type ToastFn = {
  (input: ToastInput): string
  success: (message: string, options?: Omit<ToastInput, 'message' | 'variant'>) => string
  error: (message: string, options?: Omit<ToastInput, 'message' | 'variant'>) => string
  warning: (message: string, options?: Omit<ToastInput, 'message' | 'variant'>) => string
  info: (message: string, options?: Omit<ToastInput, 'message' | 'variant'>) => string
  /** Dismisses a single toast by id. */
  dismiss: (id: string) => void
  /** Dismisses every visible toast. */
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
 * Imperative toast. Requires a mounted `<ToastProvider>`. A toast carrying an
 * `action` persists until dismissed unless an explicit `duration` is passed.
 *
 * @example
 * ```tsx
 * toast.error('Upload failed', { description: 'Network timed out' })
 * toast.success('Saved', { action: { label: 'View', onClick: () => router.push('/x') } })
 * ```
 */
export const toast: ToastFn = createToastFn((input) => {
  if (!globalToast) {
    throw new Error('toast() called before <ToastProvider> mounted')
  }
  return globalToast(input)
})

/** Hook to access the toast function and dismiss helpers from context. */
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
  /** Rendered height; collapsed back cards are clamped to the front card's height. */
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
  /** Line height in px; must match the text leading so the head/tail split lands on a line boundary. */
  lineHeightPx: number
  /** Optional inline icon; included in head and tail so wrapping stays identical. */
  leadingIcon?: ReactNode
  className?: string
  reduceMotion: boolean
}

/**
 * Truncated text that reveals its hidden lines on hover: the head shows the
 * first `clampLines` lines, and when hovered (and actually overflowing) the
 * remaining lines mount below and blur in as one continuous block. Text that
 * fits within the clamp is never truncated and the card never grows for it.
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
  const fadeStart = Math.max(0, clampHeight - lineHeightPx * 1.5)
  const collapsedMask = `linear-gradient(to bottom, #000 ${fadeStart}px, transparent ${clampHeight}px)`

  return (
    <div>
      <div
        ref={headRef}
        className={cn('overflow-hidden', className)}
        style={{
          maxHeight: clampHeight,
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
  const tI18n = useTranslations('auto')
  const contentRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const Icon = VARIANT_ICON[t.variant]

  /**
   * Report the natural height — measured on the unconstrained inner content so
   * the outer `<li>` clamp can't feed back — so the provider lays the fan and
   * collapsed clamp against real heights. `useLayoutEffect` avoids a paint jump.
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
  /** One fixed-duration tween so all cards reshuffle in unison; height tracks content instantly. */
  const transition = reduceMotion
    ? { duration: 0 }
    : {
        duration: STACK_DURATION,
        ease: TOAST_EASE,
        height: { duration: 0 },
      }

  return (
    <motion.li
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      initial={reduceMotion ? false : { opacity: 0, y: height }}
      animate={{ opacity: 1, y, scale, height }}
      exit={{
        opacity: 0,
        scale: 0.95,
        transition: reduceMotion ? { duration: 0 } : { duration: 0.15, ease: 'easeIn' },
      }}
      transition={transition}
      style={{ zIndex, transformOrigin: 'bottom', width: TOAST_WIDTH, borderRadius: cornerRadius }}
      className='pointer-events-auto absolute right-0 bottom-0 m-0 overflow-hidden border border-[var(--border-1)] bg-[var(--bg)] shadow-[var(--shadow-overlay)]'
    >
      <div ref={contentRef} className='flex flex-col gap-2 p-2'>
        <div className='flex items-start gap-2'>
          <div className='min-w-0 flex-1'>
            <RevealText
              text={t.message}
              expanded={hovered}
              clampLines={2}
              lineHeightPx={20}
              leadingIcon={
                <span className='mr-1.5 inline-flex h-5 items-center align-top'>
                  <Icon className={chipContentIconClass} />
                </span>
              }
              className='text-[var(--text-body)] text-sm leading-5'
              reduceMotion={reduceMotion}
            />
          </div>
          <div className='flex h-5 flex-shrink-0 items-center'>
            <Button
              variant='quiet'
              onClick={dismiss}
              aria-label={tI18n('dismiss_notification')}
              title={tI18n('dismiss')}
              className='size-[18px] rounded-sm p-0'
            >
              <X className='size-[16px]' />
            </Button>
          </div>
        </div>
        {t.description ? (
          <RevealText
            text={t.description}
            expanded={hovered}
            clampLines={3}
            lineHeightPx={18}
            className='text-[var(--text-muted)] text-small leading-[18px]'
            reduceMotion={reduceMotion}
          />
        ) : null}
        {t.action ? (
          <Chip
            fullWidth
            flush
            onClick={() => {
              t.action!.onClick()
              dismiss()
            }}
            className={cn('justify-center', chipFilledFillTokens)}
          >
            {t.action.label}
          </Chip>
        ) : null}
      </div>
    </motion.li>
  )
}

/**
 * Toast container, mounted once in the root layout. Toasts pile bottom-right as
 * a collapsed stack that fans open on hover or keyboard focus, mirroring the
 * Sonner / Base-UI interaction; hovering pauses auto-dismiss. On workflow pages
 * the stack is inset by the panel and terminal, and it clears on navigation.
 *
 * @example
 * ```tsx
 * <ToastProvider />
 * ```
 */
export function ToastProvider({ children }: { children?: ReactNode }) {
  const tI18n = useTranslations('auto')
  const pathname = usePathname()
  const reduceMotion = useReducedMotion() ?? false
  /** On the workflow editor (`/w/[id]` and the `/w` index) the stack insets by `--panel-width` / `--terminal-height` to clear the panel and terminal. */
  const isWorkflowPage = pathname ? /\/w(\/|$)/.test(pathname) : false

  const [toasts, setToasts] = useState<ToastData[]>([])
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [expanded, setExpanded] = useState(false)
  const [mounted, setMounted] = useState(false)
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    setMounted(true)
  }, [])

  /**
   * Reset the hover-expanded flag whenever the stack empties. The hover wrapper
   * unmounts without firing mouse-leave when the last toast goes (dismiss / clear
   * / navigation), so without this `expanded` could stay `true` and stop the next
   * toasts from auto-dismissing.
   */
  useEffect(() => {
    if (toasts.length === 0) setExpanded(false)
  }, [toasts.length])

  /**
   * Adds a toast. Actionable toasts persist (`duration: 0`) unless an explicit
   * `duration` is given. When the stack exceeds `STACK_LIMIT` the oldest
   * auto-dismissable toast is evicted first, so a persistent (actionable) toast
   * isn't silently dropped — only an all-persistent overflow evicts the oldest.
   */
  const addToast = useCallback((input: ToastInput): string => {
    const id = generateId()
    const data: ToastData = {
      id,
      message: input.message,
      description: input.description,
      variant: input.variant ?? 'default',
      action: input.action,
      duration: input.duration ?? (input.action ? 0 : AUTO_DISMISS_MS),
      persistAcrossRoutes: input.persistAcrossRoutes ?? false,
    }
    setToasts((prev) => {
      const next = [...prev, data]
      if (next.length <= STACK_LIMIT) return next
      const evictIndex = next.findIndex((t) => t.duration > 0)
      next.splice(evictIndex === -1 ? 0 : evictIndex, 1)
      return next
    })
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

  /**
   * Clear only route-scoped toasts. Toasts flagged `persistAcrossRoutes` —
   * global, ongoing-state notifications like the connection status — survive,
   * everything else (page-scoped notifications) is cleared on navigation.
   */
  const dismissRouteScopedToasts = useCallback(() => {
    setToasts((prev) => {
      const kept = prev.filter((t) => t.persistAcrossRoutes)
      if (kept.length === prev.length) return prev
      for (const t of prev) {
        if (t.persistAcrossRoutes) continue
        const timer = timersRef.current.get(t.id)
        if (timer) {
          clearTimeout(timer)
          timersRef.current.delete(t.id)
        }
      }
      return kept
    })
  }, [])

  const measureToast = useCallback((id: string, height: number) => {
    setHeights((prev) => (prev[id] === height ? prev : { ...prev, [id]: height }))
  }, [])

  /** Drop measured heights for toasts evicted by `slice(-STACK_LIMIT)` (single dismissal prunes its own entry). */
  useEffect(() => {
    setHeights((prev) => {
      const live = new Set(toasts.map((t) => t.id))
      const stale = Object.keys(prev).filter((id) => !live.has(id))
      if (stale.length === 0) return prev
      const next = { ...prev }
      for (const id of stale) delete next[id]
      return next
    })
  }, [toasts])

  /**
   * Per-toast auto-dismiss timers. Each timed toast runs its own timer so it
   * expires independently regardless of how many toasts are stacked; persistent
   * toasts (`duration <= 0`) never get a timer, and hovering (`expanded`) holds
   * every timer so a toast can't be cleared mid-read.
   */
  useEffect(() => {
    const timers = timersRef.current
    if (toasts.length === 0 || expanded) {
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

  /** On navigation, clear route-scoped toasts so they don't trail the user; `persistAcrossRoutes` toasts survive. */
  useEffect(() => {
    dismissRouteScopedToasts()
  }, [pathname, dismissRouteScopedToasts])

  /** Held in a ref (seeded once from the stable `addToast`) so the module-level `toast` binds to the live provider. */
  const toastFn = useRef<ToastFn>(createToastFn(addToast))

  useEffect(() => {
    const fn = toastFn.current
    globalToast = fn
    globalDismiss = dismissToast
    globalDismissAll = dismissAllToasts
    return () => {
      if (globalToast === fn) globalToast = null
      if (globalDismiss === dismissToast) globalDismiss = null
      if (globalDismissAll === dismissAllToasts) globalDismissAll = null
    }
  }, [dismissToast, dismissAllToasts])

  const ctx = useMemo<ToastContextValue>(
    () => ({ toast: toastFn.current, dismiss: dismissToast, dismissAll: dismissAllToasts }),
    [dismissToast, dismissAllToasts]
  )

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
      {mounted
        ? createPortal(
            <AnimatePresence>
              {toasts.length > 0 ? (
                <motion.ol
                  key='toast-stack'
                  aria-live='polite'
                  aria-label={tI18n('notifications')}
                  className='fixed z-[var(--z-toast)] m-0 list-none p-0'
                  exit={{
                    opacity: 0,
                    transition: reduceMotion ? { duration: 0 } : { duration: 0.2, ease: 'easeIn' },
                  }}
                  style={{
                    right: isWorkflowPage ? 'calc(var(--panel-width) + 16px)' : '16px',
                    bottom: isWorkflowPage ? 'calc(var(--terminal-height) + 16px)' : '16px',
                    width: TOAST_WIDTH,
                    height: containerHeight,
                  }}
                >
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
                </motion.ol>
              ) : null}
            </AnimatePresence>,
            document.body
          )
        : null}
    </ToastContext.Provider>
  )
}
