import { useCallback, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { processStreamingBlockLogs } from '@/lib/tokenization'
import { getBlock } from '@/blocks'
import type { BlockOutput } from '@/blocks/types'
import { Executor } from '@/executor'
import type { BlockLog, ExecutionResult, StreamingExecution } from '@/executor/types'
import { Serializer } from '@/serializer'
import type { SerializedWorkflow } from '@/serializer/types'
import { useExecutionStore } from '@/stores/execution/store'
import { useConsoleStore } from '@/stores/panel/console/store'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useCurrentWorkflow } from './use-current-workflow'

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
    workspaceId?: string
  }
}

// Debug state validation result
interface DebugValidationResult {
  isValid: boolean
  error?: string
}

export function useWorkflowExecution() {
  const currentWorkflow = useCurrentWorkflow()
  const { activeWorkflowId, workflows } = useWorkflowRegistry()
  const { toggleConsole } = useConsoleStore()
  const { getAllVariables, loadWorkspaceEnvironment } = useEnvironmentStore()
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

  /**
   * Validates debug state before performing debug operations
   */
  const validateDebugState = useCallback((): DebugValidationResult => {
    if (!executor || !debugContext || pendingBlocks.length === 0) {
      const missing = []
      if (!executor) missing.push('executor')
      if (!debugContext) missing.push('debugContext')
      if (pendingBlocks.length === 0) missing.push('pendingBlocks')

      return {
        isValid: false,
        error: `Cannot perform debug operation - missing: ${missing.join(', ')}. Try restarting debug mode.`,
      }
    }
    return { isValid: true }
  }, [executor, debugContext, pendingBlocks])

  /**
   * Resets all debug-related state
   */
  const resetDebugState = useCallback(() => {
    setIsExecuting(false)
    setIsDebugging(false)
    setDebugContext(null)
    setExecutor(null)
    setPendingBlocks([])
    setActiveBlocks(new Set())

    // Reset debug mode setting if it was enabled
    if (isDebugModeEnabled) {
      useGeneralStore.getState().toggleDebugMode()
    }
  }, [
    setIsExecuting,
    setIsDebugging,
    setDebugContext,
    setExecutor,
    setPendingBlocks,
    setActiveBlocks,
    isDebugModeEnabled,
  ])

  /**
   * Checks if debug session is complete based on execution result
   */
  const isDebugSessionComplete = useCallback((result: ExecutionResult): boolean => {
    return (
      !result.metadata?.isDebugSession ||
      !result.metadata.pendingBlocks ||
      result.metadata.pendingBlocks.length === 0
    )
  }, [])

  /**
   * Handles debug session completion
   */
  const handleDebugSessionComplete = useCallback(
    async (result: ExecutionResult) => {
      logger.info('Debug session complete')
      setExecutionResult(result)

      // Persist logs
      await persistLogs(uuidv4(), result)

      // Reset debug state
      resetDebugState()
    },
    [activeWorkflowId, resetDebugState]
  )

  /**
   * Handles debug session continuation
   */
  const handleDebugSessionContinuation = useCallback(
    (result: ExecutionResult) => {
      logger.info('Debug step completed, next blocks pending', {
        nextPendingBlocks: result.metadata?.pendingBlocks?.length || 0,
      })

      // Update debug context and pending blocks
      if (result.metadata?.context) {
        setDebugContext(result.metadata.context)
      }
      if (result.metadata?.pendingBlocks) {
        setPendingBlocks(result.metadata.pendingBlocks)
      }
    },
    [setDebugContext, setPendingBlocks]
  )

  /**
   * Handles debug execution errors
   */
  const handleDebugExecutionError = useCallback(
    async (error: any, operation: string) => {
      logger.error(`Debug ${operation} Error:`, error)

      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorResult = {
        success: false,
        output: {},
        error: errorMessage,
        logs: debugContext?.blockLogs || [],
      }

      setExecutionResult(errorResult)

      // Persist logs
      await persistLogs(uuidv4(), errorResult)

      // Reset debug state
      resetDebugState()
    },
    [debugContext, activeWorkflowId, resetDebugState]
  )

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
    async (workflowInput?: any, enableDebug = false) => {
      if (!activeWorkflowId) return

      // Get workspaceId from workflow metadata
      const workspaceId = workflows[activeWorkflowId]?.workspaceId

      if (!workspaceId) {
        logger.error('Cannot execute workflow without workspaceId')
        return
      }

      // Reset execution result and set execution state
      setExecutionResult(null)
      setIsExecuting(true)

      // Set debug mode only if explicitly requested
      if (enableDebug) {
        setIsDebugging(true)
      }

      // Determine if this is a chat execution
      const isChatExecution =
        workflowInput && typeof workflowInput === 'object' && 'input' in workflowInput

      // For chat executions, we'll use a streaming approach
      if (isChatExecution) {
        const stream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder()
            const executionId = uuidv4()
            const streamedContent = new Map<string, string>()
            const streamReadingPromises: Promise<void>[] = []

            // Handle file uploads if present
            const uploadedFiles: any[] = []
            interface UploadErrorCapableInput {
              onUploadError: (message: string) => void
            }
            const isUploadErrorCapable = (value: unknown): value is UploadErrorCapableInput =>
              !!value &&
              typeof value === 'object' &&
              'onUploadError' in (value as any) &&
              typeof (value as any).onUploadError === 'function'
            if (workflowInput.files && Array.isArray(workflowInput.files)) {
              try {
                for (const fileData of workflowInput.files) {
                  // Create FormData for upload
                  const formData = new FormData()
                  formData.append('file', fileData.file)
                  formData.append('workflowId', activeWorkflowId)
                  formData.append('executionId', executionId)
                  formData.append('workspaceId', workspaceId)

                  // Upload the file
                  const response = await fetch('/api/files/upload', {
                    method: 'POST',
                    body: formData,
                  })

                  if (response.ok) {
                    const uploadResult = await response.json()
                    // Convert upload result to clean UserFile format
                    const processUploadResult = (result: any) => ({
                      id:
                        result.id ||
                        `file_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                      name: result.name,
                      url: result.url,
                      size: result.size,
                      type: result.type,
                      key: result.key,
                      uploadedAt: result.uploadedAt,
                      expiresAt: result.expiresAt,
                    })

                    // The API returns the file directly for single uploads
                    // or { files: [...] } for multiple uploads
                    if (uploadResult.files && Array.isArray(uploadResult.files)) {
                      uploadedFiles.push(...uploadResult.files.map(processUploadResult))
                    } else if (uploadResult.path || uploadResult.url) {
                      // Single file upload - the result IS the file object
                      uploadedFiles.push(processUploadResult(uploadResult))
                    } else {
                      logger.error('Unexpected upload response format:', uploadResult)
                    }
                  } else {
                    const errorText = await response.text()
                    const message = `Failed to upload ${fileData.name}: ${response.status} ${errorText}`
                    logger.error(message)
                    if (isUploadErrorCapable(workflowInput)) {
                      try {
                        workflowInput.onUploadError(message)
                      } catch {}
                    }
                  }
                }
                // Update workflow input with uploaded files
                workflowInput.files = uploadedFiles
              } catch (error) {
                logger.error('Error uploading files:', error)
                if (isUploadErrorCapable(workflowInput)) {
                  try {
                    workflowInput.onUploadError('Unexpected error uploading files')
                  } catch {}
                }
                // Continue execution even if file upload fails
                workflowInput.files = []
              }
            }

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

              // Check if execution was cancelled
              if (
                result &&
                'success' in result &&
                !result.success &&
                result.error === 'Workflow execution was cancelled'
              ) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ event: 'cancelled', data: result })}\n\n`
                  )
                )
                return
              }

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
      currentWorkflow,
      toggleConsole,
      getAllVariables,
      loadWorkspaceEnvironment,
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
    // Use currentWorkflow but check if we're in diff mode
    const {
      blocks: workflowBlocks,
      edges: workflowEdges,
      loops: workflowLoops,
      parallels: workflowParallels,
    } = currentWorkflow

    // Filter out blocks without type (these are layout-only blocks)
    const validBlocks = Object.entries(workflowBlocks).reduce(
      (acc, [blockId, block]) => {
        if (block?.type) {
          acc[blockId] = block
        }
        return acc
      },
      {} as typeof workflowBlocks
    )

    const isExecutingFromChat =
      workflowInput && typeof workflowInput === 'object' && 'input' in workflowInput

    logger.info('Executing workflow', {
      isDiffMode: currentWorkflow.isDiffMode,
      isExecutingFromChat,
      totalBlocksCount: Object.keys(workflowBlocks).length,
      validBlocksCount: Object.keys(validBlocks).length,
      edgesCount: workflowEdges.length,
    })

    // Debug: Check for blocks with undefined types before merging
    Object.entries(workflowBlocks).forEach(([blockId, block]) => {
      if (!block || !block.type) {
        logger.error('Found block with undefined type before merging:', { blockId, block })
      }
    })

    // Merge subblock states from the appropriate store (scoped to active workflow)
    const mergedStates = mergeSubblockState(validBlocks, activeWorkflowId ?? undefined)

    // Debug: Check for blocks with undefined types after merging
    Object.entries(mergedStates).forEach(([blockId, block]) => {
      if (!block || !block.type) {
        logger.error('Found block with undefined type after merging:', { blockId, block })
      }
    })

    // Filter out trigger blocks for manual execution
    const filteredStates = Object.entries(mergedStates).reduce(
      (acc, [id, block]) => {
        // Skip blocks with undefined type
        if (!block || !block.type) {
          logger.warn(`Skipping block with undefined type: ${id}`, block)
          return acc
        }

        const blockConfig = getBlock(block.type)
        const isTriggerBlock = blockConfig?.category === 'triggers'

        // Skip trigger blocks during manual execution
        if (!isTriggerBlock) {
          acc[id] = block
        }
        return acc
      },
      {} as typeof mergedStates
    )

    const currentBlockStates = Object.entries(filteredStates).reduce(
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

    // Get workspaceId from workflow metadata
    const workspaceId = activeWorkflowId ? workflows[activeWorkflowId]?.workspaceId : undefined

    // Get environment variables with workspace precedence
    const personalEnvVars = getAllVariables()
    const personalEnvValues = Object.entries(personalEnvVars).reduce(
      (acc, [key, variable]) => {
        acc[key] = variable.value
        return acc
      },
      {} as Record<string, string>
    )

    // Load workspace environment variables if workspaceId exists
    let workspaceEnvValues: Record<string, string> = {}
    if (workspaceId) {
      try {
        const workspaceData = await loadWorkspaceEnvironment(workspaceId)
        workspaceEnvValues = workspaceData.workspace || {}
      } catch (error) {
        logger.warn('Failed to load workspace environment variables:', error)
      }
    }

    // Merge with workspace taking precedence over personal
    const envVarValues = { ...personalEnvValues, ...workspaceEnvValues }

    // Get workflow variables
    const workflowVars = activeWorkflowId ? getVariablesByWorkflowId(activeWorkflowId) : []
    const workflowVariables = workflowVars.reduce(
      (acc, variable) => {
        acc[variable.id] = variable
        return acc
      },
      {} as Record<string, any>
    )

    // Filter edges to exclude connections to/from trigger blocks
    const triggerBlockIds = Object.keys(mergedStates).filter((id) => {
      const blockConfig = getBlock(mergedStates[id].type)
      return blockConfig?.category === 'triggers'
    })

    const filteredEdges = workflowEdges.filter(
      (edge) => !triggerBlockIds.includes(edge.source) && !triggerBlockIds.includes(edge.target)
    )

    // Create serialized workflow with filtered blocks and edges
    const workflow = new Serializer().serializeWorkflow(
      filteredStates,
      filteredEdges,
      workflowLoops,
      workflowParallels
    )

    // If this is a chat execution, get the selected outputs
    let selectedOutputIds: string[] | undefined
    if (isExecutingFromChat && activeWorkflowId) {
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
        stream: isExecutingFromChat,
        selectedOutputIds,
        edges: workflow.connections.map((conn) => ({
          source: conn.source,
          target: conn.target,
        })),
        onStream,
        executionId,
        workspaceId,
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

    return errorResult
  }

  /**
   * Handles stepping through workflow execution in debug mode
   */
  const handleStepDebug = useCallback(async () => {
    logger.info('Step Debug requested', {
      hasExecutor: !!executor,
      hasContext: !!debugContext,
      pendingBlockCount: pendingBlocks.length,
    })

    // Validate debug state
    const validation = validateDebugState()
    if (!validation.isValid) {
      resetDebugState()
      return
    }

    try {
      logger.info('Executing debug step with blocks:', pendingBlocks)
      const result = await executor!.continueExecution(pendingBlocks, debugContext!)
      logger.info('Debug step execution result:', result)

      if (isDebugSessionComplete(result)) {
        await handleDebugSessionComplete(result)
      } else {
        handleDebugSessionContinuation(result)
      }
    } catch (error: any) {
      await handleDebugExecutionError(error, 'step')
    }
  }, [
    executor,
    debugContext,
    pendingBlocks,
    activeWorkflowId,
    validateDebugState,
    resetDebugState,
    isDebugSessionComplete,
    handleDebugSessionComplete,
    handleDebugSessionContinuation,
    handleDebugExecutionError,
  ])

  /**
   * Handles resuming execution in debug mode until completion
   */
  const handleResumeDebug = useCallback(async () => {
    logger.info('Resume Debug requested', {
      hasExecutor: !!executor,
      hasContext: !!debugContext,
      pendingBlockCount: pendingBlocks.length,
    })

    // Validate debug state
    const validation = validateDebugState()
    if (!validation.isValid) {
      resetDebugState()
      return
    }

    try {
      logger.info('Resuming workflow execution until completion')

      let currentResult: ExecutionResult = {
        success: true,
        output: {},
        logs: debugContext!.blockLogs,
      }

      // Create copies to avoid mutation issues
      let currentContext = { ...debugContext! }
      let currentPendingBlocks = [...pendingBlocks]

      logger.info('Starting resume execution with blocks:', currentPendingBlocks)

      // Continue execution until there are no more pending blocks
      let iterationCount = 0
      const maxIterations = 500 // Safety to prevent infinite loops

      while (currentPendingBlocks.length > 0 && iterationCount < maxIterations) {
        logger.info(
          `Resume iteration ${iterationCount + 1}, executing ${currentPendingBlocks.length} blocks`
        )

        currentResult = await executor!.continueExecution(currentPendingBlocks, currentContext)

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
          break
        }

        // Update pending blocks for next iteration
        if (currentResult.metadata?.pendingBlocks) {
          currentPendingBlocks = currentResult.metadata.pendingBlocks
        } else {
          logger.info('No pending blocks in result, ending resume')
          break
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

      // Handle completion
      await handleDebugSessionComplete(currentResult)
    } catch (error: any) {
      await handleDebugExecutionError(error, 'resume')
    }
  }, [
    executor,
    debugContext,
    pendingBlocks,
    activeWorkflowId,
    validateDebugState,
    resetDebugState,
    handleDebugSessionComplete,
    handleDebugExecutionError,
  ])

  /**
   * Handles cancelling the current debugging session
   */
  const handleCancelDebug = useCallback(() => {
    logger.info('Debug session cancelled')
    resetDebugState()
  }, [resetDebugState])

  /**
   * Handles cancelling the current workflow execution
   */
  const handleCancelExecution = useCallback(() => {
    logger.info('Workflow execution cancellation requested')

    // Cancel the executor if it exists
    if (executor) {
      executor.cancel()
    }

    // Reset execution state
    setIsExecuting(false)
    setIsDebugging(false)
    setActiveBlocks(new Set())

    // If in debug mode, also reset debug state
    if (isDebugging) {
      resetDebugState()
    }
  }, [executor, isDebugging, resetDebugState, setIsExecuting, setIsDebugging, setActiveBlocks])

  return {
    isExecuting,
    isDebugging,
    pendingBlocks,
    executionResult,
    handleRunWorkflow,
    handleStepDebug,
    handleResumeDebug,
    handleCancelDebug,
    handleCancelExecution,
  }
}
