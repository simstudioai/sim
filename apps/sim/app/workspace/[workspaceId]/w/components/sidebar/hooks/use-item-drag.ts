import { useCallback, useRef, useState } from 'react'

interface UseItemDragProps {
  onDragStart: (e: React.DragEvent) => void
}

// Lazily initialized invisible drag image (1x1 transparent pixel)
// Created on first use to avoid SSR issues with browser-only Image constructor
let invisibleDragImage: HTMLImageElement | null = null

function getInvisibleDragImage(): HTMLImageElement {
  if (!invisibleDragImage) {
    invisibleDragImage = new Image()
    invisibleDragImage.src =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  }
  return invisibleDragImage
}

/**
 * Custom hook to handle drag operations for workflow and folder items.
 * Manages drag state and provides unified drag event handlers.
 * Uses an invisible drag image for cleaner UX (only drop indicator shows).
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

      // Hide the default browser drag ghost image
      // Defensive check ensures image is loaded (data URIs are typically synchronous)
      const dragImage = getInvisibleDragImage()
      if (dragImage.complete) {
        e.dataTransfer.setDragImage(dragImage, 0, 0)
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
