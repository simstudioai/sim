'use client'

import type * as React from 'react'
import { blockTypeToIconMap } from '@/components/ui/icon-mapping'

interface BlockInfoCardProps {
  type: string
  color: string
  icon?: React.ComponentType<{ className?: string }>
}

/**
 * Brightness above which a tile background is "clearly light" and a white
 * foreground icon would wash out. Mirrors apps/sim's LIGHT_TILE_THRESHOLD
 * (blocks/icon-color.ts) so monochrome `currentColor` icons (e.g. Daytona,
 * Notion) stay legible on white/pale tiles instead of white-on-white.
 */
const LIGHT_TILE_THRESHOLD = 0.75

function isLightTileColor(color: string): boolean {
  const hex = color.trim().replace('#', '').toLowerCase()
  let r: number
  let g: number
  let b: number
  if (/^[0-9a-f]{3}$/.test(hex)) {
    r = Number.parseInt(hex[0] + hex[0], 16)
    g = Number.parseInt(hex[1] + hex[1], 16)
    b = Number.parseInt(hex[2] + hex[2], 16)
  } else if (/^[0-9a-f]{6}$/.test(hex)) {
    r = Number.parseInt(hex.slice(0, 2), 16)
    g = Number.parseInt(hex.slice(2, 4), 16)
    b = Number.parseInt(hex.slice(4, 6), 16)
  } else {
    return false
  }
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > LIGHT_TILE_THRESHOLD
}

export function BlockInfoCard({
  type,
  color,
  icon: IconComponent,
}: BlockInfoCardProps): React.ReactNode {
  const ResolvedIcon = IconComponent || blockTypeToIconMap[type] || null
  const iconColorClass = isLightTileColor(color) ? 'text-black' : 'text-white'

  return (
    <div
      className='mb-6 flex items-center justify-center overflow-hidden rounded-lg p-8'
      style={{ background: color }}
    >
      {ResolvedIcon ? (
        <ResolvedIcon className={`size-10 ${iconColorClass}`} />
      ) : (
        <div className={`font-mono text-xl opacity-70 ${iconColorClass}`}>
          {type.substring(0, 2)}
        </div>
      )}
    </div>
  )
}
