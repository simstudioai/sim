'use client'

import type { ComponentType, HTMLAttributes, MouseEventHandler, ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

/**
 * Small inline tag/badge — 20px tall neutral surface for compact in-line accents
 * (discount pills, status counters, sub-labels next to titles, invite chips).
 *
 * @remarks
 * Variants, theme-aware via workspace tokens:
 * - `mono` — borderless, sharing the {@link ChipSwitch} trough surface
 *   (`--surface-5` light / `--surface-4` dark) with strong `--text-primary` text
 *   for emphasis (e.g. a discount next to a primary CTA).
 * - `gray` — a light surface over a slightly darker inset ring with muted
 *   `--text-secondary` text for low-emphasis status labels.
 * - `invite` — recipient pill used in invite/sharing flows. Borrows the chip
 *   family's icon gap (`gap-1.5`), `--text-body` label, and `--text-icon`
 *   leading/trailing icons; pairs with the `invalid` boolean to flip to an
 *   error surface (e.g. for invalid email entries) without layout shift.
 */
const chipTagVariants = cva(
  'inline-flex items-center rounded-md text-sm leading-5 transition-colors',
  {
    variants: {
      variant: {
        mono: 'h-5 gap-[3px] px-1 bg-[var(--surface-5)] text-[var(--text-primary)] dark:bg-[var(--surface-4)]',
        gray: 'h-5 gap-[3px] px-1 bg-[var(--surface-5)] text-[var(--text-secondary)] shadow-[inset_0_0_0_1px_var(--border-1)]',
        invite:
          'h-5 gap-1.5 px-1 bg-[var(--surface-5)] text-[var(--text-body)] shadow-[inset_0_0_0_1px_var(--border-1)] dark:bg-[var(--surface-4)]',
      },
      invalid: { true: '', false: '' },
    },
    compoundVariants: [
      {
        variant: 'invite',
        invalid: true,
        className: 'bg-[var(--badge-error-bg)] text-[var(--text-error)] shadow-none',
      },
    ],
    defaultVariants: { variant: 'mono', invalid: false },
  }
)

type ChipTagIcon = ComponentType<{ className?: string }>

/**
 * Props for {@link ChipTag}.
 */
export interface ChipTagProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'>,
    VariantProps<typeof chipTagVariants> {
  /** Tag content — typically a short label, number, percentage, or recipient. */
  children: ReactNode
  /** Icon component rendered before the label. Non-interactive. */
  leftIcon?: ChipTagIcon
  /**
   * Icon component rendered after the label. Becomes a `<button>` with an
   * extended hit area when `onRightIconClick` is set (e.g. removable chip).
   */
  rightIcon?: ChipTagIcon
  /** Click handler that upgrades `rightIcon` into an interactive button. */
  onRightIconClick?: MouseEventHandler<HTMLButtonElement>
  /** Accessible label for the right-icon button. Required when interactive. */
  rightIconLabel?: string
  /** Disables the interactive right-icon button. */
  rightIconDisabled?: boolean
}

/**
 * A compact neutral tag in the chip language.
 *
 * @example
 * <ChipTag variant='mono'>-20%</ChipTag>
 * <ChipTag variant='gray'>Your plan</ChipTag>
 * <ChipTag
 *   variant='invite'
 *   invalid={!isValidEmail}
 *   leftIcon={isValidEmail ? undefined : AlertTriangle}
 *   rightIcon={X}
 *   rightIconLabel={`Remove ${email}`}
 *   onRightIconClick={handleRemove}
 * >
 *   {email}
 * </ChipTag>
 */
export function ChipTag({
  variant,
  invalid,
  className,
  children,
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  onRightIconClick,
  rightIconLabel,
  rightIconDisabled,
  ...props
}: ChipTagProps) {
  const iconClass = cn('size-[14px] flex-shrink-0', !invalid && 'text-[var(--text-icon)]')
  const interactive = RightIcon != null && onRightIconClick != null

  return (
    <span className={cn(chipTagVariants({ variant, invalid }), className)} {...props}>
      {LeftIcon ? <LeftIcon className={iconClass} /> : null}
      {children}
      {RightIcon ? (
        interactive ? (
          <button
            type='button'
            onClick={onRightIconClick}
            disabled={rightIconDisabled}
            aria-label={rightIconLabel}
            className='relative flex flex-shrink-0 items-center opacity-80 transition-opacity before:absolute before:inset-[-8px] before:content-[""] hover-hover:opacity-100 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50'
          >
            <RightIcon className={iconClass} />
          </button>
        ) : (
          <RightIcon className={iconClass} />
        )
      ) : null}
    </span>
  )
}

export { chipTagVariants }
