import { useCallback, useRef } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { createDragPreview, type DragItemInfo } from '../components'

const logger = createLogger('ToolbarItemInteractions')

interface UseToolbarItemInteractionsProps {
  /**
   * Whether interactions are disabled
   */
  disabled?: boolean
}

/**
 * Hook for managing drag and click interactions on toolbar items.
 * Provides unified handlers for dragging items to canvas and clicking to add them.
 *
 * @param props - Hook configuration
 * @returns Interaction handlers for drag and click events
 */
export function useToolbarItemInteractions({
  disabled = false,
}: UseToolbarItemInteractionsProps = {}) {
  const dragPreviewRef = useRef<HTMLElement | null>(null)

  /**
   * Handle drag start for toolbar items with custom drag preview
   *
   * @param e - React drag event
   * @param type - Block type identifier
   * @param enableTriggerMode - Whether to enable trigger mode for the block
   * @param dragItemInfo - Information for creating custom drag preview
   */
  const handleDragStart = useCallback(
    (
      e: React.DragEvent<HTMLElement>,
      type: string,
      enableTriggerMode = false,
      dragItemInfo?: DragItemInfo
    ) => {
      if (disabled) {
        e.preventDefault()
        return
      }

      try {
        e.dataTransfer.setData(
          'application/json',
          JSON.stringify({
            type,
            enableTriggerMode,
          })
        )
        e.dataTransfer.effectAllowed = 'move'

        // Create and set custom drag preview if item info is provided
        if (dragItemInfo) {
          // Clean up any existing preview first
          if (dragPreviewRef.current && document.body.contains(dragPreviewRef.current)) {
            document.body.removeChild(dragPreviewRef.current)
          }

          const preview = createDragPreview(dragItemInfo)
          document.body.appendChild(preview)
          dragPreviewRef.current = preview

          // Force browser to render the element by triggering reflow
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          preview.offsetHeight

          // Set the custom drag image with offset to center it on cursor
          e.dataTransfer.setDragImage(preview, 125, 20)

          // Clean up the preview element after drag ends
          const cleanup = () => {
            if (dragPreviewRef.current && document.body.contains(dragPreviewRef.current)) {
              document.body.removeChild(dragPreviewRef.current)
              dragPreviewRef.current = null
            }
          }

          // Schedule cleanup after a short delay to ensure drag has started
          setTimeout(cleanup, 100)
        }
      } catch (error) {
        logger.error('Failed to set drag data:', error)
      }
    },
    [disabled]
  )

  /**
   * Handle click on toolbar item to add to canvas
   *
   * @param type - Block type identifier
   * @param enableTriggerMode - Whether to enable trigger mode for the block
   */
  const handleItemClick = useCallback(
    (type: string, enableTriggerMode = false) => {
      if (type === 'connectionBlock' || disabled) return

      try {
        const event = new CustomEvent('add-block-from-toolbar', {
          detail: {
            type,
            enableTriggerMode,
          },
        })
        window.dispatchEvent(event)
      } catch (error) {
        logger.error('Failed to dispatch add-block event:', error)
      }
    },
    [disabled]
  )

  return {
    handleDragStart,
    handleItemClick,
  }
}
