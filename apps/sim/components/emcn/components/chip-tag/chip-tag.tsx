'use client'

import type { HTMLAttributes, ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/core/utils/cn'

/**
 * Small inline tag/badge — 20px tall neutral surface for compact in-line accents
 * (discount pills, status counters, sub-labels next to titles).
 *
 * @remarks
 * Two neutral variants, theme-aware via workspace tokens:
 * - `mono` — borderless, sharing the {@link ChipSwitch} trough surface
 *   (`--surface-5` light / `--surface-4` dark) with strong `--text-primary` text
 *   for emphasis (e.g. a discount next to a primary CTA).
 * - `gray` — a light surface over a slightly darker inset ring with muted
 *   `--text-secondary` text for low-emphasis status labels.
 */
const chipTagVariants = cva(
  'inline-flex h-5 items-center gap-[3px] rounded-md px-1 text-sm leading-5',
  {
    variants: {
      variant: {
        /**
         * Borderless badge sharing the ChipSwitch trough surface (`--surface-5`
         * light / `--surface-4` dark) with strong `--text-primary` text.
         */
        mono: 'bg-[var(--surface-5)] text-[var(--text-primary)] dark:bg-[var(--surface-4)]',
        gray: 'bg-[var(--surface-5)] text-[var(--text-secondary)] shadow-[inset_0_0_0_1px_var(--border-1)]',
      },
    },
    defaultVariants: { variant: 'mono' },
  }
)

/**
 * Props for {@link ChipTag}.
 */
export interface ChipTagProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'>,
    VariantProps<typeof chipTagVariants> {
  /** Tag content — typically a short label, number, or percentage. */
  children: ReactNode
}

/**
 * A compact neutral tag in the chip language.
 *
 * @example
 * <ChipTag variant='mono'>-20%</ChipTag>
 * <ChipTag variant='gray'>Your plan</ChipTag>
 */
export function ChipTag({ variant, className, children, ...props }: ChipTagProps) {
  return (
    <span className={cn(chipTagVariants({ variant }), className)} {...props}>
      {children}
    </span>
  )
}

export { chipTagVariants }
