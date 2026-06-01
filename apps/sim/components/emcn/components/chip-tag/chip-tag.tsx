'use client'

import type { HTMLAttributes, ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/core/utils/cn'

/**
 * Small inline tag/badge — 20px tall, soft tinted surface with a 1px inset ring
 * and matching tinted text. Designed for compact in-line accents (discount
 * pills, status counters, sub-labels next to titles).
 *
 * @remarks
 * Variants color the surface, ring, and text in concert. The surface uses a
 * pale tint, the ring uses a slightly stronger tint, and the text uses the
 * saturated hue. `gray` falls back to workspace tokens for neutral contexts.
 */
const chipTagVariants = cva(
  'inline-flex h-5 items-center gap-[3px] rounded-md px-1 text-sm leading-5',
  {
    variants: {
      variant: {
        blue: 'bg-[#E5EEFF] text-[#266DF0] shadow-[inset_0_0_0_1px_#D6E5FF]',
        green: 'bg-[#E0FCED] text-[#02AD6E] shadow-[inset_0_0_0_1px_#CBF7E1]',
        red: 'bg-[#FFEBEB] text-[#ED3B3B] shadow-[inset_0_0_0_1px_#FFD1D1]',
        yellow: 'bg-[#FFF3CC] text-[#CF8300] shadow-[inset_0_0_0_1px_#FFE59E]',
        purple: 'bg-[#F5F0FF] text-[#6238B5] shadow-[inset_0_0_0_1px_#E8DDFE]',
        gray: 'bg-[var(--surface-5)] text-[var(--text-secondary)] shadow-[inset_0_0_0_1px_var(--border-1)]',
      },
    },
    defaultVariants: { variant: 'blue' },
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
 * A compact tinted tag in the chip language.
 *
 * @example
 * <ChipTag variant='blue'>-20%</ChipTag>
 * <ChipTag variant='green'>New</ChipTag>
 */
export function ChipTag({ variant, className, children, ...props }: ChipTagProps) {
  return (
    <span className={cn(chipTagVariants({ variant }), className)} {...props}>
      {children}
    </span>
  )
}

export { chipTagVariants }
