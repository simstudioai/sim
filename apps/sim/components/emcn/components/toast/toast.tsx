'use client'

import {
  type ComponentType,
  type CSSProperties,
  createContext,
  type ReactNode,
  type SVGProps,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { generateId } from '@sim/utils/id'
import { usePathname } from 'next/navigation'
import { createPortal } from 'react-dom'
import { Button } from '@/components/emcn/components/button/button'
import { Chip } from '@/components/emcn/components/chip/chip'
import { CountdownRing } from '@/components/emcn/components/toast/countdown-ring'
import { Tooltip } from '@/components/emcn/components/tooltip/tooltip'
import { Bell } from '@/components/emcn/icons/bell'
import { Check } from '@/components/emcn/icons/check'
import { X } from '@/components/emcn/icons/x'

const AUTO_DISMISS_MS = 5000
const EXIT_ANIMATION_MS = 200
/**
 * Visible stack depth. The per-step `translateX` cascade keeps the depth
 * cue legible; raising this much higher would crowd the bottom-right edge
 * once the portal insets for the workflow panel + terminal.
 */
const MAX_VISIBLE = 3
const STACK_OFFSET_PX = 3

type ToastVariant = 'default' | 'success' | 'error'

/**
 * Leading icon shown next to the toast title, per variant. Icons are EMCN
 * primitives so this surface stays inside the design system. All variants
 * share the neutral `text-[var(--text-icon)]` color used by sidebar items;
 * variant intent is communicated through icon shape and message content,
 * not tint.
 */
const VARIANT_ICON: Record<ToastVariant, ComponentType<SVGProps<SVGSVGElement>>> = {
  default: Bell,
  error: Bell,
  success: Check,
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
  fn.dismiss = (id) => globalDismiss?.(id)
  fn.dismissAll = () => globalDismissAll?.()
  return fn
}

/**
 * Imperative toast function. Requires `<ToastProvider>` to be mounted.
 *
 * @example
 * ```tsx
 * toast.error('Upload failed', { description: 'Network timed out' })
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

interface ToastItemProps {
  toast: ToastData
  depth: number
  isPaused: boolean
  onPause: () => void
  onDismiss: (id: string) => void
}

function ToastItem({ toast: t, depth, isPaused, onPause, onDismiss }: ToastItemProps) {
  const [exiting, setExiting] = useState(false)
  const exitTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const dismiss = useCallback(() => {
    setExiting(true)
    exitTimerRef.current = setTimeout(() => onDismiss(t.id), EXIT_ANIMATION_MS)
  }, [onDismiss, t.id])

  useEffect(() => {
    return () => clearTimeout(exitTimerRef.current)
  }, [])

  const showCountdown = !isPaused && !exiting && t.duration > 0

  /**
   * The `--stack-offset` custom property is read by the `notification-enter` /
   * `notification-exit` keyframes (see `globals.css`) so each item animates in
   * along its target translate-X without duplicating per-depth keyframe rules.
   */
  const style = {
    '--stack-offset': `${depth * STACK_OFFSET_PX}px`,
    animation: exiting
      ? `notification-exit ${EXIT_ANIMATION_MS}ms ease-in forwards`
      : 'notification-enter 200ms ease-out forwards',
    gridArea: '1 / 1',
  } as CSSProperties

  const Icon = VARIANT_ICON[t.variant]

  return (
    <div
      style={style}
      className='w-[min(100vw-2rem,280px)] self-end overflow-hidden rounded-lg border border-[var(--border-1)] bg-[var(--bg)] shadow-[var(--shadow-overlay)]'
    >
      <div className='flex flex-col gap-2 p-2'>
        <div className='flex items-start gap-2.5'>
          {/*
           * Each affordance row (leading icon, close cluster) is wrapped in a
           * `h-5` flex so its center sits on the title's first-line center
           * (`text-[14px] leading-5`). Glyphs are all `size-[14px]` so the
           * leading variant icon, title, and trailing close icon read as a
           * single horizontal rhythm regardless of how many lines the title
           * or description wrap to.
           */}
          <div className='flex h-5 flex-shrink-0 items-center'>
            <Icon className='size-[14px] text-[var(--text-icon)]' />
          </div>
          <div className='flex min-w-0 flex-1 flex-col'>
            <span className='line-clamp-2 text-[14px] text-[var(--text-body)] leading-5'>
              {t.message}
            </span>
            {t.description ? (
              <p className='line-clamp-3 text-[12px] text-[var(--text-muted)] leading-4'>
                {t.description}
              </p>
            ) : null}
          </div>
          <div className='flex h-5 flex-shrink-0 items-center gap-1.5'>
            {showCountdown ? (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='quiet'
                    onClick={onPause}
                    aria-label='Keep notifications visible'
                    className='flex size-[18px] flex-shrink-0 items-center justify-center rounded-sm p-0 text-[var(--text-icon)]'
                  >
                    <CountdownRing duration={t.duration} />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content className='z-[calc(var(--z-toast)+1)]'>
                  <p>Keep visible</p>
                </Tooltip.Content>
              </Tooltip.Root>
            ) : null}
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='quiet'
                  onClick={dismiss}
                  aria-label='Dismiss notification'
                  className='flex size-[18px] flex-shrink-0 items-center justify-center rounded-sm p-0'
                >
                  <X className='size-[14px] text-[var(--text-icon)]' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content className='z-[calc(var(--z-toast)+1)]'>
                <p>Dismiss</p>
              </Tooltip.Content>
            </Tooltip.Root>
          </div>
        </div>
        {t.action ? (
          <Chip
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
    </div>
  )
}

/**
 * Toast container that renders toasts via portal. Mount once in your root
 * layout. Each item is a chip-modal-styled card with a leading EMCN icon,
 * header, optional description, and a trailing close/countdown cluster.
 * Items stack bottom-right via grid-overlay + `--stack-offset` (consumed
 * by the `notification-enter` / `notification-exit` keyframes in
 * `globals.css`). Clicking any countdown ring pauses every active timer
 * until the stack empties.
 *
 * @example
 * ```tsx
 * <ToastProvider />
 * ```
 */
export function ToastProvider({ children }: { children?: ReactNode }) {
  const pathname = usePathname()
  /**
   * On workflow pages the toast portal must sit inside the workflow surface
   * — not over the right-side panel or the bottom terminal. Mirrors the
   * `ModalContent` workflow-aware inset using the same `--panel-width` and
   * `--terminal-height` CSS variables maintained by the panel + terminal
   * stores.
   */
  const isWorkflowPage = pathname?.includes('/w/') ?? false

  const [toasts, setToasts] = useState<ToastData[]>([])
  const [isPaused, setIsPaused] = useState(false)
  const [mounted, setMounted] = useState(false)
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const isPausedRef = useRef(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  const addToast = useCallback((input: ToastInput): string => {
    const id = generateId()
    const data: ToastData = {
      id,
      message: input.message,
      description: input.description,
      variant: input.variant ?? 'default',
      action: input.action,
      duration: input.duration ?? AUTO_DISMISS_MS,
    }
    setToasts((prev) => [...prev, data].slice(-MAX_VISIBLE))
    return id
  }, [])

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const dismissAllToasts = useCallback(() => {
    for (const timer of timersRef.current.values()) clearTimeout(timer)
    timersRef.current.clear()
    setToasts([])
  }, [])

  const pauseAll = useCallback(() => {
    setIsPaused(true)
    isPausedRef.current = true
    for (const timer of timersRef.current.values()) clearTimeout(timer)
    timersRef.current.clear()
  }, [])

  /**
   * Per-toast auto-dismiss timers. Cleared when the stack empties so a fresh
   * arrival after a pause gets new timers. Pausing clears all live timers.
   */
  useEffect(() => {
    if (toasts.length === 0) {
      if (isPausedRef.current) setIsPaused(false)
      for (const timer of timersRef.current.values()) clearTimeout(timer)
      timersRef.current.clear()
      return
    }
    if (isPausedRef.current) return

    const timers = timersRef.current
    const activeIds = new Set<string>()

    for (const t of toasts) {
      if (t.duration <= 0 || timers.has(t.id)) continue
      activeIds.add(t.id)
      timers.set(
        t.id,
        setTimeout(() => {
          timers.delete(t.id)
          if (isPausedRef.current) return
          dismissToast(t.id)
        }, t.duration)
      )
    }

    for (const [id, timer] of timers) {
      if (!activeIds.has(id) && !toasts.some((t) => t.id === id)) {
        clearTimeout(timer)
        timers.delete(id)
      }
    }
  }, [toasts, dismissToast])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
    }
  }, [])

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

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {mounted && toasts.length > 0
        ? createPortal(
            <Tooltip.Provider>
              <div
                aria-live='polite'
                aria-label='Notifications'
                className='fixed z-[var(--z-toast)] grid'
                style={{
                  right: isWorkflowPage ? 'calc(var(--panel-width) + 16px)' : '16px',
                  bottom: isWorkflowPage ? 'calc(var(--terminal-height) + 16px)' : '16px',
                }}
              >
                {[...toasts].reverse().map((t, index, stacked) => (
                  <ToastItem
                    key={t.id}
                    toast={t}
                    depth={stacked.length - index - 1}
                    isPaused={isPaused}
                    onPause={pauseAll}
                    onDismiss={dismissToast}
                  />
                ))}
              </div>
            </Tooltip.Provider>,
            document.body
          )
        : null}
    </ToastContext.Provider>
  )
}
