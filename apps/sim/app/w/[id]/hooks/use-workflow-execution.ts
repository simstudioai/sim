import { useCallback, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { buildTraceSpans } from '@/lib/logs/trace-spans'
import { useExecutionStore } from '@/stores/execution/store'
import { useNotificationStore } from '@/stores/notifications/store'
import { useConsoleStore } from '@/stores/panel/console/store'
import { usePanelStore } from '@/stores/panel/store'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { useGeneralStore } from '@/stores/settings/general/store'
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
  const { togglePanel, setActiveTab, activeTab } = usePanelStore()
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
    setActiveBlocks,
  } = useExecutionStore()
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null)

  const persistLogs = async (
    executionId: string,
    result: ExecutionResult,
    streamContent?: string
  ) => {
    try {
      // Build trace spans from execution logs
      const { traceSpans, totalDuration } = buildTraceSpans(result)

      // Add trace spans to the execution result
      const enrichedResult = {
        ...result,
        traceSpans,
        totalDuration,
      }

      // If this was a streaming response and we have the final content, update it
      if (streamContent && result.output?.response && typeof streamContent === 'string') {
        // Update the content with the final streaming content
        enrichedResult.output.response.content = streamContent

        // Also update any block logs to include the content where appropriate
        if (enrichedResult.logs) {
          // Get the streaming block ID from metadata if available
          const streamingBlockId = (result.metadata as any)?.streamingBlockId || null

          for (const log of enrichedResult.logs) {
            // Only update the specific agent block that was streamed
            const isStreamingBlock = streamingBlockId && log.blockId === streamingBlockId
            if (isStreamingBlock && log.blockType === 'agent' && log.output?.response) {
              log.output.response.content = streamContent
            }
          }
        }
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

      return executionId
    } catch (error) {
      logger.error('Error persisting logs:', { error })
      return executionId
    }
  }

  const handleRunWorkflow = useCallback(
    async (workflowInput?: any) => {
      if (!activeWorkflowId) return

      // Reset execution result and set execution state
      setExecutionResult(null)
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
      if (activeTab !== 'console' && activeTab !== 'chat') {
        setActiveTab('console')
      }

      const executionId = uuidv4()

      // Determine if this is a chat execution
      // Only true if the execution is initiated from the chat panel
      // or through a chat-specific execution path
      const isChatExecution =
        activeTab === 'chat' &&
        workflowInput &&
        typeof workflowInput === 'object' &&
        'input' in workflowInput

      // If this is a chat execution, get the selected outputs
      let selectedOutputIds: string[] | undefined = undefined
      if (isChatExecution && activeWorkflowId) {
        // Get selected outputs from chat store
        const chatStore = await import('@/stores/panel/chat/store').then((mod) => mod.useChatStore)
        selectedOutputIds = chatStore.getState().getSelectedWorkflowOutput(activeWorkflowId)
        logger.info('Chat execution with selected outputs:', selectedOutputIds)
      }

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

        // Create executor options with streaming support for chat
        const executorOptions: any = {
          // Default executor options
          workflow,
          currentBlockStates,
          envVarValues,
          workflowInput,
          workflowVariables,
        }

        // Add streaming context for chat executions
        if (isChatExecution && selectedOutputIds && selectedOutputIds.length > 0) {
          executorOptions.contextExtensions = {
            stream: true,
            selectedOutputIds,
            edges: workflow.connections.map((conn) => ({
              source: conn.source,
              target: conn.target,
            })),
          }
        }

        // Create executor and store in global state
        const newExecutor = new Executor(executorOptions)
        setExecutor(newExecutor)

        // Execute workflow
        const result = await newExecutor.execute(activeWorkflowId)

        // Streaming results are handled differently - they won't have a standard result
        if (result instanceof ReadableStream) {
          logger.info('Received streaming result from executor')

          // For streaming results, we need to handle them in the component
          // that initiated the execution (chat panel)
          return {
            success: true,
            stream: result,
          }
        }

        // Handle StreamingExecution format (combined stream + execution result)
        if (result && typeof result === 'object' && 'stream' in result && 'execution' in result) {
          logger.info('Received combined stream+execution result from executor')

          // Generate an executionId and store it in the execution metadata so that
          // the chat component can persist the logs *after* the stream finishes.
          const executionId = uuidv4()

          // Determine which block is streaming - typically the one that matches a selected output ID
          let streamingBlockId = null
          if (selectedOutputIds && selectedOutputIds.length > 0 && result.execution.logs) {
            // Find the agent block in the logs that matches one of our selected outputs
            const streamingBlock = result.execution.logs.find(
              (log) =>
                log.blockType === 'agent' &&
                selectedOutputIds.some(
                  (id) => id === log.blockId || id.startsWith(`${log.blockId}_`)
                )
            )
            if (streamingBlock) {
              streamingBlockId = streamingBlock.blockId
              logger.info(`Identified streaming block: ${streamingBlockId}`)
            }
          }

          // Attach streaming / source metadata and the newly generated executionId
          result.execution.metadata = {
            ...(result.execution.metadata || {}),
            executionId,
            source: isChatExecution ? 'chat' : 'manual',
            streamingBlockId, // Add the block ID to the metadata
          } as any

          // Clean up any response objects with zero tokens in agent blocks to avoid confusion in console
          if (result.execution.logs && Array.isArray(result.execution.logs)) {
            result.execution.logs.forEach((log: any) => {
              if (log.blockType === 'agent' && log.output?.response) {
                const response = log.output.response

                // Check for zero tokens that will be estimated later
                if (
                  response.tokens &&
                  (!response.tokens.completion || response.tokens.completion === 0) &&
                  (!response.toolCalls ||
                    !response.toolCalls.list ||
                    response.toolCalls.list.length === 0)
                ) {
                  // Remove tokens from console display to avoid confusion
                  // They'll be properly estimated in the execution logger
                  delete response.tokens
                }
              }
            })
          }

          // Mark the execution as streaming so that downstream code can recognise it
          ;(result.execution as any).isStreaming = true

          // Return both the stream and the execution object so the caller (chat panel)
          // can collect the full content and then persist the logs in one go.
          // Also include processingPromise if available to ensure token counts are final
          return {
            success: true,
            stream: result.stream,
            execution: result.execution,
            processingPromise: (result as any).processingPromise,
          }
        }

        // Add metadata about source being chat if applicable
        if (isChatExecution) {
          // Use type assertion for adding custom metadata
          ;(result as any).metadata = {
            ...(result.metadata || {}),
            source: 'chat',
          }
        }

        // If we're in debug mode, store the execution context for later steps
        if (result.metadata?.isDebugSession && result.metadata.context) {
          setDebugContext(result.metadata.context)

          // Make sure to update pending blocks
          if (result.metadata.pendingBlocks) {
            setPendingBlocks(result.metadata.pendingBlocks)
          }
        } else {
          // Normal execution completed - start with UI updates
          setExecutionResult(result)

          // For better UI responsiveness, update state immediately
          if (!isDebugModeEnabled) {
            // Reset execution states right away for UI to update
            setIsExecuting(false)
            setIsDebugging(false)
            setActiveBlocks(new Set())
          }

          // Show notification
          addNotification(
            result.success ? 'console' : 'error',
            result.success
              ? 'Workflow completed successfully'
              : `Workflow execution failed: ${result.error}`,
            activeWorkflowId
          )

          // In non-debug mode, persist logs (no need to wait for this)
          // We explicitly don't await this to avoid blocking UI updates
          persistLogs(executionId, result).catch((err) => {
            logger.error('Error persisting logs:', { error: err })
          })
        }

        return result
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

        // Update UI state immediately for better responsiveness
        setExecutionResult(errorResult)
        setIsExecuting(false)
        setIsDebugging(false)
        setActiveBlocks(new Set())

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

        // Also send the error result to the API (don't await to keep UI responsive)
        persistLogs(executionId, errorResult).catch((err) => {
          logger.error('Error persisting logs:', { error: err })
        })

        return errorResult
      }
    },
    [
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
      isDebugging,
      setActiveBlocks,
    ]
  )

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
      setActiveBlocks(new Set())
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
        setActiveBlocks(new Set())
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
      setActiveBlocks(new Set())
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
    setActiveBlocks,
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
      setActiveBlocks(new Set())
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
      setActiveBlocks(new Set())
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
      setActiveBlocks(new Set())
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
    setActiveBlocks,
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
    setActiveBlocks(new Set())
  }, [
    setIsExecuting,
    setIsDebugging,
    setDebugContext,
    setExecutor,
    setPendingBlocks,
    setActiveBlocks,
  ])

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
