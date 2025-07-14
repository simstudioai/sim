import { useCallback, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { buildTraceSpans } from '@/lib/logs/trace-spans'
import { processStreamingBlockLogs } from '@/lib/tokenization'
import type { BlockOutput } from '@/blocks/types'
import { Executor } from '@/executor'
import type { BlockLog, ExecutionResult, StreamingExecution } from '@/executor/types'
import { Serializer } from '@/serializer'
import type { SerializedWorkflow } from '@/serializer/types'
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

const logger = createLogger('useWorkflowExecution')

// Interface for executor options
interface ExecutorOptions {
  workflow: SerializedWorkflow
  currentBlockStates?: Record<string, BlockOutput>
  envVarValues?: Record<string, string>
  workflowInput?: any
  workflowVariables?: Record<string, any>
  contextExtensions?: {
    stream?: boolean
    selectedOutputIds?: string[]
    edges?: Array<{ source: string; target: string }>
    onStream?: (streamingExecution: StreamingExecution) => Promise<void>
    executionId?: string
  }
}

// Interface for stream error handling
interface StreamError extends Error {
  name: string
  message: string
}

export function useWorkflowExecution() {
  const { blocks, edges, loops, parallels } = useWorkflowStore()
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
      if (streamContent && result.output && typeof streamContent === 'string') {
        // Update the content with the final streaming content
        enrichedResult.output.content = streamContent

        // Also update any block logs to include the content where appropriate
        if (enrichedResult.logs) {
          // Get the streaming block ID from metadata if available
          const streamingBlockId = (result.metadata as any)?.streamingBlockId || null

          for (const log of enrichedResult.logs) {
            // Only update the specific LLM block (agent/router) that was streamed
            const isStreamingBlock = streamingBlockId && log.blockId === streamingBlockId
            if (
              isStreamingBlock &&
              (log.blockType === 'agent' || log.blockType === 'router') &&
              log.output
            )
              log.output.content = streamContent
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
      logger.error('Error persisting logs:', error)
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

      // Determine if this is a chat execution
      const isChatExecution =
        activeTab === 'chat' &&
        workflowInput &&
        typeof workflowInput === 'object' &&
        'input' in workflowInput

      // For chat executions, we'll use a streaming approach
      if (isChatExecution) {
        const stream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder()
            const executionId = uuidv4()
            const streamedContent = new Map<string, string>()
            const streamReadingPromises: Promise<void>[] = []

            const onStream = async (streamingExecution: StreamingExecution) => {
              const promise = (async () => {
                if (!streamingExecution.stream) return
                const reader = streamingExecution.stream.getReader()
                const blockId = (streamingExecution.execution as any)?.blockId
                if (blockId) {
                  streamedContent.set(blockId, '')
                }
                try {
                  while (true) {
                    const { done, value } = await reader.read()
                    if (done) {
                      break
                    }
                    const chunk = new TextDecoder().decode(value)
                    if (blockId) {
                      streamedContent.set(blockId, (streamedContent.get(blockId) || '') + chunk)
                    }
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({
                          blockId,
                          chunk,
                        })}\n\n`
                      )
                    )
                  }
                } catch (error) {
                  logger.error('Error reading from stream:', error)
                  controller.error(error)
                }
              })()
              streamReadingPromises.push(promise)
            }

            try {
              const result = await executeWorkflow(workflowInput, onStream, executionId)

              await Promise.all(streamReadingPromises)

              if (result && 'success' in result) {
                if (!result.metadata) {
                  result.metadata = { duration: 0, startTime: new Date().toISOString() }
                }
                ;(result.metadata as any).source = 'chat'
                // Update streamed content and apply tokenization
                if (result.logs) {
                  result.logs.forEach((log: BlockLog) => {
                    if (streamedContent.has(log.blockId)) {
                      // For console display, show the actual structured block output instead of formatted streaming content
                      // This ensures console logs match the block state structure
                      // Use replaceOutput to completely replace the output instead of merging
                      // Use the executionId from this execution context
                      useConsoleStore.getState().updateConsole(
                        log.blockId,
                        {
                          replaceOutput: log.output,
                          success: true,
                        },
                        executionId
                      )
                    }
                  })

                  // Process all logs for streaming tokenization
                  const processedCount = processStreamingBlockLogs(result.logs, streamedContent)
                  logger.info(`Processed ${processedCount} blocks for streaming tokenization`)
                }

                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ event: 'final', data: result })}\n\n`)
                )
                persistLogs(executionId, result).catch((err) =>
                  logger.error('Error persisting logs:', err)
                )
              }
            } catch (error: any) {
              controller.error(error)
              if (activeWorkflowId) {
                addNotification(
                  'error',
                  `Workflow execution failed: ${error.message}`,
                  activeWorkflowId
                )
              }
            } finally {
              controller.close()
              setIsExecuting(false)
              setIsDebugging(false)
              setActiveBlocks(new Set())
            }
          },
        })
        return { success: true, stream }
      }

      // For manual (non-chat) execution
      const executionId = uuidv4()
      try {
        const result = await executeWorkflow(workflowInput, undefined, executionId)
        if (result && 'metadata' in result && result.metadata?.isDebugSession) {
          setDebugContext(result.metadata.context || null)
          if (result.metadata.pendingBlocks) {
            setPendingBlocks(result.metadata.pendingBlocks)
          }
        } else if (result && 'success' in result) {
          setExecutionResult(result)
          if (!isDebugModeEnabled) {
            setIsExecuting(false)
            setIsDebugging(false)
            setActiveBlocks(new Set())
          }

          if (isChatExecution) {
            if (!result.metadata) {
              result.metadata = { duration: 0, startTime: new Date().toISOString() }
            }
            ;(result.metadata as any).source = 'chat'
          }

          if (activeWorkflowId) {
            addNotification(
              result.success ? 'console' : 'error',
              result.success
                ? 'Workflow completed successfully'
                : `Workflow execution failed: ${result.error || 'Unknown error'}`,
              activeWorkflowId
            )
          }
          persistLogs(executionId, result).catch((err) => {
            logger.error('Error persisting logs:', { error: err })
          })
        }
        return result
      } catch (error: any) {
        const errorResult = handleExecutionError(error)
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
      parallels,
      addNotification,
      toggleConsole,
      togglePanel,
      setActiveTab,
      activeTab,
      getAllVariables,
      getVariablesByWorkflowId,
      isDebugModeEnabled,
      setIsExecuting,
      setIsDebugging,
      setDebugContext,
      setExecutor,
      setPendingBlocks,
      setActiveBlocks,
    ]
  )

  const executeWorkflow = async (
    workflowInput?: any,
    onStream?: (se: StreamingExecution) => Promise<void>,
    executionId?: string
  ): Promise<ExecutionResult | StreamingExecution> => {
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
    const workflow = new Serializer().serializeWorkflow(mergedStates, edges, loops, parallels)

    // Determine if this is a chat execution
    const isChatExecution =
      activeTab === 'chat' &&
      workflowInput &&
      typeof workflowInput === 'object' &&
      'input' in workflowInput

    // If this is a chat execution, get the selected outputs
    let selectedOutputIds: string[] | undefined
    if (isChatExecution && activeWorkflowId) {
      // Get selected outputs from chat store
      const chatStore = await import('@/stores/panel/chat/store').then((mod) => mod.useChatStore)
      selectedOutputIds = chatStore.getState().getSelectedWorkflowOutput(activeWorkflowId)
    }

    // Create executor options
    const executorOptions: ExecutorOptions = {
      workflow,
      currentBlockStates,
      envVarValues,
      workflowInput,
      workflowVariables,
      contextExtensions: {
        stream: isChatExecution,
        selectedOutputIds,
        edges: workflow.connections.map((conn) => ({
          source: conn.source,
          target: conn.target,
        })),
        onStream,
        executionId,
      },
    }

    // Create executor and store in global state
    const newExecutor = new Executor(executorOptions)
    setExecutor(newExecutor)

    // Execute workflow
    return newExecutor.execute(activeWorkflowId || '')
  }

  const handleExecutionError = (error: any) => {
    let errorMessage = 'Unknown error'
    if (error instanceof Error) {
      errorMessage = error.message || `Error: ${String(error)}`
    } else if (typeof error === 'string') {
      errorMessage = error
    } else if (error && typeof error === 'object') {
      if (
        error.message === 'undefined (undefined)' ||
        (error.error &&
          typeof error.error === 'object' &&
          error.error.message === 'undefined (undefined)')
      ) {
        errorMessage = 'API request failed - no specific error details available'
      } else if (error.message) {
        errorMessage = error.message
      } else if (error.error && typeof error.error === 'string') {
        errorMessage = error.error
      } else if (error.error && typeof error.error === 'object' && error.error.message) {
        errorMessage = error.error.message
      } else {
        try {
          errorMessage = `Error details: ${JSON.stringify(error)}`
        } catch {
          errorMessage = 'Error occurred but details could not be displayed'
        }
      }
    }

    if (errorMessage === 'undefined (undefined)') {
      errorMessage = 'API request failed - no specific error details available'
    }

    const errorResult: ExecutionResult = {
      success: false,
      output: {},
      error: errorMessage,
      logs: [],
    }

    setExecutionResult(errorResult)
    setIsExecuting(false)
    setIsDebugging(false)
    setActiveBlocks(new Set())

    let notificationMessage = 'Workflow execution failed'
    if (error?.request?.url) {
      if (error.request.url && error.request.url.trim() !== '') {
        notificationMessage += `: Request to ${error.request.url} failed`
        if (error.status) {
          notificationMessage += ` (Status: ${error.status})`
        }
      }
    } else {
      notificationMessage += `: ${errorMessage}`
    }

    try {
      addNotification('error', notificationMessage, activeWorkflowId || '')
    } catch (notificationError) {
      logger.error('Error showing error notification:', notificationError)
      console.error('Workflow execution failed:', errorMessage)
    }

    return errorResult
  }

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
        output: {},
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
        output: {},
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

        logger.info('Resume iteration result:', {
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
        output: {},
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
