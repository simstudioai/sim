'use client'

import * as React from 'react'

interface BlockInfoCardProps {
  type: string;
  color: string;
  category: string;
}

export function BlockInfoCard({ type, color, category }: BlockInfoCardProps): React.ReactNode {
  return (
    <div className="mb-6 rounded-lg overflow-hidden border border-border">
      <div className="grid grid-cols-[1fr_auto] items-center p-4">
        <div>
          <div className="font-medium text-lg">{type}</div>
          <div className="text-sm text-muted-foreground">Category: {category}</div>
        </div>
        <div 
          className="h-12 w-12 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: color }}
        >
          <div className="text-sm font-mono opacity-70">{type.substring(0, 2)}</div>
        </div>
      </div>
    </div>
  )
} 