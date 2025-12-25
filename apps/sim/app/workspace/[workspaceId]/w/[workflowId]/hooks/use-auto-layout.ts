import { useCallback } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import type { AutoLayoutOptions } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/auto-layout-utils'
import { applyAutoLayoutAndUpdateStore as applyAutoLayoutStandalone } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/auto-layout-utils'

export type { AutoLayoutOptions }

const logger = createLogger('useAutoLayout')

interface UseAutoLayoutOptions {
  fitView?: (options?: { padding?: number; duration?: number }) => void
}

/**
 * Hook providing auto-layout functionality for workflows.
 * Binds workflowId context and provides memoized callback for React components.
 * Optionally accepts a fitView function to animate after successful layout.
 *
 * @param workflowId - The workflow ID to apply layout to
 * @param options - Optional configuration including fitView function from useReactFlow
 */
export function useAutoLayout(workflowId: string | null, options: UseAutoLayoutOptions = {}) {
  const { fitView } = options

  const applyAutoLayoutAndUpdateStore = useCallback(
    async (layoutOptions: AutoLayoutOptions = {}) => {
      if (!workflowId) {
        return { success: false, error: 'No workflow ID provided' }
      }
      return applyAutoLayoutStandalone(workflowId, layoutOptions)
    },
    [workflowId]
  )

  /**
   * Applies auto-layout and optionally animates to fit all blocks in view
   */
  const handleAutoLayout = useCallback(async () => {
    try {
      const result = await applyAutoLayoutAndUpdateStore()

      if (result.success) {
        logger.info('Auto layout completed successfully')
        if (fitView) {
          requestAnimationFrame(() => {
            fitView({ padding: 0.8, duration: 600 })
          })
        }
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
