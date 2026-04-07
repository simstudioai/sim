'use client'

import type * as React from 'react'
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

  return (
    <div
      className='mb-6 flex items-center justify-center overflow-hidden rounded-lg p-8'
      style={{ background: color }}
    >
      {ResolvedIcon ? (
        <ResolvedIcon className='h-10 w-10 text-white' />
      ) : (
        <div className='font-mono text-white text-xl opacity-70'>{type.substring(0, 2)}</div>
      )}
    </div>
  )
}
