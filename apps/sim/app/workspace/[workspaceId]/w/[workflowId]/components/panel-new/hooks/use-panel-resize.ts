import { useCallback, useEffect, useState } from 'react'
import { usePanelStore } from '@/stores/panel-new/store'

/**
 * Constants for panel sizing
 */
const MIN_WIDTH = 244
const MAX_WIDTH_PERCENTAGE = 0.4 // 40% of viewport width

/**
 * Custom hook to handle panel resize functionality.
 * Manages mouse events for resizing and enforces min/max width constraints.
 * Maximum width is capped at 40% of the viewport width for optimal layout.
 *
 * @returns Resize state and handlers
 */
export function usePanelResize() {
  const { setPanelWidth } = usePanelStore()
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
      // Calculate width from the right edge of the viewport
      const newWidth = window.innerWidth - e.clientX
      const maxWidth = window.innerWidth * MAX_WIDTH_PERCENTAGE

      if (newWidth >= MIN_WIDTH && newWidth <= maxWidth) {
        setPanelWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, setPanelWidth])

  return {
    isResizing,
    handleMouseDown,
  }
}
