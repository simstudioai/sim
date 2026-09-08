import { cn } from '@sim/emcn'

interface IdentityTileProps {
  /** Letter shown when there is no uploaded mark. */
  initial: string
  logoUrl?: string | null
  /** Accessible name for an uploaded mark; empty when the name is already beside it. */
  alt?: string
  /** Layout-only extras (visibility, positioning). Never chrome. */
  className?: string
  /** `data-slot` hook for tests and styling. */
  slot?: string
  /** `sm` is the 16px rail mark; `lg` is the 36px tile a row or card leads with. */
  size?: 'sm' | 'lg'
}

const SIZE_CLASS = {
  sm: 'size-[16px] rounded-sm text-micro',
  lg: 'size-9 rounded-lg text-base',
} as const

/**
 * The 16px mark for a workspace or organization: its uploaded logo, or its
 * initial on a neutral tile. There is no per-entity color — every tile is the
 * same gray so an uploaded mark is the only thing that distinguishes one from
 * another, exactly as an icon would.
 *
 * Chrome matches the chip family at tile scale: `rounded-sm` is the chip's
 * `rounded-lg` scaled to a 16px box, and the letter sits at the smallest type
 * token. The fill is `--surface-6`, one step past the chip hover and active
 * fills, so the tile still reads as a tile on a hovered or selected row instead
 * of dissolving into it. The letter is the icon gray in light mode and steps up
 * to the secondary text gray in dark mode, where the icon gray sits too close
 * to that fill. Plain `img`/`div`
 * rather than the emcn `Avatar`, whose Radix root renders a `<span>` — and globals
 * fade every `span` in the collapsed rail to `opacity: 0`, which would blank the
 * mark exactly where it is the only thing left to see.
 */
export function IdentityTile({
  initial,
  logoUrl,
  alt = '',
  className,
  slot,
  size = 'sm',
}: IdentityTileProps) {
  if (logoUrl) {
    return (
      <img
        data-slot={slot}
        src={logoUrl}
        alt={alt}
        referrerPolicy='no-referrer'
        className={cn('shrink-0 object-cover', SIZE_CLASS[size], className)}
      />
    )
  }
  return (
    <div
      data-slot={slot}
      aria-hidden='true'
      className={cn(
        'flex shrink-0 items-center justify-center bg-[var(--surface-6)] text-[var(--text-icon)] leading-none dark:text-[var(--text-secondary)]',
        SIZE_CLASS[size],
        className
      )}
    >
      {initial}
    </div>
  )
}
