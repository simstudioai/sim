import { useCallback, useEffect, useState } from 'react'
import { OUTPUT_PANEL_WIDTH, TERMINAL_BLOCK_COLUMN_WIDTH } from '@/stores/constants'
import { useTerminalStore } from '@/stores/terminal'

export function useOutputPanelResize() {
  const setOutputPanelWidth = useTerminalStore((state) => state.setOutputPanelWidth)
  const [isResizing, setIsResizing] = useState(false)

  const handleMouseDown = useCallback(() => {
    setIsResizing(true)
  }, [])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const terminalEl = document.querySelector('[aria-label="Terminal"]')
      if (!terminalEl) return

      const terminalRect = terminalEl.getBoundingClientRect()
      const newWidth = terminalRect.right - e.clientX
      const maxWidth = terminalRect.width - TERMINAL_BLOCK_COLUMN_WIDTH
      const clampedWidth = Math.max(OUTPUT_PANEL_WIDTH.MIN, Math.min(newWidth, maxWidth))

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
