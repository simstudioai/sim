import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import { useReactFlow } from 'reactflow'
import type { AutoLayoutOptions } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/auto-layout-utils'
import { applyAutoLayoutAndUpdateStore as applyAutoLayoutStandalone } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/auto-layout-utils'

export type { AutoLayoutOptions }

const logger = createLogger('useAutoLayout')

/**
 * Hook providing auto-layout functionality for workflows.
 * Binds workflowId context and provides memoized callback for React components.
 * Includes automatic fitView animation after successful layout.
 *
 * Note: This hook requires a ReactFlowProvider ancestor.
 */
export function useAutoLayout(workflowId: string | null) {
  const { fitView } = useReactFlow()

  const applyAutoLayoutAndUpdateStore = useCallback(
    async (options: AutoLayoutOptions = {}) => {
      if (!workflowId) {
        return { success: false, error: 'No workflow ID provided' }
      }
      return applyAutoLayoutStandalone(workflowId, options)
    },
    [workflowId]
  )

  /**
   * Applies auto-layout and animates to fit all blocks in view
   */
  const handleAutoLayout = useCallback(async () => {
    try {
      const result = await applyAutoLayoutAndUpdateStore()

      if (result.success) {
        logger.info('Auto layout completed successfully')
        requestAnimationFrame(() => {
          fitView({ padding: 0.8, duration: 600 })
        })
      } else {
        logger.error('Auto layout failed:', result.error)
      }

      return result
    } catch (error) {
      logger.error('Auto layout error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }, [applyAutoLayoutAndUpdateStore, fitView])

  return {
    applyAutoLayoutAndUpdateStore,
    handleAutoLayout,
  }
}
