import type { ComponentType } from 'react'
import { cn } from '../../lib/cn'

export interface ResourceTileProps {
  icon: ComponentType<{ className?: string }>
}

/** Shared geometry for resource identity tiles in lists and detail headings. */
export const RESOURCE_TILE_BASE =
  'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border-1)] [&_svg]:size-5'

/** Filled tile for product resources such as skills and tools. */
export const RESOURCE_TILE_FILL = 'bg-[var(--surface-4)] dark:bg-[var(--surface-5)]'

/** Page-background tile for brand marks and favicons. */
export const RESOURCE_TILE_PLAIN = 'bg-[var(--bg)]'

/** Square glyph tile identifying a resource. */
export function ResourceTile({ icon: Icon }: ResourceTileProps) {
  return (
    <div className={cn(RESOURCE_TILE_BASE, RESOURCE_TILE_FILL)}>
      <Icon className='text-[var(--text-icon)]' />
    </div>
  )
}
