import { useCallback, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { useConsoleStore } from '@/stores/console/store'
import { useExecutionStore } from '@/stores/execution/store'
import { useNotificationStore } from '@/stores/notifications/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
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
  const { toggleConsole, isOpen } = useConsoleStore()
  const { getAllVariables } = useEnvironmentStore()
  const { isExecuting, setIsExecuting } = useExecutionStore()
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null)

  const persistLogs = async (executionId: string, result: ExecutionResult) => {
    try {
      const response = await fetch(`/api/workflow/${activeWorkflowId}/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          executionId,
          result,
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

    // Open console if it's not already open
    if (!isOpen) {
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
      logger.error('Workflow Execution Error:', { error })

      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      // Set error result and show notification immediately
      const errorResult = {
        success: false,
        output: { response: {} },
        error: errorMessage,
        logs: [],
      }

      setExecutionResult(errorResult)
      addNotification('error', `Workflow execution failed: ${errorMessage}`, activeWorkflowId)

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
    isOpen,
    toggleConsole,
    getAllVariables,
    setIsExecuting,
  ])

  return { isExecuting, executionResult, handleRunWorkflow }
}
