import { useCallback, useEffect, useRef, useState } from 'react'
import { useSidebarStore } from '@/stores/sidebar/store'

/**
 * Default height for panel content when expanded (in pixels)
 */
const DEFAULT_HEIGHT = 200

/**
 * Minimum height for a collapsed panel (in pixels)
 */
const MIN_HEIGHT = 28

/**
 * Height of the panel header (in pixels)
 */
const HEADER_HEIGHT = 28

/**
 * Type representing the available panel types in the sidebar
 */
type PanelType = 'triggers' | 'blocks'

/**
 * Props for the usePanelResize hook
 */
interface UsePanelResizeProps {
  /** Type of panel to resize (triggers or blocks) */
  panelType: PanelType
  /** Reference to the container element for boundary calculations */
  containerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Custom hook to handle panel resize and toggle functionality for Triggers and Blocks.
 * Provides unified logic for both panels with proper constraint handling.
 *
 * @param props - Configuration object containing panel type and container ref
 * @param props.panelType - Type of panel to resize (triggers or blocks)
 * @param props.containerRef - Reference to the container element for boundary calculations
 * @returns Object containing panel state and handlers
 * @returns currentHeight - Current height of the panel in pixels
 * @returns isResizing - Boolean indicating if the panel is currently being resized
 * @returns isCollapsed - Boolean indicating if the panel is currently collapsed
 * @returns handleMouseDown - Handler for mouse down events on the resize handle
 * @returns handleToggle - Handler to toggle panel between collapsed and expanded states
 */
export function usePanelResize({ panelType, containerRef }: UsePanelResizeProps) {
  const { triggersHeight, blocksHeight, setTriggersHeight, setBlocksHeight } = useSidebarStore()

  const [isResizing, setIsResizing] = useState(false)
  const startYRef = useRef<number>(0)
  const startHeightRef = useRef<number>(0)

  // Get current panel's height and setter based on type
  const currentHeight = panelType === 'triggers' ? triggersHeight : blocksHeight

  /**
   * Determine if the panel is currently collapsed
   */
  const isCollapsed =
    panelType === 'triggers'
      ? Math.abs(triggersHeight - (blocksHeight + HEADER_HEIGHT)) <= 2 ||
        triggersHeight <= MIN_HEIGHT
      : blocksHeight <= MIN_HEIGHT

  /**
   * Handles mouse down event on the resize handle to initiate panel resizing
   *
   * @param e - The React mouse event from the resize handle
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
   * Toggles the panel between collapsed and expanded states
   *
   * @remarks
   * Handles complex logic for both triggers and blocks panels, ensuring proper
   * constraints are maintained between the two panels. When collapsing/expanding,
   * it respects minimum heights and parent container boundaries.
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

        // Check if triggers is currently collapsed on top of blocks
        // When triggers is collapsed, its height = blocksHeight + HEADER_HEIGHT
        const expectedCollapsedTriggersHeight = blocksHeight + HEADER_HEIGHT
        const isTriggersCollapsedOnTop =
          Math.abs(triggersHeight - expectedCollapsedTriggersHeight) <= 2

        // IMPORTANT: Set blocks first, then triggers
        // The store enforces: triggersHeight >= blocksHeight + HEADER_HEIGHT
        // So we must reduce blocks first to allow triggers to be reduced
        setBlocksHeight(MIN_HEIGHT)

        // If triggers is collapsed on top of blocks, collapse it too
        if (isTriggersCollapsedOnTop) {
          setTriggersHeight(MIN_HEIGHT)
        }
      }
    }
  }, [panelType, triggersHeight, blocksHeight, setTriggersHeight, setBlocksHeight, containerRef])

  /**
   * Sets up resize event listeners and body styles during resize operations
   *
   * @remarks
   * This effect manages mouse move and mouse up events during resize, applies
   * appropriate cursor styles, and handles complex panel constraint logic including
   * parent container boundaries and interdependent panel heights.
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
    isCollapsed,
    handleMouseDown,
    handleToggle,
  }
}
