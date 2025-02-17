import { useCallback, useState } from 'react'
import { useConsoleStore } from '@/stores/console/store'
import { useNotificationStore } from '@/stores/notifications/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { useWorkflowRegistry } from '@/stores/workflow/registry/store'
import { useWorkflowStore } from '@/stores/workflow/store'
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
      // Extract existing block states
      const currentBlockStates = Object.entries(blocks).reduce(
        (acc, [id, block]) => {
          const responseValue = block.subBlocks?.response?.value
          if (responseValue !== undefined) {
            acc[id] = { response: responseValue }
          }
          return acc
        },
        {} as Record<string, any>
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
      const workflow = new Serializer().serializeWorkflow(blocks, edges, loops)
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
