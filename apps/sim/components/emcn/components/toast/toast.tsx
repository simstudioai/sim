'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { generateId } from '@sim/utils/id'
import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/core/utils/cn'

const AUTO_DISMISS_MS = 5000
const EXIT_ANIMATION_MS = 200
const MAX_VISIBLE = 20

const RING_RADIUS = 5.5
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

type ToastVariant = 'default' | 'success' | 'error'

const VARIANT_STYLES: Record<ToastVariant, string> = {
  default: 'border-[var(--border)] bg-[var(--bg)]',
  success: 'border-[var(--border)] bg-[var(--bg)]',
  error: 'border-[var(--border)] bg-[var(--bg)]',
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
}

interface ToastContextValue {
  toast: ToastFn
  dismiss: (id: string) => void
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

function CountdownRing({ duration }: { duration: number }) {
  return (
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
          animation: `notification-countdown ${duration}ms linear forwards`,
        }}
      />
    </svg>
  )
}

function ToastItem({ toast: t, onDismiss }: { toast: ToastData; onDismiss: (id: string) => void }) {
  const [exiting, setExiting] = useState(false)
  const [paused, setPaused] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const remainingRef = useRef(t.duration)
  const startRef = useRef(0)

  const dismiss = useCallback(() => {
    setExiting(true)
    setTimeout(() => onDismiss(t.id), EXIT_ANIMATION_MS)
  }, [onDismiss, t.id])

  useEffect(() => {
    if (t.duration > 0) {
      startRef.current = Date.now()
      remainingRef.current = t.duration
      timerRef.current = setTimeout(dismiss, t.duration)
      return () => clearTimeout(timerRef.current)
    }
  }, [dismiss, t.duration])

  const handleMouseEnter = useCallback(() => {
    if (t.duration <= 0) return
    clearTimeout(timerRef.current)
    remainingRef.current -= Date.now() - startRef.current
    setPaused(true)
  }, [t.duration])

  const handleMouseLeave = useCallback(() => {
    if (t.duration <= 0) return
    setPaused(false)
    startRef.current = Date.now()
    timerRef.current = setTimeout(dismiss, Math.max(remainingRef.current, 0))
  }, [dismiss, t.duration])

  const hasDuration = t.duration > 0

  return (
    <div
      onMouseEnter={hasDuration ? handleMouseEnter : undefined}
      onMouseLeave={hasDuration ? handleMouseLeave : undefined}
      className={cn(
        'pointer-events-auto flex w-[min(100vw-2rem,320px)] flex-col gap-2 overflow-hidden rounded-lg border px-3 py-2.5 shadow-md transition-[transform,opacity]',
        VARIANT_STYLES[t.variant],
        exiting
          ? 'animate-[toast-exit_200ms_ease-in_forwards] motion-reduce:animate-none'
          : 'animate-[toast-enter_200ms_ease-out_forwards] motion-reduce:animate-none'
      )}
    >
      <div className='flex items-start gap-2'>
        <div className='min-w-0 flex-1'>
          <div className='line-clamp-2 font-medium text-[var(--text-body)] text-small leading-[18px]'>
            {t.variant === 'error' && (
              <span className='mr-2 mb-0.5 inline-block h-2 w-2 rounded-[2px] bg-[var(--text-error)] align-middle' />
            )}
            {t.variant === 'success' && (
              <span className='mr-2 mb-0.5 inline-block h-2 w-2 rounded-[2px] bg-[var(--text-success)] align-middle' />
            )}
            {t.message}
          </div>
          {t.description ? (
            <p className='mt-0.5 text-caption leading-4 opacity-80'>{t.description}</p>
          ) : null}
        </div>
        <div className='flex shrink-0 items-start gap-0.5'>
          {t.duration > 0 ? <CountdownRing duration={t.duration} /> : null}
          <button
            type='button'
            onClick={dismiss}
            aria-label='Dismiss notification'
            className='-m-0.5 relative shrink-0 rounded-sm p-1 text-[var(--text-icon)] before:absolute before:inset-[-8px] before:content-[""] hover:bg-[var(--surface-active)]'
          >
            <X className='h-[14px] w-[14px]' />
          </button>
        </div>
      </div>
      {t.action ? (
        <button
          type='button'
          onClick={() => {
            t.action!.onClick()
            dismiss()
          }}
          className='w-full rounded-md bg-[var(--surface-active)] px-2 py-1 font-medium text-small hover:bg-[var(--surface-hover)]'
        >
          {t.action.label}
        </button>
      ) : null}
    </div>
  )
}

/**
 * Toast container that renders toasts via portal.
 * Mount once in your root layout.
 *
 * @example
 * ```tsx
 * <ToastProvider />
 * ```
 */
export function ToastProvider({ children }: { children?: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([])
  const [mounted, setMounted] = useState(false)

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
      duration: input.duration ?? AUTO_DISMISS_MS,
    }
    setToasts((prev) => [...prev, data].slice(-MAX_VISIBLE))
    return id
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
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
    () => ({ toast: toastFn.current, dismiss: dismissToast }),
    [dismissToast]
  )

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {mounted &&
        createPortal(
          <div
            aria-live='polite'
            aria-label='Notifications'
            className='pointer-events-none fixed right-[16px] bottom-4 z-[var(--z-toast)] flex flex-col-reverse items-end gap-2'
          >
            {toasts.map((t) => (
              <ToastItem key={t.id} toast={t} onDismiss={dismissToast} />
            ))}
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  )
}
