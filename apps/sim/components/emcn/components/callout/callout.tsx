import type * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'

const calloutVariants = cva('flex items-center gap-2 rounded-lg border p-2.5 text-[12px]', {
  variants: {
    variant: {
      default: 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]',
      info: 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]',
      success:
        'border-[color-mix(in_srgb,var(--badge-success-text)_30%,transparent)] bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]',
      warning:
        'border-[color-mix(in_srgb,var(--badge-amber-text)_30%,transparent)] bg-[var(--badge-amber-bg)] text-[var(--badge-amber-text)]',
      destructive:
        'border-[color-mix(in_srgb,var(--text-error)_40%,transparent)] bg-[color-mix(in_srgb,var(--text-error)_10%,transparent)] text-[var(--text-error)]',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

const DEFAULT_ICONS = {
  default: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: AlertTriangle,
} as const

export interface CalloutProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof calloutVariants> {
  /** Icon component shown before the content. Pass `null` to hide. Defaults per variant. */
  icon?: React.ComponentType<{ className?: string }> | null
}

/**
 * Inline note used to highlight short pieces of context inside a page or section.
 *
 * @example
 * ```tsx
 * <Callout>Applies organization-wide</Callout>
 * <Callout variant='warning'>This action is irreversible</Callout>
 * ```
 */
function Callout({ className, variant, icon, children, role = 'note', ...props }: CalloutProps) {
  const variantKey = (variant ?? 'default') as keyof typeof DEFAULT_ICONS
  const Icon = icon === null ? null : (icon ?? DEFAULT_ICONS[variantKey])

  return (
    <div role={role} className={cn(calloutVariants({ variant }), className)} {...props}>
      {Icon && <Icon className='h-[14px] w-[14px] shrink-0' />}
      <span>{children}</span>
    </div>
  )
}

export { Callout, calloutVariants }
