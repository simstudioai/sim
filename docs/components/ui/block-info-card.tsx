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
      <div className="flex items-center justify-center p-6">
        <div 
          className="h-20 w-20 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: color }}
        >
          {iconSvg ? (
            <div className="w-10 h-10 text-white" dangerouslySetInnerHTML={{ __html: iconSvg }} />
          ) : (
            <div className="text-xl font-mono opacity-70">{type.substring(0, 2)}</div>
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