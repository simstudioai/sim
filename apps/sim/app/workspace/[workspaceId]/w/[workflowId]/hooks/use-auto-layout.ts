import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import { useReactFlow } from 'reactflow'
import type { AutoLayoutOptions } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/auto-layout-utils'
import { applyAutoLayoutAndUpdateStore as applyAutoLayoutStandalone } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/auto-layout-utils'
import { useSnapToGridSize } from '@/hooks/queries/general-settings'
import { useCanvasViewport } from '@/hooks/use-canvas-viewport'

export type { AutoLayoutOptions }

const logger = createLogger('useAutoLayout')

/**
 * Hook providing auto-layout functionality for workflows.
 * Binds workflowId context and provides memoized callback for React components.
 * Includes automatic fitView animation after successful layout.
 * Automatically uses the user's snap-to-grid setting for grid-aligned layout.
 *
 * Note: This hook requires a ReactFlowProvider ancestor.
 */
export function useAutoLayout(workflowId: string | null) {
  const reactFlowInstance = useReactFlow()
  const { fitViewToBounds } = useCanvasViewport(reactFlowInstance)
  const snapToGridSize = useSnapToGridSize()

  const applyAutoLayoutAndUpdateStore = useCallback(
    async (options: AutoLayoutOptions = {}) => {
      if (!workflowId) {
        return { success: false, error: 'No workflow ID provided' }
      }
      // Include gridSize from user's snap-to-grid setting
      const optionsWithGrid: AutoLayoutOptions = {
        ...options,
        gridSize: options.gridSize ?? (snapToGridSize > 0 ? snapToGridSize : undefined),
      }
      return applyAutoLayoutStandalone(workflowId, optionsWithGrid)
    },
    [workflowId, snapToGridSize]
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
          fitViewToBounds({ padding: 0.15, duration: 600 })
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
  }, [applyAutoLayoutAndUpdateStore, fitViewToBounds])

  return {
    applyAutoLayoutAndUpdateStore,
    handleAutoLayout,
  }
}
