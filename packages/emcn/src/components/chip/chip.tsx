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
import { cn } from '../../lib/cn'
import {
  chipContentIconClass,
  chipContentLabelClass,
  chipFilledFillTokens,
  chipGeometryClass,
  chipPrimaryFillTokens,
} from './chip-chrome'

/**
 * 30px pill — the platform's most common chrome pattern.
 *
 * Render targets:
 * - {@link Chip} → `<button>`
 * - {@link ChipLink} → Next.js `<Link>`
 * - `chipVariants({...})` → any other element (`<div role='button'>`, `<DropdownMenuTrigger asChild>` inner, etc.)
 *
 * @remarks
 * The implicit **default** variant is the bare pill — transparent, `--surface-active` on hover. Omit `variant`
 * to get it (shadcn-style); never write `variant='default'`. Named variants:
 * `filled` (`--surface-5` light / `--surface-4` dark fill, `--surface-active` hover) — a borderless surface reserved for
 * chip FIELDS/TRIGGERS ({@link ChipInput}/{@link ChipDropdown}/{@link ChipSelect}/{@link ChipDatePicker}), **never `Chip`
 * itself**; those triggers add the `--border-1` outline themselves via `TRIGGER_BORDER_CLASS`;
 * `primary` (inverse surface), `destructive` (error-token surface), `border-shadow` (raised card-like surface),
 * `border` (the `border-shadow` shadow ring on a transparent surface — an outline drawn purely via box-shadow,
 * no CSS border, no fill).
 * `active` renders the default/filled chip in its selected state — `--surface-active` at rest, one surface darker
 * (`--surface-6`) on hover. `fullWidth` swaps `inline-flex` for block-level `flex`. `flush` removes the default
 * `mx-0.5` cluster margin — use when a single chip sits in its own layout slot (grid/table cell).
 *
 * The default/filled hover lives in `active`-keyed compound variants (not the base variant string) so the
 * rest/hover classes are mutually exclusive — a chip renders exactly ONE `hover-hover:bg-*`. This keeps raw
 * `chipVariants({...})` consumers identical to `cn(chipVariants({...}))` ones; folding the non-active hover back
 * into the variant string would emit two conflicting hover classes that only `cn`'s tailwind-merge resolves,
 * silently diverging raw consumers (e.g. an active row that darkens with `Chip` but not with raw `chipVariants`).
 */
const chipVariants = cva(
  `group cursor-pointer ${chipGeometryClass} transition-colors disabled:cursor-not-allowed disabled:opacity-60`,
  {
    variants: {
      variant: {
        default: '',
        filled: chipFilledFillTokens,
        primary: `${chipPrimaryFillTokens} hover-hover:bg-[var(--text-body)] hover-hover:text-[var(--text-inverse)] dark:hover-hover:bg-[var(--text-secondary)] dark:hover-hover:text-[var(--bg)]`,
        destructive:
          'bg-[var(--text-error)] text-white hover-hover:text-white hover-hover:brightness-106',
        'border-shadow':
          'bg-[var(--surface-2)] shadow-[0_0_0_1px_rgba(28,40,64,0.08),0_1px_3px_0_rgba(28,40,64,0.1)] hover-hover:bg-[var(--surface-3)] dark:shadow-[0_0_0_1px_var(--border-1),0_1px_3px_0_rgba(0,0,0,0.3)] dark:hover-hover:bg-[var(--surface-4)]',
        border:
          'shadow-[0_0_0_1px_rgba(28,40,64,0.08),0_1px_3px_0_rgba(28,40,64,0.1)] hover-hover:bg-[var(--surface-active)] dark:shadow-[0_0_0_1px_var(--border-1),0_1px_3px_0_rgba(0,0,0,0.3)]',
      },
      active: { true: '', false: '' },
      fullWidth: { true: 'flex', false: 'inline-flex' },
      flush: { true: 'mx-0', false: 'mx-0.5' },
    },
    compoundVariants: [
      {
        variant: 'default',
        active: false,
        className: 'hover-hover:bg-[var(--surface-active)]',
      },
      {
        variant: 'default',
        active: true,
        className: 'bg-[var(--surface-active)] hover-hover:bg-[var(--surface-6)]',
      },
      {
        variant: 'filled',
        active: false,
        className: 'hover-hover:bg-[var(--surface-active)]',
      },
      {
        variant: 'filled',
        active: true,
        className: 'bg-[var(--surface-active)] hover-hover:bg-[var(--surface-6)]',
      },
    ],
    defaultVariants: { variant: 'default', active: false, fullWidth: false, flush: false },
  }
)

type ChipIcon = ComponentType<{ className?: string }>

/**
 * Variants a `Chip`/`ChipLink` may render. The `default` (bare) chip is implicit
 * — omit `variant` to get it — and `filled` is excluded by design: it is reserved
 * for chip fields/triggers, never `Chip` itself. For a selected/toggle chip use
 * the `active` prop, not a variant.
 */
type ChipVariant = 'primary' | 'destructive' | 'border-shadow' | 'border'

interface ChipBaseProps extends Omit<VariantProps<typeof chipVariants>, 'variant'> {
  variant?: ChipVariant
  /** Icon component rendered before the label. */
  leftIcon?: ChipIcon
  /** Icon component rendered after the label. */
  rightIcon?: ChipIcon
  children?: ReactNode
}

/**
 * `primary` and `destructive` set text color on the chip itself — their icon
 * and label inherit via `currentColor`. The default and `filled` chips need
 * explicit icon (`--text-icon`) and label (`--text-body`) colors.
 */
function ChipContent({
  variant,
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  children,
}: ChipBaseProps) {
  const isInverse = variant === 'primary' || variant === 'destructive'
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
 * 1px border applied to `filled` and default chip triggers to read as
 * interactive form controls rather than static pills. Omitted on `primary`,
 * `destructive`, and `border-shadow` variants which carry their own surface
 * treatment.
 */
export const TRIGGER_BORDER_CLASS = 'border border-[var(--border-1)]'

export { Chip, ChipLink, chipVariants }
export type { ChipLinkProps, ChipProps }
