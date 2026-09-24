import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

/**
 * `size='icon'` is the square 20px icon-only button — a chip field's trailing
 * affordance, a toast dismiss, a section-header action. It drops the text padding
 * the `sm`/`md` sizes carry and tightens the radius to `rounded-sm` (4px), which
 * reads correctly at this size where the base 5px does not. The box is deliberately
 * larger than every glyph it holds; that margin IS the button's padding, since the
 * glyph is sized at the call site rather than here.
 *
 * Glyphs also draw one step thinner than the 1.55 the icon set ships, so a lone
 * icon reads as a secondary affordance rather than a piece of UI text. CSS wins
 * over the SVG's own `stroke-width` attribute, so this reaches every stroked icon
 * without touching the icon components — including the few that ship at 2.
 *
 * Compose it with `quiet` (the usual choice) or `ghost` (where the surrounding
 * surface owns the hover) — those pairings also pick up the muted icon color.
 *
 * @example <Button variant='quiet' size='icon' aria-label='Dismiss'><X className='size-[16px]' /></Button>
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center transition-colors disabled:pointer-events-none disabled:opacity-70 outline-hidden focus:outline-hidden focus-visible:outline-hidden rounded-[5px]',
  {
    variants: {
      variant: {
        default:
          'text-[var(--text-secondary)] hover-hover:text-[var(--text-primary)] bg-[var(--surface-4)] hover-hover:bg-[var(--surface-6)] border border-[var(--border)] hover-hover:border-[var(--border-1)] dark:hover-hover:bg-[var(--surface-5)]',
        active:
          'bg-[var(--surface-5)] hover-hover:bg-[var(--surface-6)] text-[var(--text-primary)] hover-hover:text-[var(--text-primary)] border border-[var(--border-1)] hover-hover:border-[var(--border-1)] dark:hover-hover:bg-[var(--border-1)]',
        '3d': 'text-[var(--text-tertiary)] border-t border-l border-r border-[var(--border-1)] shadow-[0_2px_0_0_var(--border-1)] hover-hover:shadow-[0_4px_0_0_var(--border-1)] transition-[transform,box-shadow,color] hover-hover:-translate-y-0.5 hover-hover:text-[var(--text-primary)]',
        outline:
          'text-[var(--text-secondary)] hover-hover:text-[var(--text-primary)] border border-[var(--text-muted)] bg-transparent hover-hover:border-[var(--text-secondary)]',
        primary:
          'bg-[var(--text-primary)] text-[var(--text-inverse)] hover-hover:text-[var(--text-inverse)] hover-hover:bg-[var(--text-body)] dark:bg-white dark:text-[var(--bg)] dark:hover-hover:bg-[var(--text-secondary)] dark:hover-hover:text-[var(--bg)]',
        destructive:
          'bg-[var(--text-error)] text-white hover-hover:text-white hover-hover:brightness-106',
        ghost: 'text-[var(--text-secondary)] hover-hover:text-[var(--text-primary)]',
        subtle:
          'text-[var(--text-body)] hover-hover:text-[var(--text-body)] hover-hover:bg-[var(--surface-4)]',
        'ghost-secondary': 'text-[var(--text-muted)] hover-hover:text-[var(--text-primary)]',
        quiet: 'text-[var(--text-secondary)] hover-hover:bg-[var(--surface-active)]',
      },
      size: {
        sm: 'px-1.5 py-1 text-[length:11px]',
        md: 'px-2 py-1.5 text-[length:12px]',
        icon: 'size-[20px] rounded-sm p-0 [&_svg]:[stroke-width:1.25]',
        inline: 'h-[20px] px-1.5 py-0 text-caption',
      },
      iconSize: {
        compact: 'size-6 p-0',
        'compact-fixed': 'size-[24px] p-0',
        regular: 'size-7 p-0',
        roomy: 'size-8 p-0',
        touch: 'size-10 p-0',
      },
      shape: {
        round: 'rounded-full',
      },
      iconPadding: {
        sm: 'p-1',
        md: 'p-1.5',
      },
    },
    compoundVariants: [
      /**
       * A lone glyph is icon content, not text, so the neutral icon buttons paint
       * with `--text-icon-muted` rather than the variant's text color. Scoped to
       * the neutral variants: the filled ones (`primary`, `destructive`, …) carry
       * inverse text that must keep winning over their own surface.
       */
      { size: 'icon', variant: 'quiet', className: 'text-[var(--text-icon-muted)]' },
      { size: 'icon', variant: 'ghost', className: 'text-[var(--text-icon-muted)]' },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
)

type ButtonIconSize = NonNullable<VariantProps<typeof buttonVariants>['iconSize']>

const responsiveIconSizes = {
  compact: 'sm:size-6',
  'compact-fixed': 'sm:size-[24px]',
  regular: 'sm:size-7',
  roomy: 'sm:size-8',
  touch: 'sm:size-10',
} as const satisfies Record<ButtonIconSize, string>

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    Omit<VariantProps<typeof buttonVariants>, 'iconSize'> {
  /**
   * Square icon-action geometry without changing the selected size's typography,
   * corner radius, icon stroke or color. `compact` follows the spacing scale
   * (24px at the default root font size); `compact-fixed` stays at 24px.
   * Regular, roomy and touch follow the spacing scale (28px, 32px and 40px
   * at the default root font size). A responsive
   * value changes geometry at the standard sm breakpoint. All remove padding;
   * explicit iconPadding or className can override it.
   * Omit to retain the selected size's geometry.
   * @example <Button variant='ghost' iconSize='compact' aria-label='Remove'><X /></Button>
   */
  iconSize?: ButtonIconSize | { base: ButtonIconSize; sm?: ButtonIconSize } | null
  /**
   * Symmetric padding for icon actions whose content or layout determines their size.
   * Preserves the selected size's typography, corner radius and icon stroke.
   * Omit for the standard size padding, including the fixed `size='icon'` treatment.
   * @example <Button variant='ghost' iconPadding='sm' aria-label='Copy'><Clipboard /></Button>
   */
  iconPadding?: VariantProps<typeof buttonVariants>['iconPadding']
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, iconSize, iconPadding, shape, ...props }, ref) => {
    const baseIconSize = typeof iconSize === 'object' ? iconSize?.base : iconSize
    const smIconSize = typeof iconSize === 'object' ? iconSize?.sm : undefined
    return (
      <button
        ref={ref}
        className={cn(
          buttonVariants({
            variant,
            size,
            iconSize: baseIconSize,
            iconPadding,
            shape,
          }),
          smIconSize && responsiveIconSizes[smIconSize],
          className
        )}
        {...props}
      />
    )
  }
)

Button.displayName = 'Button'

export { Button, buttonVariants }
