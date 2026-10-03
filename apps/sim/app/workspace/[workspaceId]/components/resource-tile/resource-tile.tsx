import type { ComponentType } from 'react'
import { cn, RESOURCE_TILE_BASE, RESOURCE_TILE_PLAIN } from '@sim/emcn'
import { getTileIconColorClass } from '@/blocks/icon-color'

interface BrandTileProps {
  icon: ComponentType<{ className?: string }>
  background: string | null | undefined
}

/** Shared brand treatment for integration and credential rows. */
export function BrandTile({ icon: Icon, background }: BrandTileProps) {
  return (
    <div
      aria-hidden
      className={cn(RESOURCE_TILE_BASE, RESOURCE_TILE_PLAIN)}
      style={background ? { background } : undefined}
    >
      <Icon
        className={background ? getTileIconColorClass(background) : 'text-[var(--text-icon)]'}
      />
    </div>
  )
}
