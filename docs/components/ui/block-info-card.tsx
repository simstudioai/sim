'use client'

import * as React from 'react'

interface BlockInfoCardProps {
  type: string;
  color: string;
  icon?: boolean;
  iconSvg?: string;
}

export function BlockInfoCard({ 
  type, 
  color, 
  icon = false,
  iconSvg
}: BlockInfoCardProps): React.ReactNode {
  return (
    <div className="mb-6 rounded-lg overflow-hidden border border-border">
      <div className="grid grid-cols-[1fr_auto] items-center p-4">
        <div>
          <div className="font-medium text-lg">{type}</div>
        </div>
        <div 
          className="h-12 w-12 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: color }}
        >
          {iconSvg ? (
            <div className="w-6 h-6 text-white" dangerouslySetInnerHTML={{ __html: iconSvg }} />
          ) : (
            <div className="text-sm font-mono opacity-70">{type.substring(0, 2)}</div>
          )}
        </div>
      </div>
      {icon && (
        <style jsx global>{`
          .block-icon {
            width: 64px;
            height: 64px;
            margin: 1rem auto;
            display: block;
          }
        `}</style>
      )}
    </div>
  )
} 