import { type DragEvent, useCallback, useRef, useState } from 'react'
import { useDragTeardown } from '@/app/workspace/[workspaceId]/components/folders/use-drag-teardown'
import { getDroppedFiles, hasExternalFiles } from '@/app/workspace/[workspaceId]/files/utils'

interface UseFileUploadDropOptions {
  enabled: boolean
  onDrop: (files: File[]) => void
}

/** Owns the OS drag overlay independently of internal file-row moves. */
export function useFileUploadDrop({ enabled, onDrop }: UseFileUploadDropOptions) {
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const dragCounter = useRef(0)
  const dismiss = useCallback(() => {
    dragCounter.current = 0
    setIsDraggingOver(false)
  }, [])
  useDragTeardown(dismiss)

  const onDragEnter = useCallback(
    (event: DragEvent) => {
      if (!hasExternalFiles(event.dataTransfer)) return
      event.preventDefault()
      if (!enabled) return
      dragCounter.current++
      setIsDraggingOver(true)
    },
    [enabled]
  )
  const onDragLeave = useCallback((event: DragEvent) => {
    if (!hasExternalFiles(event.dataTransfer)) return
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) setIsDraggingOver(false)
  }, [])
  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (!hasExternalFiles(event.dataTransfer)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = enabled ? 'copy' : 'none'
    },
    [enabled]
  )
  const handleDrop = useCallback(
    (event: DragEvent) => {
      if (!hasExternalFiles(event.dataTransfer)) return
      event.preventDefault()
      dismiss()
      if (enabled) onDrop(getDroppedFiles(event.dataTransfer))
    },
    [dismiss, enabled, onDrop]
  )

  return {
    isDraggingOver: enabled && isDraggingOver,
    dismiss,
    handlers: { onDragEnter, onDragLeave, onDragOver, onDrop: handleDrop },
  }
}
