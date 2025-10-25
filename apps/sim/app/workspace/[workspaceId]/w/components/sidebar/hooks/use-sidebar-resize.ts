import { useCallback, useEffect, useState } from 'react'
import { useSidebarStore } from '@/stores/sidebar/store'

/**
 * Constants for sidebar sizing
 */
const MIN_WIDTH = 232
const MAX_WIDTH = 400

/**
 * Custom hook to handle sidebar resize functionality.
 * Manages mouse events for resizing and enforces min/max width constraints.
 *
 * @returns Resize state and handlers
 */
export function useSidebarResize() {
  const { setSidebarWidth } = useSidebarStore()
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
      const newWidth = e.clientX
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth)
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
  }, [isResizing, setSidebarWidth])

  return {
    isResizing,
    handleMouseDown,
  }
}
