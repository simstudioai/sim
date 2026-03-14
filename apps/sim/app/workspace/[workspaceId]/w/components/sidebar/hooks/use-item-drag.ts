import { useCallback, useRef, useState } from 'react'

interface UseItemDragProps {
  onDragStart: (e: React.DragEvent) => void
}

let invisibleDragImage: HTMLImageElement | null = null
if (typeof Image !== 'undefined') {
  invisibleDragImage = new Image()
  invisibleDragImage.src =
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
}

/**
 * Custom hook to handle drag operations for workflow and folder items.
 * Manages drag state and provides unified drag event handlers.
 *
 * @param props - Configuration object containing drag start callback
 * @returns Drag state and event handlers
 */
export function useItemDrag({ onDragStart }: UseItemDragProps) {
  const [isDragging, setIsDragging] = useState(false)
  const shouldPreventClickRef = useRef(false)

  /**
   * Handle drag start - sets dragging state, hides default drag ghost, and prevents click
   */
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      shouldPreventClickRef.current = true
      setIsDragging(true)

      if (invisibleDragImage) {
        e.dataTransfer.setDragImage(invisibleDragImage, 0, 0)
      }

      onDragStart(e)
    },
    [onDragStart]
  )

  /**
   * Handle drag end - resets dragging state and re-enables clicks
   */
  const handleDragEnd = useCallback(() => {
    setIsDragging(false)
    requestAnimationFrame(() => {
      shouldPreventClickRef.current = false
    })
  }, [])

  return {
    isDragging,
    shouldPreventClickRef,
    handleDragStart,
    handleDragEnd,
  }
}
