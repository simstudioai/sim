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
import { OverflowText, overflowTextClipClass } from '../overflow-text/overflow-text'
import {
  chipActiveSurfaceClass,
  chipBorderShadowRing,
  chipContentGeometryClass,
  chipContentIconClass,
  chipContentLabelClass,
  chipFilledFillTokens,
  chipHoverSurfaceClass,
  chipPrimaryFillTokens,
  chipRadiusClass,
  chipSizeClasses,
} from './chip-chrome'

/**
 * 30px pill (36px with `size="lg"` at the default root font size) — the platform's most common chrome pattern.
 *
 * Render targets:
 * - {@link Chip} → `<button>`
 * - {@link ChipLink} → Next.js `<Link>`
 * - `chipVariants({...})` → any other element (`<div role='button'>`, `<DropdownMenuTrigger asChild>` inner, etc.)
 *
 * @remarks
 * The implicit **default** variant is the bare pill — transparent, `--surface-hover` on hover. Omit `variant`
 * to get it (shadcn-style); never write `variant='default'`. Named variants:
 * `filled` (`--surface-5` light / `--surface-4` dark fill, `--surface-hover` hover) — a borderless surface reserved for
 * chip FIELDS/TRIGGERS ({@link ChipInput}/{@link ChipSelect}/{@link ChipDatePicker}), **never `Chip`
 * itself**; those triggers add the `--border-1` outline themselves via `TRIGGER_BORDER_CLASS`;
 * `primary` (inverse surface), `destructive` (error-token surface), `border-shadow` (raised card-like surface),
 * `border` (the `border-shadow` shadow ring on a transparent surface — an outline drawn purely via box-shadow,
 * no CSS border, no fill); outline (a true border with no shadow or hover fill).
 * `active` renders the default/filled chip in its selected state — `--surface-active`, held through hover.
 * `align="center"` centers the complete icon/label group while allowing long labels to shrink.
 * `fullWidth` swaps `inline-flex` for block-level `flex`.
 * `shape` picks the corner radius: the implicit `default` is the `rounded-lg` pill; `round` is fully round
 * (`rounded-full`) for a chip sitting in a row of round controls. The radius lives in this variant rather than
 * in the base string so a raw `chipVariants({ shape: 'round' })` consumer emits exactly one radius.
 *
 * The chip carries NO outer margin — spacing between chips belongs to the parent, as a `gap`. It used to ship a
 * default `mx-0.5` "cluster margin" with a `flush` prop to switch it off, which meant a chip's visual box was not
 * its layout box: changing the space between two chips took an edit in two places, and a collapsing container
 * could never close past the margins. Do not reintroduce it.
 *
 * The default/filled hover lives in `active`-keyed compound variants (not the base variant string) so the
 * rest/hover classes are mutually exclusive — a chip renders AT MOST ONE `hover-hover:bg-*`. This keeps raw
 * `chipVariants({...})` consumers identical to `cn(chipVariants({...}))` ones; folding the non-active hover back
 * into the variant string would emit two conflicting hover classes that only `cn`'s tailwind-merge resolves,
 * silently diverging raw consumers (e.g. an active row that darkens with `Chip` but not with raw `chipVariants`).
 * The two surfaces themselves, and why an active chip takes no hover class at all, are documented on
 * {@link chipHoverSurfaceClass}.
 */
const chipVariants = cva(
  `group cursor-pointer ${chipContentGeometryClass} transition-colors disabled:cursor-not-allowed disabled:opacity-60`,
  {
    variants: {
      variant: {
        default: '',
        filled: chipFilledFillTokens,
        primary: `${chipPrimaryFillTokens} hover-hover:bg-[var(--text-body)] hover-hover:text-[var(--text-inverse)] dark:hover-hover:bg-[var(--text-secondary)] dark:hover-hover:text-[var(--bg)]`,
        destructive:
          'bg-[var(--text-error)] text-white hover-hover:text-white hover-hover:brightness-106',
        'border-shadow': `${chipBorderShadowRing} bg-[var(--surface-2)] hover-hover:bg-[var(--surface-3)] dark:hover-hover:bg-[var(--surface-4)]`,
        border: `${chipBorderShadowRing} ${chipHoverSurfaceClass}`,
        outline:
          'border border-[var(--border)] bg-transparent hover-hover:border-[color-mix(in_srgb,var(--border)_80%,var(--text-secondary))]',
      },
      size: chipSizeClasses,
      align: { start: '', center: 'justify-center' },
      shape: { default: chipRadiusClass, round: 'rounded-full' },
      active: { true: '', false: '' },
      fullWidth: { true: 'flex w-full', false: 'inline-flex' },
    },
    compoundVariants: [
      { variant: ['default', 'filled'], active: false, className: chipHoverSurfaceClass },
      { variant: ['default', 'filled'], active: true, className: chipActiveSurfaceClass },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'md',
      align: 'start',
      shape: 'default',
      active: false,
      fullWidth: false,
    },
  }
)

type ChipIcon = ComponentType<{ className?: string }>

/**
 * Variants a `Chip`/`ChipLink` may render. The `default` (bare) chip is implicit
 * — omit `variant` to get it — and `filled` is excluded by design: it is reserved
 * for chip fields/triggers, never `Chip` itself. For a selected/toggle chip use
 * the `active` prop, not a variant.
 */
type ChipVariant = 'primary' | 'destructive' | 'border-shadow' | 'border' | 'outline'

interface ChipBaseProps extends Omit<VariantProps<typeof chipVariants>, 'variant'> {
  variant?: ChipVariant
  /** Icon component rendered before the label. */
  leftIcon?: ChipIcon
  /** Custom content rendered before the label. Takes precedence over `leftIcon`. */
  leftAdornment?: ReactNode
  /** Icon component rendered after the label. */
  rightIcon?: ChipIcon
  /** Custom content rendered after the label, such as a spinning loader. Takes precedence over `rightIcon`. */
  rightAdornment?: ReactNode
  children?: ReactNode
}

/**
 * `primary` and `destructive` set text color on the chip itself — their icon
 * and label inherit via `currentColor`. The default and `filled` chips need
 * explicit icon (`--text-icon`) and label (`--text-body`) colors.
 */
function ChipContent({
  variant,
  align,
  leftIcon: LeftIcon,
  leftAdornment,
  rightIcon: RightIcon,
  rightAdornment,
  children,
}: ChipBaseProps) {
  const isInverse = variant === 'primary' || variant === 'destructive'
  const iconClass = cn(chipContentIconClass, isInverse && 'text-current')
  const labelClass = cn(
    chipContentLabelClass,
    align === 'center' ? 'flex-initial' : 'flex-1',
    isInverse && 'text-current'
  )
  const textLabel =
    typeof children === 'string' || typeof children === 'number' ? String(children) : null
  return (
    <>
      {leftAdornment ?? (LeftIcon ? <LeftIcon className={iconClass} /> : null)}
      {textLabel != null ? (
        <OverflowText label={textLabel} className={labelClass} focusTarget='nearest-interactive' />
      ) : children != null && children !== false ? (
        <span className={cn(overflowTextClipClass, labelClass)}>{children}</span>
      ) : null}
      {rightAdornment ?? (RightIcon ? <RightIcon className={iconClass} /> : null)}
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
  {
    className,
    variant,
    size,
    align,
    shape,
    active,
    fullWidth,
    leftIcon,
    leftAdornment,
    rightIcon,
    rightAdornment,
    children,
    type,
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(chipVariants({ variant, size, align, shape, active, fullWidth }), className)}
      {...props}
    >
      <ChipContent
        variant={variant}
        align={align}
        leftIcon={leftIcon}
        leftAdornment={leftAdornment}
        rightIcon={rightIcon}
        rightAdornment={rightAdornment}
      >
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
  {
    className,
    variant,
    size,
    align,
    shape,
    active,
    fullWidth,
    leftIcon,
    leftAdornment,
    rightIcon,
    rightAdornment,
    children,
    ...props
  },
  ref
) {
  return (
    <Link
      ref={ref}
      className={cn(chipVariants({ variant, size, align, shape, active, fullWidth }), className)}
      {...props}
    >
      <ChipContent
        variant={variant}
        align={align}
        leftIcon={leftIcon}
        leftAdornment={leftAdornment}
        rightIcon={rightIcon}
        rightAdornment={rightAdornment}
      >
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
