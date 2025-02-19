import { useCallback, useState } from 'react'
import { useConsoleStore } from '@/stores/console/store'
import { useNotificationStore } from '@/stores/notifications/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { useWorkflowRegistry } from '@/stores/workflow/registry/store'
import { useWorkflowStore } from '@/stores/workflow/store'
import { useSubBlockStore } from '@/stores/workflow/subblock/store'
import { mergeSubblockState } from '@/stores/workflow/utils'
import { Executor } from '@/executor'
import { ExecutionResult } from '@/executor/types'
import { Serializer } from '@/serializer'

export function useWorkflowExecution() {
  const [isExecuting, setIsExecuting] = useState(false)
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null)
  const { blocks, edges, loops } = useWorkflowStore()
  const { activeWorkflowId } = useWorkflowRegistry()
  const { addNotification } = useNotificationStore()
  const { toggleConsole, isOpen } = useConsoleStore()
  const { getAllVariables } = useEnvironmentStore()

  const handleRunWorkflow = useCallback(async () => {
    if (!activeWorkflowId) return
    setIsExecuting(true)

    // Open console if it's not already open
    if (!isOpen) {
      toggleConsole()
    }

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

      // Debug logging
      console.group('Workflow Execution State')
      console.log('Block Configurations:', blocks)
      console.log(
        'SubBlock Store Values:',
        useSubBlockStore.getState().workflowValues[activeWorkflowId]
      )
      console.log('Merged Block States for Execution:', currentBlockStates)
      console.groupEnd()

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

      setExecutionResult(result)

      // Show execution result notification
      addNotification(
        result.success ? 'console' : 'error',
        result.success
          ? 'Workflow completed successfully'
          : `Workflow execution failed: ${result.error}`,
        activeWorkflowId
      )
    } catch (error: any) {
      console.error('Workflow Execution Error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setExecutionResult({
        success: false,
        output: { response: {} },
        error: errorMessage,
        logs: [],
      })

      addNotification('error', `Workflow execution failed: ${errorMessage}`, activeWorkflowId)
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
  ])

  return { isExecuting, executionResult, handleRunWorkflow }
}
