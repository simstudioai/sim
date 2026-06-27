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
import { cn } from '@/lib/utils'

/**
 * Docs-local mirror of the platform chip chrome
 * (`apps/sim/components/emcn/components/chip/chip-chrome.ts`). The docs app
 * cannot import from `apps/sim`, so the canonical tokens are replicated here —
 * keep them in sync with the emcn source.
 */
export const chipContentGap = 'gap-1.5'
/** Chip pill geometry — height, centering, gap, radius, padding, text size. */
export const chipGeometryClass = `h-[30px] items-center ${chipContentGap} rounded-lg px-2 text-left text-sm`
/** Chip-content icon (non-inverse): 16px, non-shrinking, `--text-icon`. */
export const chipContentIconClass = 'size-[16px] flex-shrink-0 text-[var(--text-icon)]'
/** Chip-content label (non-inverse): truncating `--text-body` at `text-sm`. */
export const chipContentLabelClass = 'min-w-0 truncate text-[var(--text-body)] text-sm'
/** The filled FILL (surface only, no border) — `--surface-5` light / `--surface-4` dark. */
export const chipFilledFillTokens = 'bg-[var(--surface-5)] dark:bg-[var(--surface-4)]'
/** The inverse/primary FILL — dark surface + inverse text in light, white + `--bg` text in dark. */
const chipPrimaryFillTokens =
  'bg-[var(--text-primary)] text-[var(--text-inverse)] dark:bg-white dark:text-[var(--bg)]'
/** 1px `--border-1` border applied to chip triggers so they read as controls. */
export const TRIGGER_BORDER_CLASS = 'border border-[var(--border-1)]'

/**
 * 30px pill — the platform's most common chrome pattern, mirrored for the docs.
 *
 * @remarks
 * The implicit default variant is the bare pill — transparent, `--surface-active`
 * on hover. `filled` adds the filled surface; `primary` is the canonical inverse
 * CTA surface (dark in light mode, white in dark mode) used for the "Get started"
 * link.
 */
const chipVariants = cva(
  `group cursor-pointer font-season ${chipGeometryClass} transition-colors disabled:cursor-not-allowed disabled:opacity-60`,
  {
    variants: {
      variant: {
        default: 'hover:bg-[var(--surface-active)]',
        filled: `${chipFilledFillTokens} hover:bg-[var(--surface-active)]`,
        primary: `${chipPrimaryFillTokens} hover:bg-[var(--text-body)] dark:hover:bg-[var(--text-secondary)]`,
      },
      fullWidth: { true: 'flex', false: 'inline-flex' },
    },
    defaultVariants: { variant: 'default', fullWidth: false },
  }
)

type ChipIcon = ComponentType<{ className?: string }>

type ChipVariant = VariantProps<typeof chipVariants>['variant']

interface ChipBaseProps extends VariantProps<typeof chipVariants> {
  /** Icon component rendered before the label. */
  leftIcon?: ChipIcon
  /** Icon component rendered after the label. */
  rightIcon?: ChipIcon
  children?: ReactNode
}

/**
 * `primary` sets text color on the chip itself — its icon and label inherit via
 * `currentColor`. The default and `filled` chips use explicit icon
 * (`--text-icon`) and label (`--text-body`) colors.
 */
function ChipContent({
  variant,
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  children,
}: ChipBaseProps) {
  const isInverse = variant === 'primary'
  const iconClass = cn(chipContentIconClass, isInverse && 'text-current')
  const labelClass = cn(chipContentLabelClass, 'flex-1', isInverse && 'text-current')
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
 * @example <Chip leftIcon={Copy} onClick={copyPage}>Copy page</Chip>
 */
const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { className, variant, fullWidth, leftIcon, rightIcon, children, type, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(chipVariants({ variant, fullWidth }), className)}
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
 * @example <ChipLink href='https://sim.ai' variant='primary'>Get started</ChipLink>
 */
const ChipLink = forwardRef<HTMLAnchorElement, ChipLinkProps>(function ChipLink(
  { className, variant, fullWidth, leftIcon, rightIcon, children, ...props },
  ref
) {
  return (
    <Link ref={ref} className={cn(chipVariants({ variant, fullWidth }), className)} {...props}>
      <ChipContent variant={variant} leftIcon={leftIcon} rightIcon={rightIcon}>
        {children}
      </ChipContent>
    </Link>
  )
})

interface ChipChevronDownProps {
  /** Layout-only extras (e.g. `ml-auto` to push the chevron flush right). Never chrome. */
  className?: string
}

/**
 * Canonical trailing chevron adornment for chip-style dropdown triggers — a
 * 16px hidden-from-AT slot centering the 10×6 chevron glyph in `--text-icon`,
 * matching the chevron `ChipDropdown` owns in the main app.
 */
export function ChipChevronDown({ className }: ChipChevronDownProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-[16px] flex-shrink-0 items-center justify-center text-[var(--text-icon)]',
        className
      )}
    >
      <svg width='10' height='6' viewBox='0 0 10 6' fill='none'>
        <path
          d='M1 1L5 5L9 1'
          stroke='currentColor'
          strokeWidth='1.33'
          strokeLinecap='square'
          strokeLinejoin='miter'
        />
      </svg>
    </span>
  )
}

export { Chip, ChipLink, chipVariants }
export type { ChipLinkProps, ChipProps, ChipVariant }
