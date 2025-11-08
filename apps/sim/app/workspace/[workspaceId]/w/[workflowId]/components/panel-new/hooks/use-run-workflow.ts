import { useCallback } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'

const logger = createLogger('useRunWorkflow')

/**
 * Custom hook to handle workflow execution with usage limit checks.
 * Provides a unified way to run workflows from anywhere in the codebase.
 *
 * Features:
 * - Automatic usage limit checking
 * - Handles execution state
 *
 * @param options - Configuration options
 * @param options.usageExceeded - Whether usage limit is exceeded (required)
 * @param options.onBeforeRun - Optional callback before running workflow
 * @param options.onAfterRun - Optional callback after running workflow
 * @returns Run workflow function and related state
 */
export function useRunWorkflow(options: {
  usageExceeded: boolean
  onBeforeRun?: () => void | Promise<void>
  onAfterRun?: () => void | Promise<void>
}) {
  const { usageExceeded, onBeforeRun, onAfterRun } = options

  const { handleRunWorkflow, isExecuting, handleCancelExecution } = useWorkflowExecution()

  /**
   * Runs the workflow with automatic checks and UI management
   */
  const runWorkflow = useCallback(async () => {
    try {
      // Execute before run callback
      if (onBeforeRun) {
        await onBeforeRun()
      }

      // Check if usage is exceeded
      if (usageExceeded) {
        logger.warn('Usage limit exceeded, opening subscription settings')
        return
      }

      // Run the workflow
      await handleRunWorkflow(undefined)

      // Execute after run callback
      if (onAfterRun) {
        await onAfterRun()
      }
    } catch (error) {
      logger.error('Error running workflow:', { error })
    }
  }, [usageExceeded, onBeforeRun, onAfterRun, handleRunWorkflow])

  /**
   * Cancels the currently executing workflow
   */
  const cancelWorkflow = useCallback(async () => {
    try {
      await handleCancelExecution()
      logger.info('Workflow execution cancelled')
    } catch (error) {
      logger.error('Error cancelling workflow:', { error })
    }
  }, [handleCancelExecution])

  return {
    runWorkflow,
    cancelWorkflow,
    isExecuting,
  }
}
