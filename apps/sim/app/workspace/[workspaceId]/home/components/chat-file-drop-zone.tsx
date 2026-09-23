'use client'

import { type DragEvent, type ReactNode, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import { SIM_RESOURCE_DRAG_TYPE, SIM_RESOURCES_DRAG_TYPE } from '@/lib/mothership/resource-types'
import { DropOverlay } from '@/app/workspace/[workspaceId]/home/components/user-input/components/drop-overlay'

interface ChatFileDropZoneProps {
  children: ReactNode
  className?: string
  onFilesDrop?: (files: FileList) => void
}

/** Claims native file drops throughout one chat panel, including its composer. */
export function ChatFileDropZone({ children, className, onFilesDrop }: ChatFileDropZoneProps) {
  const dragDepth = useRef(0)
  const [isDragging, setIsDragging] = useState(false)

  function acceptsFiles(event: DragEvent<HTMLDivElement>) {
    const types = event.dataTransfer.types
    return (
      Boolean(onFilesDrop) &&
      event.currentTarget.contains(event.target as Node) &&
      types.includes('Files') &&
      !types.includes(SIM_RESOURCE_DRAG_TYPE) &&
      !types.includes(SIM_RESOURCES_DRAG_TYPE)
    )
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!acceptsFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    setIsDragging(true)
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!acceptsFiles(event)) return
    dragDepth.current += 1
    handleDragOver(event)
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.target as Node)) return
    if (dragDepth.current === 0 && !isDragging) return
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) {
      setIsDragging(false)
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.target as Node)) return
    dragDepth.current = 0
    setIsDragging(false)
    if (!acceptsFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer.files.length > 0) onFilesDrop?.(event.dataTransfer.files)
  }

  return (
    <div
      className={cn('relative', className)}
      onDragEnterCapture={handleDragEnter}
      onDragOverCapture={handleDragOver}
      onDragLeaveCapture={handleDragLeave}
      onDropCapture={handleDrop}
    >
      {children}
      {isDragging && onFilesDrop && <DropOverlay />}
    </div>
  )
}
