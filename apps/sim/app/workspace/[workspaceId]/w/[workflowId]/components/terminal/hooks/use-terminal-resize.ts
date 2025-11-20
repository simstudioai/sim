import { useCallback, useEffect, useState } from 'react'
import { useTerminalStore } from '@/stores/terminal'

/**
 * Constants for terminal sizing
 */
const MIN_HEIGHT = 30
const MAX_HEIGHT_PERCENTAGE = 0.7 // 70% of viewport height

/**
 * Custom hook to handle terminal resize functionality.
 * Manages mouse events for resizing and enforces min/max height constraints.
 * Maximum height is capped at 70% of the viewport height for optimal layout.
 *
 * @returns Resize state and handlers
 */
export function useTerminalResize() {
  const { setTerminalHeight } = useTerminalStore()
  const [isResizing, setIsResizing] = useState(false)

  /**
   * Handles mouse down on resize handle
   */
  const handleMouseDown = useCallback(() => {
    setIsResizing(true)
  }, [])

  /**
   * Setup resize event listeners and body styles when resizing
   * Cleanup is handled automatically by the effect's return function
   */
  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      // Calculate height from the bottom edge of the viewport
      const newHeight = window.innerHeight - e.clientY
      const maxHeight = window.innerHeight * MAX_HEIGHT_PERCENTAGE

      if (newHeight >= MIN_HEIGHT && newHeight <= maxHeight) {
        setTerminalHeight(newHeight)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, setTerminalHeight])

  return {
    isResizing,
    handleMouseDown,
  }
}
