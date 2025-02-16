import { useCallback, useState } from 'react'
import { useConsoleStore } from '@/stores/console/store'
import { useEnvironmentStore } from '@/stores/environment/store'
import { useNotificationStore } from '@/stores/notifications/store'
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
  const { addConsole, toggleConsole, isOpen } = useConsoleStore()
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

      const result = await executor.execute('my-run-id')
      setExecutionResult(result)

      // Add console entries for each block execution
      if (result.logs) {
        result.logs.forEach((log) => {
          addConsole({
            output: log.output,
            error: log.error,
            durationMs: log.durationMs,
            startedAt: log.startedAt,
            endedAt: log.endedAt,
            workflowId: activeWorkflowId,
            timestamp: log.startedAt,
            blockName: log.blockName,
            blockType: log.blockType,
          })
        })
      }

      if (result.logs) {
        console.group('Detailed Block Logs')
        result.logs.forEach((log) => {
          console.log(`Block ${log.blockName}: Success=${log.success}`, {
            output: log.output,
            error: log.error,
            durationMs: log.durationMs,
            startedAt: log.startedAt,
            endedAt: log.endedAt,
          })
        })
        console.groupEnd()
      }

      // Show execution result with workflowId
      addNotification(
        result.success ? 'console' : 'error',
        result.success
          ? 'Workflow completed successfully'
          : `Workflow execution failed: ${result.error}`,
        activeWorkflowId
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setExecutionResult({
        success: false,
        output: { response: {} },
        error: errorMessage,
        logs: [],
      })

      // Add error entry to console
      addConsole({
        output: {},
        error: errorMessage,
        durationMs: -1,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        workflowId: activeWorkflowId,
        timestamp: new Date().toISOString(),
        blockName: 'Error',
      })

      addNotification('error', `Workflow execution failed: ${errorMessage}`, activeWorkflowId)
    } finally {
      setIsExecuting(false)
    }
  }, [
    activeWorkflowId,
    blocks,
    edges,
    addNotification,
    addConsole,
    isOpen,
    toggleConsole,
    getAllVariables,
  ])

  return { isExecuting, executionResult, handleRunWorkflow }
}
