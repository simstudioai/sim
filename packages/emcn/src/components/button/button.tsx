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
  'inline-flex items-center justify-center transition-colors disabled:pointer-events-none disabled:opacity-70 outline-none focus:outline-none focus-visible:outline-none rounded-[5px]',
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
        secondary: 'bg-[var(--brand-secondary)] text-[var(--text-primary)]',
        tertiary:
          'bg-[var(--brand-accent)] text-[var(--text-inverse)] hover-hover:text-[var(--text-inverse)] hover-hover:bg-[var(--brand-accent-hover)] dark:bg-[var(--brand-accent)] dark:hover-hover:bg-[var(--brand-accent-hover)] dark:text-[var(--text-inverse)] dark:hover-hover:text-[var(--text-inverse)]',
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

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    )
  }
)

Button.displayName = 'Button'

export { Button, buttonVariants }
