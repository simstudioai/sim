'use client'

import type * as React from 'react'
import { blockTypeToIconMap } from './icon-mapping'

interface BlockInfoCardProps {
  type: string
  color: string
  icon?: React.ComponentType<{ className?: string }>
  iconSvg?: string // Deprecated: Use automatic icon resolution instead
}

export function BlockInfoCard({
  type,
  color,
  icon: IconComponent,
  iconSvg,
}: BlockInfoCardProps): React.ReactNode {
  // Auto-resolve icon component from block type if not explicitly provided
  const ResolvedIcon = IconComponent || blockTypeToIconMap[type] || null

  return (
    <div className='mb-6 overflow-hidden rounded-lg border border-border'>
      <div className='flex items-center justify-center p-6'>
        <div
          className='flex h-20 w-20 items-center justify-center rounded-lg'
          style={{ backgroundColor: color }}
        >
          {ResolvedIcon ? (
            <ResolvedIcon className='h-10 w-10 text-white' />
          ) : iconSvg ? (
            <div className='h-10 w-10 text-white' dangerouslySetInnerHTML={{ __html: iconSvg }} />
          ) : (
            <div className='font-mono text-xl opacity-70'>{type.substring(0, 2)}</div>
          )}
        </div>
      </div>
    </div>
  )
}
