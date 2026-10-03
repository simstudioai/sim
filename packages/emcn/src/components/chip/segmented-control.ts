import { cva } from 'class-variance-authority'
import { cn } from '../../lib/cn'
import { chipVariants } from './chip'
import { chipFilledFillTokens, chipGeometryClass } from './chip-chrome'

/** Shared 30px chip geometry for segmented controls, including their inset. */
export const segmentedControlVariants = cva(
  cn(
    chipGeometryClass,
    chipFilledFillTokens,
    'inline-flex w-fit max-w-full gap-0 overflow-x-auto p-[2px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
  ),
  {
    variants: {
      gap: { none: 'gap-0', sm: 'gap-0.5' },
      size: { default: '', compact: 'h-[22px]' },
    },
    defaultVariants: { gap: 'none', size: 'default' },
  }
)

/** The selected segment keeps its raised surface through hover. */
export const segmentedControlItemVariants = cva(
  cn(
    chipVariants(),
    'h-full shrink-0 justify-center whitespace-nowrap rounded-[calc(var(--radius-lg)-2px)] outline-hidden focus:outline-hidden focus-visible:outline-hidden'
  ),
  {
    variants: {
      size: { default: '', compact: 'px-1.5 text-xs' },
      active: {
        true: 'bg-[var(--surface-2)] text-[var(--text-body)] hover-hover:bg-[var(--surface-2)] dark:bg-[var(--surface-6)] dark:hover-hover:bg-[var(--surface-6)]',
        false:
          'text-[var(--text-muted)] hover-hover:bg-transparent hover-hover:text-[var(--text-body)]',
      },
    },
    defaultVariants: { active: false, size: 'default' },
  }
)
