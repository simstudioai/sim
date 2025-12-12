import { useCallback } from 'react'
import { useReactFlow } from 'reactflow'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('useFocusOnBlock')

/**
 * Hook to focus the canvas on a specific block with smooth animation.
 * Can be called from any component within the workflow (editor, toolbar, action bar, etc.).
 *
 * @returns Function to focus on a block by its ID
 *
 * @example
 * const focusOnBlock = useFocusOnBlock()
 * focusOnBlock('block-id-123')
 */
export function useFocusOnBlock() {
  const { getNodes, fitView } = useReactFlow()

  return useCallback(
    (blockId: string) => {
      if (!blockId) {
        logger.warn('Cannot focus on block: no blockId provided')
        return
      }

      try {
        // Check if the node exists
        const node = getNodes().find((n) => n.id === blockId)
        if (!node) {
          logger.warn('Cannot focus on block: block not found', { blockId })
          return
        }

        // Focus on the specific node with smooth animation
        fitView({
          nodes: [node],
          duration: 400,
          padding: 0.3,
          minZoom: 0.5,
          maxZoom: 1.0,
        })

        logger.info('Focused on block', { blockId })
      } catch (err) {
        logger.error('Failed to focus on block', { err, blockId })
      }
    },
    [getNodes, fitView]
  )
}
