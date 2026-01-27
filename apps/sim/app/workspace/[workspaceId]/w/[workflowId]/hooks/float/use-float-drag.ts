import { useCallback, useEffect, useRef } from 'react'
import { constrainChatPosition } from '@/stores/chat/utils'

interface UseFloatDragProps {
  position: { x: number; y: number }
  width: number
  height: number
  onPositionChange: (position: { x: number; y: number }) => void
}

/**
 * Hook for handling drag functionality of floats.
 * Provides mouse event handlers and manages drag state
 */
export function useFloatDrag({ position, width, height, onPositionChange }: UseFloatDragProps) {
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const initialPositionRef = useRef({ x: 0, y: 0 })

  /**
   * Handle mouse down on drag handle - start dragging
   */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return

      e.preventDefault()
      e.stopPropagation()

      isDraggingRef.current = true
      dragStartRef.current = { x: e.clientX, y: e.clientY }
      initialPositionRef.current = { ...position }

      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
    },
    [position]
  )

  /**
   * Handle mouse move - update position while dragging
   */
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDraggingRef.current) return

      const deltaX = e.clientX - dragStartRef.current.x
      const deltaY = e.clientY - dragStartRef.current.y

      const newPosition = {
        x: initialPositionRef.current.x + deltaX,
        y: initialPositionRef.current.y + deltaY,
      }

      const constrainedPosition = constrainChatPosition(newPosition, width, height)
      onPositionChange(constrainedPosition)
    },
    [onPositionChange, width, height]
  )

  /**
   * Handle mouse up - stop dragging
   */
  const handleMouseUp = useCallback(() => {
    if (!isDraggingRef.current) return

    isDraggingRef.current = false

    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  /**
   * Set up global mouse event listeners
   */
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  return {
    handleMouseDown,
  }
}
