import type * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/core/utils/cn'

/** Shared base styles for status color badge variants */
const STATUS_BASE = 'gap-1.5 rounded-md'

const badgeVariants = cva(
  'inline-flex items-center font-medium focus:outline-none transition-colors',
  {
    variants: {
      variant: {
        default:
          'gap-1 rounded-[40px] border border-[var(--border)] text-[var(--text-secondary)] bg-[var(--surface-4)] hover-hover:text-[var(--text-primary)] hover-hover:border-[var(--border-1)] hover-hover:bg-[var(--surface-6)] dark:hover-hover:bg-[var(--surface-5)]',
        outline:
          'gap-1 rounded-[40px] border border-[var(--border-1)] bg-transparent text-[var(--text-secondary)] hover-hover:text-[var(--text-primary)] hover-hover:bg-[var(--surface-5)] dark:hover-hover:bg-transparent dark:hover-hover:border-[var(--surface-6)]',
        type: 'gap-1 rounded-[40px] border border-[var(--border)] text-[var(--text-secondary)] bg-[var(--surface-4)] dark:bg-[var(--surface-6)]',
        green: `${STATUS_BASE} bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]`,
        red: `${STATUS_BASE} bg-[var(--badge-error-bg)] text-[var(--badge-error-text)]`,
        gray: `${STATUS_BASE} bg-[var(--badge-gray-bg)] text-[var(--badge-gray-text)]`,
        blue: `${STATUS_BASE} bg-[var(--badge-blue-bg)] text-[var(--badge-blue-text)]`,
        'blue-secondary': `${STATUS_BASE} bg-[var(--badge-blue-secondary-bg)] text-[var(--badge-blue-secondary-text)]`,
        purple: `${STATUS_BASE} bg-[var(--badge-purple-bg)] text-[var(--badge-purple-text)]`,
        orange: `${STATUS_BASE} bg-[var(--badge-orange-bg)] text-[var(--badge-orange-text)]`,
        amber: `${STATUS_BASE} bg-[var(--badge-amber-bg)] text-[var(--badge-amber-text)]`,
        teal: `${STATUS_BASE} bg-[var(--badge-teal-bg)] text-[var(--badge-teal-text)]`,
        cyan: `${STATUS_BASE} bg-[var(--badge-cyan-bg)] text-[var(--badge-cyan-text)]`,
        pink: `${STATUS_BASE} bg-[var(--badge-pink-bg)] text-[var(--badge-pink-text)]`,
        'gray-secondary': `${STATUS_BASE} bg-[var(--surface-4)] text-[var(--text-secondary)]`,
      },
      size: {
        sm: 'px-[7px] py-[1px] text-xs',
        md: 'px-[9px] py-0.5 text-caption',
        lg: 'px-[9px] py-[2.25px] text-caption',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
)

/** Color variants that support dot indicators */
const STATUS_VARIANTS = [
  'green',
  'red',
  'gray',
  'blue',
  'blue-secondary',
  'purple',
  'orange',
  'amber',
  'teal',
  'cyan',
  'pink',
  'gray-secondary',
] as const

/** Dot sizes corresponding to badge size variants */
const DOT_SIZES: Record<string, string> = {
  sm: 'size-[5px]',
  md: 'size-1.5',
  lg: 'size-1.5',
}

/** Icon sizes corresponding to badge size variants */
const ICON_SIZES: Record<string, string> = {
  sm: 'size-2.5',
  md: 'size-3',
  lg: 'size-3',
}

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** Displays a dot indicator before content (only for color variants) */
  dot?: boolean
  /** Icon component to render before content */
  icon?: React.ComponentType<{ className?: string }>
}

/**
 * Displays a badge with configurable variant, size, and optional indicators.
 *
 * @remarks
 * Supports two categories of variants:
 * - **Bordered**: `default`, `outline`, `type` - traditional badges with borders
 * - **Status colors**: `green`, `red`, `gray`, `blue`, `blue-secondary`, `purple`,
 *   `orange`, `amber`, `teal`, `cyan`, `pink`, `gray-secondary` - borderless colored badges
 *
 * Status color variants can display a dot indicator via the `dot` prop.
 * All variants support an optional `icon` prop for leading icons.
 */
function Badge({
  className,
  variant,
  size,
  dot = false,
  icon: Icon,
  children,
  ...props
}: BadgeProps) {
  const isStatusVariant = STATUS_VARIANTS.includes(variant as (typeof STATUS_VARIANTS)[number])
  const effectiveSize = size ?? 'md'

  return (
    <div className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {isStatusVariant && dot && (
        <div className={cn('rounded-xs bg-current', DOT_SIZES[effectiveSize])} />
      )}
      {Icon && <Icon className={ICON_SIZES[effectiveSize]} />}
      {children}
    </div>
  )
}

export { Badge, badgeVariants }
