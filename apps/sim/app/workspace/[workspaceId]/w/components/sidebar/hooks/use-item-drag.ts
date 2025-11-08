import { useCallback, useRef, useState } from 'react'

interface UseItemDragProps {
  onDragStart: (e: React.DragEvent) => void
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
   * Handle drag start - sets dragging state and prevents click
   */
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      shouldPreventClickRef.current = true
      setIsDragging(true)
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
