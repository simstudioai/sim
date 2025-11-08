import { useCallback } from 'react'
import { createLogger } from '@/lib/logs/console/logger'

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
  /**
   * Handle drag start for toolbar items
   *
   * @param e - React drag event
   * @param type - Block type identifier
   * @param enableTriggerMode - Whether to enable trigger mode for the block
   */
  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLElement>, type: string, enableTriggerMode = false) => {
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
