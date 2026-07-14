import type { ComponentType, SVGProps } from 'react'
import { cn } from '@sim/emcn'
import type { CompetitorBrand } from '@/lib/compare/data'
import { SimWordmark } from '@/app/(landing)/components/navbar/components/sim-wordmark'

export interface BrandIconTileProps {
  icon: ComponentType<SVGProps<SVGSVGElement>>
  /**
   * Whether `icon` already renders a full, self-contained brand-colored
   * square (e.g. a fetched app-store-style logo) rather than a bare
   * transparent glyph. See {@link CompetitorBrand.selfFramed}.
   */
  selfFramed?: boolean
  /** Outer tile size, e.g. `size-8`. Defaults to the integrations-page card size. */
  className?: string
  /** Icon glyph size inside the tile, e.g. `size-4`. Ignored when `selfFramed`. */
  iconClassName?: string
}

/**
 * A rounded, bordered icon tile matching the platform's app-icon chrome
 * conventions (border radius, border token, background), so competitor brand
 * logos read as the same first-class "app icon" chrome as the rest of the
 * product, instead of a bare, unframed SVG floating in the layout.
 *
 * A self-framed logo (already a complete brand-colored square) fills the
 * tile edge-to-edge, clipped to the same rounded corners. Otherwise the icon
 * is a small transparent glyph centered on a plain bordered background.
 */
export function BrandIconTile({
  icon: Icon,
  selfFramed = false,
  className = 'size-8',
  iconClassName = 'size-4',
}: BrandIconTileProps) {
  if (selfFramed) {
    return (
      <div
        className={cn(
          'shrink-0 overflow-hidden rounded-xl border border-[var(--border-1)]',
          className
        )}
      >
        <Icon className='size-full' aria-hidden='true' />
      </div>
    )
  }
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl border border-[var(--border-1)] bg-[var(--bg)]',
        className
      )}
    >
      <Icon className={iconClassName} aria-hidden='true' />
    </div>
  )
}

export interface SimIconTileProps {
  /** Outer tile size, e.g. `size-8`. Defaults to the integrations-page card size. */
  className?: string
}

/**
 * The same rounded, bordered tile as {@link BrandIconTile}, but for Sim's own
 * wordmark. So "Sim" gets the identical icon-chip treatment as every
 * competitor it's compared against, instead of appearing as bare text.
 */
export function SimIconTile({ className = 'size-8' }: SimIconTileProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl border border-[var(--border-1)] bg-[var(--bg)]',
        className
      )}
    >
      <span className='inline-flex scale-[0.6]'>
        <SimWordmark />
      </span>
    </div>
  )
}
