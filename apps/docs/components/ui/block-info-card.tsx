'use client'

import type * as React from 'react'
import { isLightTileColor } from '@sim/workflow-renderer/tile-icon-color'
import { blockTypeToIconMap } from '@/components/ui/icon-mapping'

interface BlockInfoCardProps {
  type: string
  color: string
  icon?: React.ComponentType<{ className?: string }>
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
      aria-hidden='true'
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
