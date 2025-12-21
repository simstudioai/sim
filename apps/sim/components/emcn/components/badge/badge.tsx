'use client'

import type * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/core/utils/cn'

/** Shared base styles for status color badge variants */
const STATUS_BASE = 'gap-[6px] rounded-[6px]'

const badgeVariants = cva(
  'inline-flex items-center font-medium focus:outline-none transition-colors',
  {
    variants: {
      variant: {
        default:
          'gap-[4px] rounded-[40px] border border-[var(--border)] text-[var(--text-secondary)] bg-[var(--surface-4)] hover:text-[var(--text-primary)] hover:border-[var(--border-1)] hover:bg-[var(--surface-5)]',
        outline:
          'gap-[4px] rounded-[40px] border border-[#575757] bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
        green: `${STATUS_BASE} bg-[rgba(34,197,94,0.2)] text-[#86efac]`,
        red: `${STATUS_BASE} bg-[#551a1a] text-[var(--text-error)]`,
        gray: `${STATUS_BASE} bg-[var(--terminal-status-info-bg)] text-[var(--terminal-status-info-color)]`,
        blue: `${STATUS_BASE} bg-[rgba(59,130,246,0.2)] text-[#93c5fd]`,
        'blue-secondary': `${STATUS_BASE} bg-[rgba(51,180,255,0.2)] text-[var(--brand-secondary)]`,
        purple: `${STATUS_BASE} bg-[rgba(168,85,247,0.2)] text-[#d8b4fe]`,
        orange: `${STATUS_BASE} bg-[rgba(249,115,22,0.2)] text-[#fdba74]`,
        amber: `${STATUS_BASE} bg-[rgba(245,158,11,0.2)] text-[#fcd34d]`,
        teal: `${STATUS_BASE} bg-[rgba(20,184,166,0.2)] text-[#5eead4]`,
        'gray-secondary': `${STATUS_BASE} bg-[var(--surface-4)] text-[var(--text-secondary)]`,
      },
      size: {
        sm: 'px-[7px] py-[1px] text-[11px]',
        md: 'px-[9px] py-[2px] text-[12px]',
        lg: 'px-[9px] py-[2.25px] text-[12px]',
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
  'gray-secondary',
] as const

/** Dot sizes corresponding to badge size variants */
const DOT_SIZES: Record<string, string> = {
  sm: 'h-[5px] w-[5px]',
  md: 'h-[6px] w-[6px]',
  lg: 'h-[6px] w-[6px]',
}

/** Icon sizes corresponding to badge size variants */
const ICON_SIZES: Record<string, string> = {
  sm: 'h-[10px] w-[10px]',
  md: 'h-[12px] w-[12px]',
  lg: 'h-[12px] w-[12px]',
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
 * - **Bordered**: `default`, `outline` - traditional badges with borders
 * - **Status colors**: `green`, `red`, `gray`, `blue`, `blue-secondary`, `purple`,
 *   `orange`, `amber`, `teal`, `gray-secondary` - borderless colored badges
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
        <div className={cn('rounded-[2px] bg-current', DOT_SIZES[effectiveSize])} />
      )}
      {Icon && <Icon className={ICON_SIZES[effectiveSize]} />}
      {children}
    </div>
  )
}

export { Badge, badgeVariants }
