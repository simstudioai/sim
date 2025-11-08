import { useCallback, useEffect, useRef, useState } from 'react'
import { useToolbarStore } from '@/stores/panel-new/toolbar/store'

/**
 * Minimum height for the blocks section (in pixels)
 * The triggers section minimum will be calculated dynamically based on header height
 */
export const MIN_BLOCKS_SECTION_HEIGHT = 100

/**
 * Calculates height boundaries and optimal height for the triggers section
 *
 * @param containerRef - Reference to the container element
 * @param triggersContentRef - Reference to the triggers content element
 * @param triggersHeaderRef - Reference to the triggers header element
 * @returns Object containing minHeight, maxHeight, and optimalHeight for triggers section
 */
export function calculateTriggerHeights(
  containerRef: React.RefObject<HTMLDivElement | null>,
  triggersContentRef: React.RefObject<HTMLDivElement | null>,
  triggersHeaderRef: React.RefObject<HTMLDivElement | null>
): { minHeight: number; maxHeight: number; optimalHeight: number } {
  const defaultHeight = MIN_BLOCKS_SECTION_HEIGHT

  if (!containerRef.current || !triggersHeaderRef.current) {
    return { minHeight: defaultHeight, maxHeight: defaultHeight, optimalHeight: defaultHeight }
  }

  const parentHeight = containerRef.current.getBoundingClientRect().height
  const headerHeight = triggersHeaderRef.current.getBoundingClientRect().height

  // Minimum triggers height is just the header
  const minHeight = headerHeight

  // Calculate optimal and maximum heights based on actual content
  let maxHeight = parentHeight - MIN_BLOCKS_SECTION_HEIGHT
  let optimalHeight = minHeight

  if (triggersContentRef.current) {
    const contentHeight = triggersContentRef.current.scrollHeight
    // Optimal height = header + actual content (shows all triggers without scrolling)
    optimalHeight = Math.min(headerHeight + contentHeight, maxHeight)
    // Maximum height shouldn't exceed full content height
    maxHeight = Math.min(maxHeight, headerHeight + contentHeight)
  }

  return { minHeight, maxHeight, optimalHeight }
}

/**
 * Props for the useToolbarResize hook
 */
interface UseToolbarResizeProps {
  /** Reference to the container element for boundary calculations */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Reference to the triggers content element for calculating maximum height */
  triggersContentRef: React.RefObject<HTMLDivElement | null>
  /** Reference to the triggers header element for calculating maximum height */
  triggersHeaderRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Custom hook to handle toolbar split resize functionality.
 * Manages the resizing of the triggers section within the toolbar view.
 * Prevents dragging the separator past the full height of triggers content.
 *
 * @param props - Configuration object containing container and content refs
 * @param props.containerRef - Reference to the container element for boundary calculations
 * @param props.triggersContentRef - Reference to the triggers content for max height calculation
 * @param props.triggersHeaderRef - Reference to the triggers header for max height calculation
 * @returns Object containing resize handler
 * @returns handleMouseDown - Handler for mouse down events on the resize handle
 */
export function useToolbarResize({
  containerRef,
  triggersContentRef,
  triggersHeaderRef,
}: UseToolbarResizeProps) {
  const { toolbarTriggersHeight, setToolbarTriggersHeight } = useToolbarStore()

  const [isResizing, setIsResizing] = useState(false)
  const startYRef = useRef<number>(0)
  const startHeightRef = useRef<number>(0)

  /**
   * Handles mouse down event on the resize handle to initiate resizing
   *
   * @param e - The React mouse event from the resize handle
   */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsResizing(true)
    startYRef.current = e.clientY
    const currentHeightValue = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--toolbar-triggers-height')
    )
    startHeightRef.current = currentHeightValue
  }, [])

  /**
   * Sets up resize event listeners and body styles during resize operations
   */
  useEffect(() => {
    if (!isResizing || !containerRef.current) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - startYRef.current
      let newHeight = startHeightRef.current + deltaY

      // Calculate height boundaries and clamp the new height
      const { minHeight, maxHeight } = calculateTriggerHeights(
        containerRef,
        triggersContentRef,
        triggersHeaderRef
      )

      newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight))
      setToolbarTriggersHeight(newHeight)
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
  }, [isResizing, containerRef, triggersContentRef, triggersHeaderRef, setToolbarTriggersHeight])

  return {
    handleMouseDown,
    isResizing,
  }
}
