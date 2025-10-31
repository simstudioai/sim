import { useCallback, useEffect, useRef, useState } from 'react'
import { useToolbarStore } from '@/stores/panel-new/toolbar/store'

/**
 * Minimum height for a section (in pixels)
 */
const MIN_SECTION_HEIGHT = 100

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

      const parentContainer = containerRef.current
      if (parentContainer) {
        const parentHeight = parentContainer.getBoundingClientRect().height

        // Calculate maximum triggers height based on actual content
        let maxTriggersHeight = parentHeight - MIN_SECTION_HEIGHT

        if (triggersContentRef.current && triggersHeaderRef.current) {
          const contentHeight = triggersContentRef.current.scrollHeight
          const headerHeight = triggersHeaderRef.current.getBoundingClientRect().height

          // Maximum height = header + content (this shows all triggers without scrolling)
          const fullContentHeight = headerHeight + contentHeight

          // Don't allow triggers to exceed its full content height
          maxTriggersHeight = Math.min(maxTriggersHeight, fullContentHeight)
        }

        // Ensure minimum for triggers section and respect maximum
        newHeight = Math.max(MIN_SECTION_HEIGHT, Math.min(maxTriggersHeight, newHeight))
        setToolbarTriggersHeight(newHeight)
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
  }, [isResizing, containerRef, triggersContentRef, triggersHeaderRef, setToolbarTriggersHeight])

  return {
    handleMouseDown,
  }
}
