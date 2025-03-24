import { useCallback, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { buildTraceSpans } from '@/lib/logs/trace-spans'
import { useConsoleStore } from '@/stores/console/store'
import { useExecutionStore } from '@/stores/execution/store'
import { useNotificationStore } from '@/stores/notifications/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { Executor } from '@/executor'
import { ExecutionResult } from '@/executor/types'
import { Serializer } from '@/serializer'

const logger = createLogger('useWorkflowExecution')

export function useWorkflowExecution() {
  const { blocks, edges, loops } = useWorkflowStore()
  const { activeWorkflowId } = useWorkflowRegistry()
  const { addNotification } = useNotificationStore()
  const { toggleConsole } = useConsoleStore()
  const { getAllVariables } = useEnvironmentStore()
  const { isExecuting, setIsExecuting } = useExecutionStore()
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null)

  const persistLogs = async (executionId: string, result: ExecutionResult) => {
    try {
      // Build trace spans from execution logs
      const { traceSpans, totalDuration } = buildTraceSpans(result)

      // Add trace spans to the execution result
      const enrichedResult = {
        ...result,
        traceSpans,
        totalDuration,
      }

      const response = await fetch(`/api/workflows/${activeWorkflowId}/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          executionId,
          result: enrichedResult,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to persist logs')
      }
    } catch (error) {
      logger.error('Error persisting logs:', { error })
    }
  }

  const handleRunWorkflow = useCallback(async () => {
    if (!activeWorkflowId) return
    setIsExecuting(true)

    // Get the current console state directly from the store
    const currentIsOpen = useConsoleStore.getState().isOpen
    
    // Open console if it's not already open
    if (!currentIsOpen) {
      toggleConsole()
    }

    const executionId = uuidv4()

    try {
      // Use the mergeSubblockState utility to get all block states
      const mergedStates = mergeSubblockState(blocks)
      const currentBlockStates = Object.entries(mergedStates).reduce(
        (acc, [id, block]) => {
          acc[id] = Object.entries(block.subBlocks).reduce(
            (subAcc, [key, subBlock]) => {
              subAcc[key] = subBlock.value
              return subAcc
            },
            {} as Record<string, any>
          )
          return acc
        },
        {} as Record<string, Record<string, any>>
      )

      // Get environment variables
      const envVars = getAllVariables()
      const envVarValues = Object.entries(envVars).reduce(
        (acc, [key, variable]) => {
          acc[key] = variable.value
          return acc
        },
        {} as Record<string, string>
      )

      // Execute workflow
      const workflow = new Serializer().serializeWorkflow(mergedStates, edges, loops)
      const executor = new Executor(workflow, currentBlockStates, envVarValues)
      const result = await executor.execute(activeWorkflowId)

      // Set result and show notification immediately
      setExecutionResult(result)
      addNotification(
        result.success ? 'console' : 'error',
        result.success
          ? 'Workflow completed successfully'
          : `Workflow execution failed: ${result.error}`,
        activeWorkflowId
      )

      // Send the entire execution result to our API to be processed server-side
      await persistLogs(executionId, result)
    } catch (error: any) {
      logger.error('Workflow Execution Error:', error)

      // Properly extract error message ensuring it's never undefined
      let errorMessage = 'Unknown error'

      if (error instanceof Error) {
        errorMessage = error.message || `Error: ${String(error)}`
      } else if (typeof error === 'string') {
        errorMessage = error
      } else if (error && typeof error === 'object') {
        // Fix the "undefined (undefined)" pattern specifically
        if (
          error.message === 'undefined (undefined)' ||
          (error.error &&
            typeof error.error === 'object' &&
            error.error.message === 'undefined (undefined)')
        ) {
          errorMessage = 'API request failed - no specific error details available'
        }
        // Try to extract error details from potential API or execution errors
        else if (error.message) {
          errorMessage = error.message
        } else if (error.error && typeof error.error === 'string') {
          errorMessage = error.error
        } else if (error.error && typeof error.error === 'object' && error.error.message) {
          errorMessage = error.error.message
        } else {
          // Last resort: stringify the whole object
          try {
            errorMessage = `Error details: ${JSON.stringify(error)}`
          } catch {
            errorMessage = 'Error occurred but details could not be displayed'
          }
        }
      }

      // Ensure errorMessage is never "undefined (undefined)"
      if (errorMessage === 'undefined (undefined)') {
        errorMessage = 'API request failed - no specific error details available'
      }

      // Set error result and show notification immediately
      const errorResult = {
        success: false,
        output: { response: {} },
        error: errorMessage,
        logs: [],
      }

      setExecutionResult(errorResult)

      // Create a more user-friendly notification message
      let notificationMessage = `Workflow execution failed`

      // Add URL for HTTP errors
      if (error && error.request && error.request.url) {
        // Don't show empty URL errors
        if (error.request.url && error.request.url.trim() !== '') {
          notificationMessage += `: Request to ${error.request.url} failed`

          // Add status if available
          if (error.status) {
            notificationMessage += ` (Status: ${error.status})`
          }
        }
      } else {
        // Regular errors
        notificationMessage += `: ${errorMessage}`
      }

      addNotification('error', notificationMessage, activeWorkflowId)

      // Also send the error result to the API
      await persistLogs(executionId, errorResult)
    } finally {
      setIsExecuting(false)
    }
  }, [
    activeWorkflowId,
    blocks,
    edges,
    loops,
    addNotification,
    toggleConsole,
    getAllVariables,
    setIsExecuting,
  ])

  return { isExecuting, executionResult, handleRunWorkflow }
}
