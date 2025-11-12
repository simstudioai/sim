import { useCallback, useEffect, useRef, useState } from 'react'
import { usePanelEditorStore } from '@/stores/panel-new/editor/store'

/**
 * Minimum height for the connections section (header only)
 */
const MIN_CONNECTIONS_HEIGHT = 30
/**
 * Maximum height for the connections section
 */
const MAX_CONNECTIONS_HEIGHT = 300

/**
 * Props for the useConnectionsResize hook
 */
interface UseConnectionsResizeProps {
  /** Reference to the subblocks section to calculate available space */
  subBlocksRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Custom hook to handle connections section resize functionality.
 * Manages the resizing of the connections section within the editor view.
 *
 * @param props - Configuration object containing section refs
 * @param props.subBlocksRef - Reference to the subblocks section for boundary calculations
 * @returns Object containing resize handler
 */
export function useConnectionsResize({ subBlocksRef }: UseConnectionsResizeProps) {
  const { connectionsHeight, setConnectionsHeight } = usePanelEditorStore()

  const [isResizing, setIsResizing] = useState(false)
  const startYRef = useRef<number>(0)
  const startHeightRef = useRef<number>(0)
  const maxHeightRef = useRef<number>(MAX_CONNECTIONS_HEIGHT)

  /**
   * Handles mouse down event on the resize handle to initiate resizing
   *
   * @param e - The React mouse event from the resize handle
   */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsResizing(true)
      startYRef.current = e.clientY
      startHeightRef.current = connectionsHeight
      // Freeze max height for current resize session to prevent jitter
      maxHeightRef.current = MAX_CONNECTIONS_HEIGHT
    },
    [connectionsHeight]
  )

  /**
   * Sets up resize event listeners and body styles during resize operations
   */
  useEffect(() => {
    if (!isResizing || !subBlocksRef.current) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = startYRef.current - e.clientY // Inverted because we're resizing from bottom up
      let newHeight = startHeightRef.current + deltaY

      // Clamp height between fixed min and max for stable behavior
      newHeight = Math.max(MIN_CONNECTIONS_HEIGHT, Math.min(maxHeightRef.current, newHeight))
      setConnectionsHeight(newHeight)
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
  }, [isResizing, subBlocksRef, setConnectionsHeight])

  return {
    handleMouseDown,
    isResizing,
  }
}
