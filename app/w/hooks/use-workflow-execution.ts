import { useCallback, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
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

export function useWorkflowExecution() {
  const { blocks, edges, loops } = useWorkflowStore()
  const { activeWorkflowId } = useWorkflowRegistry()
  const { addNotification } = useNotificationStore()
  const { toggleConsole, isOpen } = useConsoleStore()
  const { getAllVariables } = useEnvironmentStore()
  const { isExecuting, setIsExecuting } = useExecutionStore()
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null)

  const persistLogs = async (logs: any[], executionId: string) => {
    // Check if we're in local storage mode
    const useLocalStorage =
      typeof window !== 'undefined' &&
      (window.localStorage.getItem('USE_LOCAL_STORAGE') === 'true' ||
        process.env.NEXT_PUBLIC_USE_LOCAL_STORAGE === 'true')

    if (useLocalStorage) {
      // Store logs in localStorage
      try {
        const storageKey = `workflow-logs-${activeWorkflowId}-${executionId}`
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({
            logs,
            timestamp: new Date().toISOString(),
            workflowId: activeWorkflowId,
          })
        )

        // Also update a list of all execution logs for this workflow
        const logListKey = `workflow-logs-list-${activeWorkflowId}`
        const existingLogList = window.localStorage.getItem(logListKey)
        const logList = existingLogList ? JSON.parse(existingLogList) : []
        logList.push({
          executionId,
          timestamp: new Date().toISOString(),
        })

        // Keep only the last 20 executions
        if (logList.length > 20) {
          const removedLogs = logList.splice(0, logList.length - 20)
          // Clean up old logs
          removedLogs.forEach((log: any) => {
            window.localStorage.removeItem(`workflow-logs-${activeWorkflowId}-${log.executionId}`)
          })
        }

        window.localStorage.setItem(logListKey, JSON.stringify(logList))
      } catch (error) {
        console.error('Error storing logs in localStorage:', error)
      }
      return
    }

    // Fall back to API if not in local storage mode
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

      // Set result and show notification immediately
      setExecutionResult(result)
      addNotification(
        result.success ? 'console' : 'error',
        result.success
          ? 'Workflow completed successfully'
          : `Workflow execution failed: ${result.error}`,
        activeWorkflowId
      )

      // Prepare logs for persistence (moved after notification)
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

      // Persist logs after notification
      await persistLogs(blockLogs, executionId)
    } catch (error: any) {
      console.error('Workflow Execution Error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      // Set error result and show notification immediately
      setExecutionResult({
        success: false,
        output: { response: {} },
        error: errorMessage,
        logs: [],
      })
      addNotification('error', `Workflow execution failed: ${errorMessage}`, activeWorkflowId)

      // Persist error log after notification
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
    isExecuting,
    setIsExecuting,
  ])

  return { isExecuting, executionResult, handleRunWorkflow }
}
