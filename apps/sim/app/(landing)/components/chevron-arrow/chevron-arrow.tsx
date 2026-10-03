import { cn } from '@sim/emcn'

interface ChevronArrowProps {
  className?: string
  /** Holds the arrow in its revealed state for the currently previewed menu item. */
  active?: boolean
  strokeWidth?: number
}

/**
 * The animated chevron used on landing link rows (models, integrations). On
 * hover or keyboard focus, the leading line draws in and the arrowhead nudges right.
 * Decorative, so `aria-hidden`.
 */
export function ChevronArrow({ className, active = false, strokeWidth = 1.33 }: ChevronArrowProps) {
  return (
    <svg
      className={cn('size-3 shrink-0 text-[var(--text-muted)]', className)}
      viewBox='0 0 10 10'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
    >
      <line
        x1='0'
        y1='5'
        x2='9'
        y2='5'
        stroke='currentColor'
        strokeWidth={strokeWidth}
        strokeLinecap='square'
        className={cn(
          'origin-left transition-transform duration-200 ease-out [transform-box:fill-box] group-hover/link:scale-x-100 group-focus-visible/link:scale-x-100 motion-reduce:transition-none',
          active ? 'scale-x-100' : 'scale-x-0'
        )}
      />
      <path
        d='M3.5 2L6.5 5L3.5 8'
        stroke='currentColor'
        strokeWidth={strokeWidth}
        strokeLinecap='square'
        strokeLinejoin='miter'
        fill='none'
        className={cn(
          'transition-transform duration-200 ease-out group-hover/link:translate-x-[30%] group-focus-visible/link:translate-x-[30%] motion-reduce:transition-none',
          active && 'translate-x-[30%]'
        )}
      />
    </svg>
  )
}
