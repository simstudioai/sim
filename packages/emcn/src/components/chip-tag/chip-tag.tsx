'use client'

import type {
  ComponentType,
  CSSProperties,
  HTMLAttributes,
  MouseEventHandler,
  ReactNode,
} from 'react'
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
 *   for emphasis (e.g. a discount next to a primary CTA). Because its fill *is*
 *   the trough/field surface, it disappears on one — use `field` there.
 * - `field` — `mono` with the fill stepped one level away from the form-field
 *   surface (`--surface-6` light / `--surface-3` dark), so the pill stays legible
 *   when it sits *on* a `--surface-5` input, combobox trigger, or tag container.
 * - `gray` — a light surface over a slightly darker inset ring with muted
 *   `--text-secondary` text for low-emphasis status labels.
 * - `solid` — a filled inverse tag: a dark neutral surface (`--text-secondary`)
 *   with inverse text (`--text-inverse`), mirroring {@link Chip}'s `primary`
 *   inverse-surface convention one step softer than near-black. For eyebrow
 *   kickers and emphasis labels that should read as a solid chip rather than a
 *   bordered one.
 * - `workflow` — the brand type cue for workflow cards. Pair with `tone`; the
 *   icon inherits the label colour and remains the non-colour identifier.
 *
 *   These are fixed brand values, not derived ones — do not "correct" a hex
 *   for contrast or gamut. Labels use `#F8F8F8` on dark semantic fills and
 *   `#1A1A1A` on light fills; the content tone uses true white (`#FFFFFF`) on
 *   `#007E80`. `#3B3B3B` appears only as `inverse`'s fill, never as text. One
 *   value serves both modes; the tones carry no `dark:` overrides.
 *
 *   Contrast against the paired ink varies, and two pairs sit under WCAG AA
 *   (4.5:1) for normal text: `green` at 3.98:1 and `orange` at 3.15:1. These
 *   are brand decisions rather than oversights.
 *   Because the label is short and always duplicated by an icon and the block
 *   name beside it, the tag is a redundant cue rather than the sole carrier of
 *   the information — but do not reuse these pairings anywhere the label
 *   stands alone.
 *
 *   `neutral` is the only tone that is not a solid fill — neutral/system blocks
 *   and unmapped block types read as white, outlined slots rather than as one
 *   more colour in the set. Every other tone is fill-only, so it is also the
 *   only one whose edge depends on the ring rather than on the fill itself.
 * - `brand` — a provider-owned integration colour supplied through
 *   `brandColor`. Pair with `brandForeground` so both the icon and label use
 *   the same contrast rule as integration tiles elsewhere in the product.
 *   `brandStrokeColor` adds an optional inset outline without changing the
 *   tag's canonical dimensions.
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
        field:
          'h-5 gap-[3px] px-1 bg-[var(--surface-6)] text-[var(--text-primary)] dark:bg-[var(--surface-3)]',
        gray: 'h-5 gap-[3px] px-1 border border-[var(--border-1)] bg-[var(--surface-5)] text-[var(--text-secondary)]',
        solid: 'h-5 gap-[3px] px-1 bg-[var(--text-secondary)] text-[var(--text-inverse)]',
        workflow: 'h-5 gap-[3px] px-1',
        brand: 'h-5 gap-[3px] px-1',
        invite:
          'h-5 gap-1.5 px-1 border border-[var(--border-1)] bg-[var(--surface-5)] text-[var(--text-body)] dark:bg-[var(--surface-4)]',
      },
      invalid: { true: '', false: '' },
      tone: {
        neutral: '',
        inverse: '',
        ash: '',
        orange: '',
        blue: '',
        green: '',
        yellow: '',
        purple: '',
        identity: '',
        content: '',
      },
      brandForeground: {
        light: '',
        dark: '',
      },
    },
    compoundVariants: [
      {
        variant: 'invite',
        invalid: true,
        className: 'bg-[var(--badge-error-bg)] text-[var(--text-error)] border-transparent',
      },
      {
        variant: 'workflow',
        tone: 'neutral',
        /* The only outlined tone. Neutral/system and unmapped block types read
           as empty slots rather than a colour, so the fill is plain white and
           an inset ring — not a border — carries the edge, keeping the tag the
           same size as every filled sibling. */
        className: 'bg-[#FFFFFF] text-[#1A1A1A] shadow-[inset_0_0_0_1px_#C3C3C3]',
      },
      { variant: 'workflow', tone: 'inverse', className: 'bg-[#3B3B3B] text-[#F8F8F8]' },
      { variant: 'workflow', tone: 'ash', className: 'bg-[#E6E6E6] text-[#1A1A1A]' },
      { variant: 'workflow', tone: 'orange', className: 'bg-[#FF4C00] text-[#F8F8F8]' },
      { variant: 'workflow', tone: 'blue', className: 'bg-[#0062FF] text-[#F8F8F8]' },
      { variant: 'workflow', tone: 'green', className: 'bg-[#188F00] text-[#F8F8F8]' },
      { variant: 'workflow', tone: 'yellow', className: 'bg-[#FFEF08] text-[#1A1A1A]' },
      { variant: 'workflow', tone: 'purple', className: 'bg-[#AA00FF] text-[#F8F8F8]' },
      { variant: 'workflow', tone: 'identity', className: 'bg-[#8B5CF6] text-[#F8F8F8]' },
      { variant: 'workflow', tone: 'content', className: 'bg-[#007E80] text-[#FFFFFF]' },
      { variant: 'brand', brandForeground: 'light', className: 'text-[#FFFFFF]' },
      { variant: 'brand', brandForeground: 'dark', className: 'text-[#000000]' },
    ],
    defaultVariants: {
      variant: 'mono',
      invalid: false,
      tone: 'neutral',
      brandForeground: 'light',
    },
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
  /** Dynamic provider fill used by the `brand` variant. */
  brandColor?: CSSProperties['background']
  /** Optional inset outline used by the `brand` variant. */
  brandStrokeColor?: CSSProperties['color']
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
  tone,
  brandForeground,
  brandColor,
  brandStrokeColor,
  className,
  children,
  style,
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  onRightIconClick,
  rightIconLabel,
  rightIconDisabled,
  ...props
}: ChipTagProps) {
  /* `workflow` icons inherit the tone's tinted label colour. The shared
     `--text-icon` gray is tuned for this component's light surfaces and would
     all but disappear on a tone's deep fill. */
  const iconClass = cn(
    'size-[14px] shrink-0',
    !invalid && variant !== 'workflow' && variant !== 'brand' && 'text-[var(--text-icon)]'
  )
  const interactive = RightIcon != null && onRightIconClick != null
  const resolvedStyle =
    variant === 'brand'
      ? {
          ...style,
          background: brandColor,
          ...(brandStrokeColor ? { boxShadow: `inset 0 0 0 1px ${brandStrokeColor}` } : {}),
        }
      : style

  return (
    <span
      className={cn(chipTagVariants({ variant, invalid, tone, brandForeground }), className)}
      style={resolvedStyle}
      {...props}
    >
      {LeftIcon ? <LeftIcon className={iconClass} /> : null}
      {children}
      {RightIcon ? (
        interactive ? (
          <button
            type='button'
            onClick={onRightIconClick}
            disabled={rightIconDisabled}
            aria-label={rightIconLabel}
            className='relative flex shrink-0 items-center opacity-80 transition-opacity before:absolute before:inset-[-8px] before:content-[""] hover-hover:opacity-100 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50'
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
