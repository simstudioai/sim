import { useCallback, useEffect, useState } from 'react'
import { useTerminalStore } from '@/stores/terminal'

/**
 * Constants for output panel sizing
 * Must match MIN_OUTPUT_PANEL_WIDTH_PX and BLOCK_COLUMN_WIDTH_PX in terminal.tsx
 */
const MIN_WIDTH = 300
const BLOCK_COLUMN_WIDTH = 240

/**
 * Custom hook to handle output panel horizontal resize functionality.
 * Manages mouse events for resizing and enforces min/max width constraints.
 *
 * @returns Resize state and handlers
 */
export function useOutputPanelResize() {
  const { setOutputPanelWidth } = useTerminalStore()
  const [isResizing, setIsResizing] = useState(false)

  /**
   * Handles mouse down on resize handle
   */
  const handleMouseDown = useCallback(() => {
    setIsResizing(true)
  }, [])

  /**
   * Setup resize event listeners and body styles when resizing.
   * Cleanup is handled automatically by the effect's return function.
   */
  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      // Calculate width from the right edge of the viewport
      // Account for panel width on the right side
      const panelWidth = Number.parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--panel-width') || '0'
      )
      const sidebarWidth = Number.parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width') || '0'
      )

      const newWidth = window.innerWidth - e.clientX - panelWidth

      // Calculate max width: total terminal width minus block column width
      const terminalWidth = window.innerWidth - sidebarWidth - panelWidth
      const maxWidth = terminalWidth - BLOCK_COLUMN_WIDTH

      // Clamp between min and max width
      const clampedWidth = Math.max(MIN_WIDTH, Math.min(newWidth, maxWidth))
      setOutputPanelWidth(clampedWidth)
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
  }, [isResizing, setOutputPanelWidth])

  return {
    isResizing,
    handleMouseDown,
  }
}
