'use client'

import {
  createContext,
  memo,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/emcn/components/button/button'
import { Tooltip } from '@/components/emcn/components/tooltip/tooltip'

const AUTO_DISMISS_MS = 10_000
const EXIT_ANIMATION_MS = 200
const MAX_VISIBLE = 4
const STACK_OFFSET_PX = 3

const RING_RADIUS = 5.5
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

const TOAST_KEYFRAMES = `
@keyframes toast-enter {
  from { opacity: 0; transform: translateX(calc(var(--stack-offset, 0px) - 8px)) scale(0.97); }
  to   { opacity: 1; transform: translateX(var(--stack-offset, 0px)) scale(1); }
}
@keyframes toast-exit {
  from { opacity: 1; transform: translateX(var(--stack-offset, 0px)) scale(1); }
  to   { opacity: 0; transform: translateX(calc(var(--stack-offset, 0px) + 8px)) scale(0.97); }
}
@keyframes toast-countdown {
  from { stroke-dashoffset: 0; }
  to   { stroke-dashoffset: ${RING_CIRCUMFERENCE.toFixed(2)}; }
}`

type ToastVariant = 'default' | 'success' | 'error'

interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastData {
  id: string
  message: string
  variant: ToastVariant
  icon?: ReactElement
  action?: ToastAction
  duration: number
  createdAt: number
}

type ToastInput = {
  message: string
  variant?: ToastVariant
  icon?: ReactElement
  action?: ToastAction
  duration?: number
}

type ToastFn = {
  (input: ToastInput): string
  success: (message: string, options?: Omit<ToastInput, 'message' | 'variant'>) => string
  error: (message: string, options?: Omit<ToastInput, 'message' | 'variant'>) => string
}

interface ToastContextValue {
  toast: ToastFn
  dismiss: (id: string) => void
  dismissAll: () => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let globalToast: ToastFn | null = null

function createToastFn(add: (input: ToastInput) => string): ToastFn {
  const fn = ((input: ToastInput) => add(input)) as ToastFn
  fn.success = (message, options) => add({ ...options, message, variant: 'success' })
  fn.error = (message, options) => add({ ...options, message, variant: 'error' })
  return fn
}

/**
 * Imperative toast function. Requires `<ToastProvider>` to be mounted.
 *
 * @example
 * ```tsx
 * toast.success('Item restored', { action: { label: 'View', onClick: () => router.push('/item') } })
 * toast.error('Something went wrong')
 * toast({ message: 'Hello', variant: 'default' })
 * ```
 */
export const toast: ToastFn = createToastFn((input) => {
  if (!globalToast) {
    throw new Error('toast() called before <ToastProvider> mounted')
  }
  return globalToast(input)
})

/**
 * Hook to access the toast function from context.
 */
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

function CountdownRing({ durationMs, onPause }: { durationMs: number; onPause: () => void }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          variant='ghost'
          onClick={onPause}
          aria-label='Keep visible'
          className='!p-[4px] -m-[2px] shrink-0 rounded-[5px] hover:bg-[var(--surface-active)]'
        >
          <svg
            width='14'
            height='14'
            viewBox='0 0 16 16'
            fill='none'
            xmlns='http://www.w3.org/2000/svg'
            style={{ transform: 'rotate(-90deg) scaleX(-1)' }}
          >
            <circle cx='8' cy='8' r={RING_RADIUS} stroke='var(--border)' strokeWidth='1.5' />
            <circle
              cx='8'
              cy='8'
              r={RING_RADIUS}
              stroke='var(--text-icon)'
              strokeWidth='1.5'
              strokeLinecap='round'
              strokeDasharray={RING_CIRCUMFERENCE}
              style={{
                animation: `toast-countdown ${durationMs}ms linear forwards`,
              }}
            />
          </svg>
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>
        <p>Keep visible</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

const ToastItem = memo(function ToastItem({
  data,
  depth,
  isExiting,
  showCountdown,
  onDismiss,
  onPauseCountdown,
  onAction,
}: {
  data: ToastData
  depth: number
  isExiting: boolean
  showCountdown: boolean
  onDismiss: (id: string) => void
  onPauseCountdown: () => void
  onAction: (id: string) => void
}) {
  const xOffset = depth * STACK_OFFSET_PX

  return (
    <div
      style={
        {
          '--stack-offset': `${xOffset}px`,
          animation: isExiting
            ? `toast-exit ${EXIT_ANIMATION_MS}ms ease-in forwards`
            : 'toast-enter 200ms ease-out forwards',
          gridArea: '1 / 1',
        } as React.CSSProperties
      }
      className='w-[240px] self-end overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--bg)] shadow-sm'
    >
      <div className='flex flex-col gap-[8px] p-[8px]'>
        <div className='flex items-start gap-[8px]'>
          {data.icon && (
            <span className='flex h-[16px] shrink-0 items-center text-[var(--text-icon)]'>
              {data.icon}
            </span>
          )}
          <div className='line-clamp-2 min-w-0 flex-1 font-medium text-[12px] text-[var(--text-body)]'>
            {data.variant === 'error' && (
              <span className='mr-[8px] mb-[2px] inline-block h-[8px] w-[8px] rounded-[2px] bg-[var(--text-error)] align-middle' />
            )}
            {data.message}
          </div>
          <div className='flex shrink-0 items-start gap-[2px]'>
            {showCountdown && (
              <CountdownRing durationMs={data.duration} onPause={onPauseCountdown} />
            )}
            <Button
              variant='ghost'
              onClick={() => onDismiss(data.id)}
              aria-label='Dismiss'
              className='!p-[4px] -m-[2px] shrink-0 rounded-[5px] hover:bg-[var(--surface-active)]'
            >
              <X className='h-[14px] w-[14px] text-[var(--text-icon)]' />
            </Button>
          </div>
        </div>
        {data.action && (
          <Button
            variant='active'
            onClick={() => onAction(data.id)}
            className='w-full rounded-[5px] px-[8px] py-[4px] font-medium text-[12px]'
          >
            {data.action.label}
          </Button>
        )}
      </div>
    </div>
  )
})

/**
 * Toast container that renders toasts via portal.
 * Mount once where you want toasts to appear. Renders stacked cards in the bottom-right.
 *
 * Visual design matches the workflow notification component: 240px cards, stacked with
 * offset, countdown ring on auto-dismissing items, enter/exit animations.
 */
export function ToastProvider({ children }: { children?: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([])
  const [mounted, setMounted] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set())
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    setMounted(true)
  }, [])

  const addToast = useCallback((input: ToastInput): string => {
    const id = crypto.randomUUID()
    const data: ToastData = {
      id,
      message: input.message,
      variant: input.variant ?? 'default',
      icon: input.icon,
      action: input.action,
      duration: input.duration ?? AUTO_DISMISS_MS,
      createdAt: Date.now(),
    }
    setToasts((prev) => [data, ...prev].slice(0, MAX_VISIBLE))
    return id
  }, [])

  const dismissToast = useCallback((id: string) => {
    setExitingIds((prev) => new Set(prev).add(id))
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
      setExitingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, EXIT_ANIMATION_MS)
  }, [])

  const dismissAll = useCallback(() => {
    setToasts([])
    setExitingIds(new Set())
    for (const timer of timersRef.current.values()) clearTimeout(timer)
    timersRef.current.clear()
  }, [])

  const pauseAll = useCallback(() => {
    setIsPaused(true)
    setExitingIds(new Set())
    for (const timer of timersRef.current.values()) clearTimeout(timer)
    timersRef.current.clear()
  }, [])

  const handleAction = useCallback(
    (id: string) => {
      const t = toasts.find((toast) => toast.id === id)
      if (t?.action) {
        t.action.onClick()
        dismissToast(id)
      }
    },
    [toasts, dismissToast]
  )

  useEffect(() => {
    if (toasts.length === 0) {
      if (isPaused) setIsPaused(false)
      return
    }
    if (isPaused) return

    const timers = timersRef.current

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
  }, [toasts, isPaused, dismissToast])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
    }
  }, [])

  const toastFn = useRef<ToastFn>(createToastFn(addToast))

  useEffect(() => {
    toastFn.current = createToastFn(addToast)
    globalToast = toastFn.current
    return () => {
      globalToast = null
    }
  }, [addToast])

  const ctx = useMemo<ToastContextValue>(
    () => ({ toast: toastFn.current, dismiss: dismissToast, dismissAll }),
    [dismissToast, dismissAll]
  )

  const visibleToasts = toasts.slice(0, MAX_VISIBLE)

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {mounted &&
        visibleToasts.length > 0 &&
        createPortal(
          <>
            <style>{TOAST_KEYFRAMES}</style>
            <div
              aria-live='polite'
              aria-label='Toasts'
              className='fixed right-[16px] bottom-[16px] z-[10000400] grid'
            >
              {[...visibleToasts].reverse().map((t, index, stacked) => {
                const depth = stacked.length - index - 1
                const showCountdown = !isPaused && t.duration > 0

                return (
                  <ToastItem
                    key={t.id}
                    data={t}
                    depth={depth}
                    isExiting={exitingIds.has(t.id)}
                    showCountdown={showCountdown}
                    onDismiss={dismissToast}
                    onPauseCountdown={pauseAll}
                    onAction={handleAction}
                  />
                )
              })}
            </div>
          </>,
          document.body
        )}
    </ToastContext.Provider>
  )
}
