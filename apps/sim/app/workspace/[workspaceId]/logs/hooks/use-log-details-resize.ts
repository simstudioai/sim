import { useCallback, useEffect, useState } from 'react'
import { useLogDetailsUIStore } from '@/stores/logs/store'

/**
 * Hook for handling log details panel resize via mouse drag.
 * @returns Resize state and mouse event handler.
 */
export function useLogDetailsResize() {
  const setPanelWidth = useLogDetailsUIStore((state) => state.setPanelWidth)
  const setIsResizing = useLogDetailsUIStore((state) => state.setIsResizing)
  const [isResizing, setLocalIsResizing] = useState(false)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setLocalIsResizing(true)
      setIsResizing(true)
    },
    [setIsResizing]
  )

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX
      setPanelWidth(newWidth)
    }

    const handleMouseUp = () => {
      setLocalIsResizing(false)
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
