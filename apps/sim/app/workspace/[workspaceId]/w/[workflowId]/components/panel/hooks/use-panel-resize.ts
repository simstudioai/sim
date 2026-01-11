import { useCallback, useEffect } from 'react'
import { PANEL_WIDTH } from '@/stores/constants'
import { usePanelStore } from '@/stores/panel'

/**
 * Custom hook to handle panel resize functionality.
 * Manages mouse events for resizing and enforces min/max width constraints.
 * Maximum width is capped at 40% of the viewport width for optimal layout.
 *
 * @returns Resize state and handlers
 */
export function usePanelResize() {
  const { setPanelWidth, isResizing, setIsResizing } = usePanelStore()

  /**
   * Handles mouse down on resize handle
   */
  const handleMouseDown = useCallback(() => {
    setIsResizing(true)
  }, [setIsResizing])

  /**
   * Setup resize event listeners and body styles when resizing
   * Cleanup is handled automatically by the effect's return function
   */
  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      // Calculate width from the right edge of the viewport
      const newWidth = window.innerWidth - e.clientX
      const maxWidth = window.innerWidth * PANEL_WIDTH.MAX_PERCENTAGE

      if (newWidth >= PANEL_WIDTH.MIN && newWidth <= maxWidth) {
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
  }, [isResizing, setPanelWidth, setIsResizing])

  return {
    isResizing,
    handleMouseDown,
  }
}
