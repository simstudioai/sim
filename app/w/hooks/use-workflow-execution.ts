import { useCallback, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
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

  const persistLogs = async (logs: any[], executionId: string) => {
    try {
      const response = await fetch(`/api/workflow/${activeWorkflowId}/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ logs, executionId }),
      })

      if (!response.ok) {
        throw new Error('Failed to persist logs')
      }
    } catch (error) {
      console.error('Error persisting logs:', error)
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

      // Prepare logs for persistence
      const blockLogs = (result.logs || []).map((log) => ({
        level: log.success ? 'info' : 'error',
        message: `Block ${log.blockName || log.blockId} (${log.blockType}): ${
          log.error || 'Completed successfully'
        }`,
        duration: log.success ? `${log.durationMs}ms` : 'NA',
        createdAt: new Date(log.endedAt || log.startedAt).toISOString(),
      }))

      // Calculate total duration from successful block logs
      const totalDuration = (result.logs || [])
        .filter((log) => log.success)
        .reduce((sum, log) => sum + log.durationMs, 0)

      // Add final execution result log
      blockLogs.push({
        level: result.success ? 'info' : 'error',
        message: result.success
          ? 'Manual workflow executed successfully'
          : `Manual workflow execution failed: ${result.error}`,
        duration: result.success ? `${totalDuration}ms` : 'NA',
        createdAt: new Date().toISOString(),
      })

      // Persist all logs
      await persistLogs(blockLogs, executionId)

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

      // Persist error log
      await persistLogs(
        [
          {
            level: 'error',
            message: `Manual workflow execution failed: ${errorMessage}`,
            duration: 'NA',
            createdAt: new Date().toISOString(),
          },
        ],
        executionId
      )

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
