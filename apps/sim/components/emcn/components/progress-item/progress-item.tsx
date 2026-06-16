import { forwardRef, type HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { AlertTriangle } from 'lucide-react'
import { Check, Loader, Square, X } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'

const progressItemVariants = cva('flex items-start gap-2.5 px-3 py-3 text-[12px]', {
  variants: {
    status: {
      pending: '',
      success: '',
      error: '',
    },
  },
  defaultVariants: { status: 'pending' },
})

type ProgressStatus = NonNullable<VariantProps<typeof progressItemVariants>['status']>

const ICON_CLASS = 'mt-px size-[14px] shrink-0'

function StatusIcon({ status }: { status: ProgressStatus }) {
  if (status === 'success')
    return <Check className={cn(ICON_CLASS, 'text-[var(--badge-success-text)]')} />
  if (status === 'error')
    return <AlertTriangle className={cn(ICON_CLASS, 'text-[var(--text-error)]')} />
  return <Loader animate className={cn(ICON_CLASS, 'text-[var(--text-icon)]')} />
}

export interface ProgressItemProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'>,
    VariantProps<typeof progressItemVariants> {
  status: ProgressStatus
  /** Primary line (truncated). */
  title: React.ReactNode
  /** Right-aligned status on the title row, e.g. `Processing · 45%`. */
  meta?: React.ReactNode
  /** Secondary line under the title. */
  detail?: React.ReactNode
  /** Renders a dismiss button when provided (terminal rows). */
  onDismiss?: () => void
  /** Accessible label for the dismiss button. */
  dismissLabel?: string
  /** Renders a cancel button when provided (active rows); takes precedence over `onDismiss`. */
  onCancel?: () => void
}

/**
 * A single status/progress row: a leading status icon (spinner / check / alert), a primary
 * title, an optional right-aligned `meta` (status + percent), an optional secondary `detail`
 * line, and an optional dismiss button. Every status renders through the same fixed layout —
 * only the values change — so rows stay visually consistent across stages.
 *
 * @example
 * ```tsx
 * <ProgressItem status='pending' title='data.csv' meta='Processing · 45%' detail='450,000 / 1,000,000 rows' />
 * <ProgressItem status='success' title='data.csv' meta='Done' detail='1,000,000 rows imported' onDismiss={close} />
 * <ProgressItem status='error' title='data.csv' meta='Failed' detail='Row 12: invalid number' onDismiss={close} />
 * ```
 */
const ProgressItem = forwardRef<HTMLDivElement, ProgressItemProps>(function ProgressItem(
  { className, status, title, meta, detail, onDismiss, dismissLabel, onCancel, ...props },
  ref
) {
  const trailingAction = onCancel ?? onDismiss
  const trailingLabel = onCancel ? 'Cancel' : (dismissLabel ?? 'Dismiss')
  return (
    <div ref={ref} className={cn(progressItemVariants({ status }), className)} {...props}>
      <StatusIcon status={status} />
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <div className='flex items-center gap-2'>
          <span className='min-w-0 flex-1 truncate font-medium text-[var(--text-primary)]'>
            {title}
          </span>
          {meta != null && (
            <span className='shrink-0 text-[var(--text-secondary)] tabular-nums'>{meta}</span>
          )}
        </div>
        {detail != null && (
          <span
            className={cn(
              'truncate',
              status === 'error' ? 'text-[var(--text-error)]' : 'text-[var(--text-tertiary)]'
            )}
          >
            {detail}
          </span>
        )}
      </div>
      {trailingAction && (
        <button
          type='button'
          onClick={trailingAction}
          aria-label={trailingLabel}
          title={trailingLabel}
          className='-mr-1 shrink-0 rounded-[4px] p-1 text-[var(--text-muted)] transition-colors hover-hover:text-[var(--text-primary)]'
        >
          {onCancel ? <Square className='size-[12px]' /> : <X className='size-[14px]' />}
        </button>
      )}
    </div>
  )
})
ProgressItem.displayName = 'ProgressItem'

export { ProgressItem, progressItemVariants }
