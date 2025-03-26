import { useCallback, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { buildTraceSpans } from '@/lib/logs/trace-spans'
import { useConsoleStore } from '@/stores/panel/console/store'
import { useExecutionStore } from '@/stores/execution/store'
import { useNotificationStore } from '@/stores/notifications/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import { usePanelStore } from '@/stores/panel/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { Executor } from '@/executor'
import { ExecutionResult } from '@/executor/types'
import { Serializer } from '@/serializer'

const logger = createLogger('useWorkflowExecution')

export function useWorkflowExecution() {
  const { blocks, edges, loops } = useWorkflowStore()
  const { activeWorkflowId } = useWorkflowRegistry()
  const { addNotification } = useNotificationStore()
  const { toggleConsole } = useConsoleStore()
  const { togglePanel, setActiveTab } = usePanelStore()
  const { getAllVariables } = useEnvironmentStore()
  const { isDebugModeEnabled } = useGeneralStore()
  const { getVariablesByWorkflowId, variables } = useVariablesStore()
  const {
    isExecuting,
    isDebugging,
    pendingBlocks,
    executor,
    debugContext,
    setIsExecuting,
    setIsDebugging,
    setPendingBlocks,
    setExecutor,
    setDebugContext,
  } = useExecutionStore()
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

    // Set debug mode if it's enabled in settings
    if (isDebugModeEnabled) {
      setIsDebugging(true)
    }

    // Check if panel is open and open it if not
    const isPanelOpen = usePanelStore.getState().isOpen
    if (!isPanelOpen) {
      togglePanel()
    }
    
    // Set active tab to console
    setActiveTab('console')

    const executionId = uuidv4()

    try {
      // Clear any existing state
      setDebugContext(null)

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

      // Get workflow variables
      const workflowVars = activeWorkflowId ? getVariablesByWorkflowId(activeWorkflowId) : []
      const workflowVariables = workflowVars.reduce(
        (acc, variable) => {
          acc[variable.id] = variable
          return acc
        },
        {} as Record<string, any>
      )

      // Create serialized workflow
      const workflow = new Serializer().serializeWorkflow(mergedStates, edges, loops)

      // Create executor and store in global state
      const newExecutor = new Executor(workflow, currentBlockStates, envVarValues, workflowVariables)
      setExecutor(newExecutor)

      // Execute workflow
      const result = await newExecutor.execute(activeWorkflowId)

      // If we're in debug mode, store the execution context for later steps
      if (result.metadata?.isDebugSession && result.metadata.context) {
        setDebugContext(result.metadata.context)

        // Make sure to update pending blocks
        if (result.metadata.pendingBlocks) {
          setPendingBlocks(result.metadata.pendingBlocks)
        }
      } else {
        // Normal execution completed
        setExecutionResult(result)

        // Show notification
        addNotification(
          result.success ? 'console' : 'error',
          result.success
            ? 'Workflow completed successfully'
            : `Workflow execution failed: ${result.error}`,
          activeWorkflowId
        )

        // In non-debug mode, persist logs
        await persistLogs(executionId, result)
        setIsExecuting(false)
        setIsDebugging(false)
      }
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

      // Safely show error notification
      try {
        addNotification('error', notificationMessage, activeWorkflowId)
      } catch (notificationError) {
        logger.error('Error showing error notification:', notificationError)
        // Fallback console error
        console.error('Workflow execution failed:', errorMessage)
      }

      // Also send the error result to the API
      await persistLogs(executionId, errorResult)
      setIsExecuting(false)
      setIsDebugging(false)
    }
  }, [
    activeWorkflowId,
    blocks,
    edges,
    loops,
    addNotification,
    toggleConsole,
    togglePanel,
    setActiveTab,
    getAllVariables,
    getVariablesByWorkflowId,
    setIsExecuting,
    setIsDebugging,
    isDebugModeEnabled,
  ])

  /**
   * Handles stepping through workflow execution in debug mode
   */
  const handleStepDebug = useCallback(async () => {
    // Log debug information
    logger.info('Step Debug requested', {
      hasExecutor: !!executor,
      hasContext: !!debugContext,
      pendingBlockCount: pendingBlocks.length,
    })

    if (!executor || !debugContext || pendingBlocks.length === 0) {
      logger.error('Cannot step debug - missing required state', {
        executor: !!executor,
        debugContext: !!debugContext,
        pendingBlocks: pendingBlocks.length,
      })

      // Show error notification
      addNotification(
        'error',
        'Cannot step through debugging - missing execution state. Try restarting debug mode.',
        activeWorkflowId || ''
      )

      // Reset debug state
      setIsDebugging(false)
      setIsExecuting(false)
      return
    }

    try {
      console.log('Executing debug step with blocks:', pendingBlocks)

      // Execute the next step with the pending blocks
      const result = await executor.continueExecution(pendingBlocks, debugContext)

      console.log('Debug step execution result:', result)

      // Save the new context in the store
      if (result.metadata?.context) {
        setDebugContext(result.metadata.context)
      }

      // Check if the debug session is complete
      if (
        !result.metadata?.isDebugSession ||
        !result.metadata.pendingBlocks ||
        result.metadata.pendingBlocks.length === 0
      ) {
        logger.info('Debug session complete')
        // Debug session complete
        setExecutionResult(result)

        // Show completion notification
        addNotification(
          result.success ? 'console' : 'error',
          result.success
            ? 'Workflow completed successfully'
            : `Workflow execution failed: ${result.error}`,
          activeWorkflowId || ''
        )

        // Persist logs
        await persistLogs(uuidv4(), result)

        // Reset debug state
        setIsExecuting(false)
        setIsDebugging(false)
        setDebugContext(null)
        setExecutor(null)
        setPendingBlocks([])
      } else {
        // Debug session continues - update UI with new pending blocks
        logger.info('Debug step completed, next blocks pending', {
          nextPendingBlocks: result.metadata.pendingBlocks.length,
        })

        // This is critical - ensure we update the pendingBlocks in the store
        setPendingBlocks(result.metadata.pendingBlocks)
      }
    } catch (error: any) {
      logger.error('Debug Step Error:', error)

      const errorMessage = error instanceof Error ? error.message : String(error)

      // Create error result
      const errorResult = {
        success: false,
        output: { response: {} },
        error: errorMessage,
        logs: debugContext.blockLogs,
      }

      setExecutionResult(errorResult)

      // Safely show error notification
      try {
        addNotification('error', `Debug step failed: ${errorMessage}`, activeWorkflowId || '')
      } catch (notificationError) {
        logger.error('Error showing step error notification:', notificationError)
        console.error('Debug step failed:', errorMessage)
      }

      // Persist logs
      await persistLogs(uuidv4(), errorResult)

      // Reset debug state
      setIsExecuting(false)
      setIsDebugging(false)
      setDebugContext(null)
      setExecutor(null)
      setPendingBlocks([])
    }
  }, [
    executor,
    debugContext,
    pendingBlocks,
    activeWorkflowId,
    addNotification,
    setIsExecuting,
    setIsDebugging,
    setPendingBlocks,
    setDebugContext,
    setExecutor,
  ])

  /**
   * Handles resuming execution in debug mode until completion
   */
  const handleResumeDebug = useCallback(async () => {
    // Log debug information
    logger.info('Resume Debug requested', {
      hasExecutor: !!executor,
      hasContext: !!debugContext,
      pendingBlockCount: pendingBlocks.length,
    })

    if (!executor || !debugContext || pendingBlocks.length === 0) {
      logger.error('Cannot resume debug - missing required state', {
        executor: !!executor,
        debugContext: !!debugContext,
        pendingBlocks: pendingBlocks.length,
      })

      // Show error notification
      addNotification(
        'error',
        'Cannot resume debugging - missing execution state. Try restarting debug mode.',
        activeWorkflowId || ''
      )

      // Reset debug state
      setIsDebugging(false)
      setIsExecuting(false)
      return
    }

    try {
      // Show a notification that we're resuming execution
      try {
        addNotification(
          'info',
          'Resuming workflow execution until completion',
          activeWorkflowId || ''
        )
      } catch (notificationError) {
        logger.error('Error showing resume notification:', notificationError)
        console.info('Resuming workflow execution until completion')
      }

      let currentResult: ExecutionResult = {
        success: true,
        output: { response: {} },
        logs: debugContext.blockLogs,
      }

      // Create copies to avoid mutation issues
      let currentContext = { ...debugContext }
      let currentPendingBlocks = [...pendingBlocks]

      console.log('Starting resume execution with blocks:', currentPendingBlocks)

      // Continue execution until there are no more pending blocks
      let iterationCount = 0
      const maxIterations = 100 // Safety to prevent infinite loops

      while (currentPendingBlocks.length > 0 && iterationCount < maxIterations) {
        logger.info(
          `Resume iteration ${iterationCount + 1}, executing ${currentPendingBlocks.length} blocks`
        )

        currentResult = await executor.continueExecution(currentPendingBlocks, currentContext)

        logger.info(`Resume iteration result:`, {
          success: currentResult.success,
          hasPendingBlocks: !!currentResult.metadata?.pendingBlocks,
          pendingBlockCount: currentResult.metadata?.pendingBlocks?.length || 0,
        })

        // Update context for next iteration
        if (currentResult.metadata?.context) {
          currentContext = currentResult.metadata.context
        } else {
          logger.info('No context in result, ending resume')
          break // No context means we're done
        }

        // Update pending blocks for next iteration
        if (currentResult.metadata?.pendingBlocks) {
          currentPendingBlocks = currentResult.metadata.pendingBlocks
        } else {
          logger.info('No pending blocks in result, ending resume')
          break // No pending blocks means we're done
        }

        // If we don't have a debug session anymore, we're done
        if (!currentResult.metadata?.isDebugSession) {
          logger.info('Debug session ended, ending resume')
          break
        }

        iterationCount++
      }

      if (iterationCount >= maxIterations) {
        logger.warn('Resume execution reached maximum iteration limit')
      }

      logger.info('Resume execution complete', {
        iterationCount,
        success: currentResult.success,
      })

      // Final result is the last step's result
      setExecutionResult(currentResult)

      // Show completion notification
      try {
        addNotification(
          currentResult.success ? 'console' : 'error',
          currentResult.success
            ? 'Workflow completed successfully'
            : `Workflow execution failed: ${currentResult.error}`,
          activeWorkflowId || ''
        )
      } catch (notificationError) {
        logger.error('Error showing completion notification:', notificationError)
        console.info('Workflow execution completed')
      }

      // Persist logs
      await persistLogs(uuidv4(), currentResult)

      // Reset debug state
      setIsExecuting(false)
      setIsDebugging(false)
      setDebugContext(null)
      setExecutor(null)
      setPendingBlocks([])
    } catch (error: any) {
      logger.error('Debug Resume Error:', error)

      const errorMessage = error instanceof Error ? error.message : String(error)

      // Create error result
      const errorResult = {
        success: false,
        output: { response: {} },
        error: errorMessage,
        logs: debugContext.blockLogs,
      }

      setExecutionResult(errorResult)

      // Safely show error notification
      try {
        addNotification('error', `Resume execution failed: ${errorMessage}`, activeWorkflowId || '')
      } catch (notificationError) {
        logger.error('Error showing resume error notification:', notificationError)
        console.error('Resume execution failed:', errorMessage)
      }

      // Persist logs
      await persistLogs(uuidv4(), errorResult)

      // Reset debug state
      setIsExecuting(false)
      setIsDebugging(false)
      setDebugContext(null)
      setExecutor(null)
      setPendingBlocks([])
    }
  }, [
    executor,
    debugContext,
    pendingBlocks,
    activeWorkflowId,
    addNotification,
    setIsExecuting,
    setIsDebugging,
    setPendingBlocks,
    setDebugContext,
    setExecutor,
  ])

  /**
   * Handles cancelling the current debugging session
   */
  const handleCancelDebug = useCallback(() => {
    setIsExecuting(false)
    setIsDebugging(false)
    setDebugContext(null)
    setExecutor(null)
    setPendingBlocks([])
  }, [setIsExecuting, setIsDebugging, setDebugContext, setExecutor, setPendingBlocks])

  return {
    isExecuting,
    isDebugging,
    pendingBlocks,
    executionResult,
    handleRunWorkflow,
    handleStepDebug,
    handleResumeDebug,
    handleCancelDebug,
  }
}
