'use client'

import type * as React from 'react'
import { cn } from '@sim/emcn'
import { isLightTileColor } from '@sim/workflow-renderer/tile-icon-color'
import { blockTypeToIconMap } from '@/components/ui/icon-mapping'

interface IntegrationIconProps {
  type: string
  color: string
}

export function IntegrationIcon({ type, color }: IntegrationIconProps): React.ReactNode {
  const ResolvedIcon = blockTypeToIconMap[type] || null
  const iconColorClass = isLightTileColor(color) ? 'text-black' : 'text-white'

  return (
    <span
      aria-hidden='true'
      className='flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg'
      style={{ background: color }}
    >
      {ResolvedIcon ? (
        <ResolvedIcon className={cn('size-4', iconColorClass)} />
      ) : (
        <span className={cn('font-mono text-sm opacity-70', iconColorClass)}>
          {type.substring(0, 2)}
        </span>
      )}
    </span>
  )
}
