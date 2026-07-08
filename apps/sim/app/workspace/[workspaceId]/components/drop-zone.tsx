'use client'

import { useState } from 'react'
import { cn } from '@sim/emcn'

interface DropZoneProps {
  onDrop: (e: React.DragEvent) => void
  children: React.ReactNode
  className?: string
}

/** File drop target with a dashed accent overlay while dragging. Shared by the
 * whitelabeling settings and the deploy-as-block icon upload. */
export function DropZone({ onDrop, children, className }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false)

  return (
    <div
      className={cn('relative', className)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setIsDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDragging(false)
        }
      }}
      onDrop={(e) => {
        setIsDragging(false)
        onDrop(e)
      }}
    >
      {children}
      {isDragging && (
        <div className='pointer-events-none absolute inset-0 z-10 rounded-lg border-[1.5px] border-[var(--brand-accent)] border-dashed bg-[color-mix(in_srgb,var(--brand-accent)_8%,transparent)]' />
      )}
    </div>
  )
}
