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
          'gap-[4px] rounded-[40px] border border-[var(--border)] text-[var(--text-secondary)] bg-[var(--surface-4)] hover:text-[var(--text-primary)] hover:border-[var(--border-1)] hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)]',
        outline:
          'gap-[4px] rounded-[40px] border border-[var(--border-1)] bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-5)] dark:hover:bg-transparent dark:hover:border-[var(--surface-6)]',
        type: 'gap-[4px] rounded-[40px] border border-[var(--border)] text-[var(--text-secondary)] bg-[var(--surface-4)] dark:bg-[var(--surface-6)]',
        green: `${STATUS_BASE} bg-[#bbf7d0] text-[#15803d] dark:bg-[rgba(34,197,94,0.2)] dark:text-[#86efac]`,
        red: `${STATUS_BASE} bg-[#fecaca] text-[var(--text-error)] dark:bg-[#551a1a] dark:text-[var(--text-error)]`,
        gray: `${STATUS_BASE} bg-[#e7e5e4] text-[#57534e] dark:bg-[var(--terminal-status-info-bg)] dark:text-[var(--terminal-status-info-color)]`,
        blue: `${STATUS_BASE} bg-[#bfdbfe] text-[#1d4ed8] dark:bg-[rgba(59,130,246,0.2)] dark:text-[#93c5fd]`,
        'blue-secondary': `${STATUS_BASE} bg-[#bae6fd] text-[#0369a1] dark:bg-[rgba(51,180,255,0.2)] dark:text-[var(--brand-secondary)]`,
        purple: `${STATUS_BASE} bg-[#e9d5ff] text-[#7c3aed] dark:bg-[rgba(168,85,247,0.2)] dark:text-[#d8b4fe]`,
        orange: `${STATUS_BASE} bg-[#fed7aa] text-[#c2410c] dark:bg-[rgba(249,115,22,0.2)] dark:text-[#fdba74]`,
        amber: `${STATUS_BASE} bg-[#fde68a] text-[#a16207] dark:bg-[rgba(245,158,11,0.2)] dark:text-[#fcd34d]`,
        teal: `${STATUS_BASE} bg-[#99f6e4] text-[#0f766e] dark:bg-[rgba(20,184,166,0.2)] dark:text-[#5eead4]`,
        cyan: `${STATUS_BASE} bg-[var(--surface-4)] text-[#0891b2] dark:bg-[rgba(14,165,233,0.2)] dark:text-[#7dd3fc]`,
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
  'cyan',
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
 * - **Bordered**: `default`, `outline`, `type` - traditional badges with borders
 * - **Status colors**: `green`, `red`, `gray`, `blue`, `blue-secondary`, `purple`,
 *   `orange`, `amber`, `teal`, `cyan`, `gray-secondary` - borderless colored badges
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
