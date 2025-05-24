'use client'

import type * as React from 'react'

interface BlockInfoCardProps {
  type: string
  color: string
  icon?: boolean
  iconSvg?: string
}

export function BlockInfoCard({
  type,
  color,
  icon = false,
  iconSvg,
}: BlockInfoCardProps): React.ReactNode {
  return (
    <div className='mb-6 overflow-hidden rounded-lg border border-border'>
      <div className='flex items-center justify-center p-6'>
        <div
          className='flex h-20 w-20 items-center justify-center rounded-lg'
          style={{ backgroundColor: color }}
        >
          {iconSvg ? (
            <div className='h-10 w-10 text-white' dangerouslySetInnerHTML={{ __html: iconSvg }} />
          ) : (
            <div className='font-mono text-xl opacity-70'>{type.substring(0, 2)}</div>
          )}
        </div>
      </div>
      {icon && (
        <style jsx global>{`
          .block-icon {
            width: 80px;
            height: 80px;
            margin: 1rem auto;
            display: block;
          }
        `}</style>
      )}
    </div>
  )
}
