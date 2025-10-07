import { useCallback, useEffect, useRef, useState } from 'react'
import { useSidebarStore } from '@/stores/sidebar/store'

/**
 * Constants for panel sizing
 */
const DEFAULT_HEIGHT = 200
const MIN_HEIGHT = 28
const HEADER_HEIGHT = 28

/**
 * Panel type configuration
 */
type PanelType = 'triggers' | 'blocks'

interface UsePanelResizeProps {
  panelType: PanelType
  containerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Custom hook to handle panel resize and toggle functionality for Triggers and Blocks.
 * Provides unified logic for both panels with proper constraint handling.
 *
 * @param props - Configuration object containing panel type and container ref
 * @returns Panel resize state and handlers
 */
export function usePanelResize({ panelType, containerRef }: UsePanelResizeProps) {
  const { triggersHeight, blocksHeight, setTriggersHeight, setBlocksHeight } = useSidebarStore()

  const [isResizing, setIsResizing] = useState(false)
  const startYRef = useRef<number>(0)
  const startHeightRef = useRef<number>(0)

  // Get current panel's height and setter based on type
  const currentHeight = panelType === 'triggers' ? triggersHeight : blocksHeight
  const setCurrentHeight = panelType === 'triggers' ? setTriggersHeight : setBlocksHeight
  const otherHeight = panelType === 'triggers' ? blocksHeight : triggersHeight
  const setOtherHeight = panelType === 'triggers' ? setBlocksHeight : setTriggersHeight

  /**
   * Handles mouse down on resize handle
   */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsResizing(true)
      startYRef.current = e.clientY
      const currentHeightValue = Number.parseInt(
        getComputedStyle(document.documentElement).getPropertyValue(
          panelType === 'triggers' ? '--triggers-height' : '--blocks-height'
        )
      )
      startHeightRef.current = currentHeightValue
    },
    [panelType]
  )

  /**
   * Handle toggle collapse/expand
   */
  const handleToggle = useCallback(() => {
    if (panelType === 'triggers') {
      // Triggers toggle logic
      const currentBlocksHeight = Number.parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--blocks-height')
      )
      const minAllowedHeight = currentBlocksHeight + HEADER_HEIGHT
      const isCollapsed =
        Math.abs(triggersHeight - minAllowedHeight) <= 2 || triggersHeight <= MIN_HEIGHT

      if (isCollapsed) {
        // Expanding: show DEFAULT_HEIGHT of visible triggers content above blocks
        const targetHeight = minAllowedHeight + DEFAULT_HEIGHT

        if (containerRef.current?.parentElement) {
          const parentHeight = containerRef.current.parentElement.getBoundingClientRect().height
          setTriggersHeight(Math.min(targetHeight, parentHeight))
        } else {
          setTriggersHeight(targetHeight)
        }
      } else {
        // Collapsing: collapse to minimum while respecting blocks constraint
        if (currentBlocksHeight <= MIN_HEIGHT) {
          setTriggersHeight(MIN_HEIGHT)
        } else {
          setTriggersHeight(minAllowedHeight)
        }
      }
    } else {
      // Blocks toggle logic
      if (blocksHeight <= MIN_HEIGHT) {
        // Expanding blocks
        const currentTriggersHeight = Number.parseInt(
          getComputedStyle(document.documentElement).getPropertyValue('--triggers-height')
        )
        const desiredBlocksHeight = DEFAULT_HEIGHT
        const minRequiredTriggersHeight = desiredBlocksHeight + HEADER_HEIGHT
        const idealTriggersHeight = desiredBlocksHeight + HEADER_HEIGHT + DEFAULT_HEIGHT

        // If current triggers height is below ideal, expand triggers to show both sections properly
        if (currentTriggersHeight < idealTriggersHeight) {
          if (containerRef.current?.parentElement) {
            const parentHeight = containerRef.current.parentElement.getBoundingClientRect().height
            setTriggersHeight(Math.min(idealTriggersHeight, parentHeight))
          } else {
            setTriggersHeight(idealTriggersHeight)
          }
        }

        setBlocksHeight(desiredBlocksHeight)
      } else {
        // Collapsing blocks
        setBlocksHeight(MIN_HEIGHT)
      }
    }
  }, [panelType, triggersHeight, blocksHeight, setTriggersHeight, setBlocksHeight, containerRef])

  /**
   * Setup resize event listeners and body styles when resizing
   */
  useEffect(() => {
    if (!isResizing || !containerRef.current) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = startYRef.current - e.clientY
      let newHeight = startHeightRef.current + deltaY

      const parentContainer = containerRef.current?.parentElement
      if (parentContainer) {
        const parentHeight = parentContainer.getBoundingClientRect().height
        const currentBlocksHeight = Number.parseInt(
          getComputedStyle(document.documentElement).getPropertyValue('--blocks-height')
        )
        const currentTriggersHeight = Number.parseInt(
          getComputedStyle(document.documentElement).getPropertyValue('--triggers-height')
        )

        if (panelType === 'triggers') {
          const minAllowedHeight = currentBlocksHeight + HEADER_HEIGHT
          const isShrinkingTriggers = deltaY < 0
          const isFullyCollapsed = Math.abs(currentTriggersHeight - minAllowedHeight) <= 2

          if (isFullyCollapsed && isShrinkingTriggers && currentBlocksHeight > MIN_HEIGHT) {
            // Shrink blocks when triggers is fully collapsed
            const requestedReduction = currentTriggersHeight - newHeight
            const newBlocksHeight = Math.max(currentBlocksHeight - requestedReduction, MIN_HEIGHT)
            setBlocksHeight(newBlocksHeight)

            const updatedMinAllowedHeight = newBlocksHeight + HEADER_HEIGHT
            newHeight = Math.min(newHeight, parentHeight)
            newHeight = Math.max(newHeight, updatedMinAllowedHeight, MIN_HEIGHT)
          } else {
            // Normal behavior
            newHeight = Math.min(newHeight, parentHeight)
            newHeight = Math.max(newHeight, minAllowedHeight, MIN_HEIGHT)
          }

          setTriggersHeight(newHeight)
        } else {
          // Blocks resize logic
          const maxAllowedHeight = currentTriggersHeight - HEADER_HEIGHT
          const isAtMaxHeight = Math.abs(currentBlocksHeight - maxAllowedHeight) <= 2
          const isExpandingBlocks = deltaY > 0

          if (isAtMaxHeight && isExpandingBlocks) {
            // Expand both blocks and triggers together
            const requestedIncrease = newHeight - currentBlocksHeight
            const newTriggersHeight = Math.min(
              currentTriggersHeight + requestedIncrease,
              parentHeight
            )
            setTriggersHeight(newTriggersHeight)
            setBlocksHeight(newHeight)
          } else {
            // Normal behavior
            newHeight = Math.min(newHeight, maxAllowedHeight)
            newHeight = Math.max(newHeight, MIN_HEIGHT)
            setBlocksHeight(newHeight)
          }
        }
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
  }, [isResizing, panelType, containerRef, setTriggersHeight, setBlocksHeight])

  return {
    currentHeight,
    isResizing,
    handleMouseDown,
    handleToggle,
  }
}
