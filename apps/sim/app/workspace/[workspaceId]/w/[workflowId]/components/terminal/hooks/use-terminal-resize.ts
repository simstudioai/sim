import { useCallback, useEffect } from 'react'
import { useTerminalStore } from '@/stores/terminal'

const MIN_HEIGHT = 30
const MAX_HEIGHT_PERCENTAGE = 0.7

export function useTerminalResize() {
  const setTerminalHeight = useTerminalStore((state) => state.setTerminalHeight)
  const isResizing = useTerminalStore((state) => state.isResizing)
  const setIsResizing = useTerminalStore((state) => state.setIsResizing)

  const handleMouseDown = useCallback(() => {
    setIsResizing(true)
  }, [setIsResizing])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
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
  }, [isResizing, setTerminalHeight, setIsResizing])

  return {
    isResizing,
    handleMouseDown,
  }
}
