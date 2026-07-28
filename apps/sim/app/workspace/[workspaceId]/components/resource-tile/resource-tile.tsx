import type { ComponentType } from 'react'
import { cn } from '@sim/emcn'

interface ResourceTileProps {
  icon: ComponentType<{ className?: string }>
}

/**
 * Geometry and border of the square resource tile — the single source for that
 * chrome, shared by {@link ResourceTile} and `SettingsResourceRow` so the skills,
 * custom tools, and settings surfaces cannot drift apart. Pair with a fill. Sizing
 * the glyph is the tile's job: the descendant rule outranks an icon's own class.
 */
export const RESOURCE_TILE_BASE =
  'flex size-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border-1)] [&_svg]:size-5'

/** Filled treatment worn by the skills and custom tools resource tiles. */
export const RESOURCE_TILE_FILL = 'bg-[var(--surface-4)] dark:bg-[var(--surface-5)]'

/**
 * Square glyph tile identifying a workspace resource — the leading visual on a
 * resource's row and on its detail heading.
 */
export function ResourceTile({ icon: Icon }: ResourceTileProps) {
  return (
    <div className={cn(RESOURCE_TILE_BASE, RESOURCE_TILE_FILL)}>
      <Icon className='text-[var(--text-icon)]' />
    </div>
  )
}
