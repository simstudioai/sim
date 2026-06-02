'use client'

import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ComponentType,
  forwardRef,
  type ReactNode,
} from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import Link, { type LinkProps } from 'next/link'
import { cn } from '@/lib/core/utils/cn'

/**
 * 30px pill — the platform's most common chrome pattern.
 *
 * Render targets:
 * - {@link Chip} → `<button>`
 * - {@link ChipLink} → Next.js `<Link>`
 * - `chipVariants({...})` → any other element (`<div role='button'>`, `<DropdownMenuTrigger asChild>` inner, etc.)
 *
 * @remarks
 * Variants: `ghost` (transparent → `--surface-active` hover), `filled` (`--surface-active` → `--surface-6` hover),
 * `primary` (inverse surface), `destructive` (error-token surface, `--text-error`),
 * `border-shadow` (raised card-like surface with `--border-1` border and `--shadow-card`).
 * `active` renders ghost/filled in their selected state. `fullWidth` swaps `inline-flex` for block-level `flex`.
 * `flush` removes the default horizontal margin (`mx-0.5`) used by chip clusters — use when a single chip sits
 * inside its own layout slot (grid cell, table cell) where the cluster spacing is unwanted.
 */
const chipVariants = cva(
  'group h-[30px] cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60',
  {
    variants: {
      variant: {
        ghost: 'hover-hover:bg-[var(--surface-active)]',
        filled:
          'border border-[var(--border-1)] bg-[var(--surface-5)] hover-hover:bg-[var(--surface-active)] dark:bg-[var(--surface-4)]',
        primary:
          'bg-[var(--text-primary)] text-[var(--text-inverse)] hover-hover:bg-[var(--text-body)] hover-hover:text-[var(--text-inverse)] dark:bg-white dark:text-[var(--bg)] dark:hover-hover:bg-[var(--text-secondary)] dark:hover-hover:text-[var(--bg)]',
        destructive:
          'bg-[var(--text-error)] text-white hover-hover:text-white hover-hover:brightness-106',
        'border-shadow':
          'bg-[var(--surface-2)] shadow-[0_0_0_1px_rgba(28,40,64,0.08),0_1px_3px_0_rgba(28,40,64,0.1)] hover-hover:bg-[var(--surface-3)]',
      },
      active: { true: '', false: '' },
      fullWidth: { true: 'flex', false: 'inline-flex' },
      flush: { true: 'mx-0', false: 'mx-0.5' },
    },
    compoundVariants: [
      { variant: 'ghost', active: true, className: 'bg-[var(--surface-active)]' },
      { variant: 'filled', active: true, className: 'bg-[var(--surface-active)]' },
    ],
    defaultVariants: { variant: 'ghost', active: false, fullWidth: false, flush: false },
  }
)

type ChipIcon = ComponentType<{ className?: string }>

interface ChipBaseProps extends VariantProps<typeof chipVariants> {
  /** Icon component rendered before the label. */
  leftIcon?: ChipIcon
  /** Icon component rendered after the label. */
  rightIcon?: ChipIcon
  children?: ReactNode
}

/**
 * `primary` and `destructive` set text color on the chip itself — their icon
 * and label inherit via `currentColor`. `ghost` and `filled` need explicit
 * icon (`--text-icon`) and label (`--text-body`) colors.
 */
function ChipContent({
  variant,
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  children,
}: ChipBaseProps) {
  const isInverse = variant === 'primary' || variant === 'destructive'
  const iconClass = cn('size-[16px] flex-shrink-0', !isInverse && 'text-[var(--text-icon)]')
  const labelClass = cn('min-w-0 flex-1 truncate text-sm', !isInverse && 'text-[var(--text-body)]')
  return (
    <>
      {LeftIcon ? <LeftIcon className={iconClass} /> : null}
      {children != null && children !== false ? (
        <span className={labelClass}>{children}</span>
      ) : null}
      {RightIcon ? <RightIcon className={iconClass} /> : null}
    </>
  )
}

interface ChipProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>,
    ChipBaseProps {}

/**
 * @example <Chip leftIcon={Credit} onClick={openBilling}>{balance}</Chip>
 */
const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { className, variant, active, fullWidth, flush, leftIcon, rightIcon, children, type, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(chipVariants({ variant, active, fullWidth, flush }), className)}
      {...props}
    >
      <ChipContent variant={variant} leftIcon={leftIcon} rightIcon={rightIcon}>
        {children}
      </ChipContent>
    </button>
  )
})

interface ChipLinkProps
  extends Omit<LinkProps, 'children'>,
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps | 'children'>,
    ChipBaseProps {}

/**
 * @example <ChipLink href='/integrations' active={isCurrent} leftIcon={ArrowLeft}>Integrations</ChipLink>
 */
const ChipLink = forwardRef<HTMLAnchorElement, ChipLinkProps>(function ChipLink(
  { className, variant, active, fullWidth, flush, leftIcon, rightIcon, children, ...props },
  ref
) {
  return (
    <Link
      ref={ref}
      className={cn(chipVariants({ variant, active, fullWidth, flush }), className)}
      {...props}
    >
      <ChipContent variant={variant} leftIcon={leftIcon} rightIcon={rightIcon}>
        {children}
      </ChipContent>
    </Link>
  )
})

/**
 * 1px border applied to `filled` and `ghost` chip triggers to read as
 * interactive form controls rather than static pills. Omitted on `primary`,
 * `destructive`, and `border-shadow` variants which carry their own surface
 * treatment.
 */
export const TRIGGER_BORDER_CLASS = 'border border-[var(--border-1)]'

export { Chip, ChipLink, chipVariants }
export type { ChipLinkProps, ChipProps }
