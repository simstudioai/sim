import { useCallback, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { shallow } from 'zustand/shallow'
import { createLogger } from '@/lib/logs/console/logger'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { processStreamingBlockLogs } from '@/lib/tokenization'
import {
  extractTriggerMockPayload,
  selectBestTrigger,
  triggerNeedsMockPayload,
} from '@/lib/workflows/trigger-utils'
import { resolveStartCandidates, StartBlockPath, TriggerUtils } from '@/lib/workflows/triggers'
import type { BlockLog, ExecutionResult, StreamingExecution } from '@/executor/types'
import { useExecutionStream } from '@/hooks/use-execution-stream'
import { WorkflowValidationError } from '@/serializer'
import { useExecutionStore } from '@/stores/execution/store'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { type ConsoleEntry, useTerminalConsoleStore } from '@/stores/terminal'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useCurrentWorkflow } from './use-current-workflow'

const logger = createLogger('useWorkflowExecution')

// Debug state validation result
interface DebugValidationResult {
  isValid: boolean
  error?: string
}

const WORKFLOW_EXECUTION_FAILURE_MESSAGE = 'Workflow execution failed'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sanitizeMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'undefined (undefined)') return undefined
  return trimmed
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = sanitizeMessage(error.message)
    if (message) return message
  } else if (typeof error === 'string') {
    const message = sanitizeMessage(error)
    if (message) return message
  }

  if (isRecord(error)) {
    const directMessage = sanitizeMessage(error.message)
    if (directMessage) return directMessage

    const nestedError = error.error
    if (isRecord(nestedError)) {
      const nestedMessage = sanitizeMessage(nestedError.message)
      if (nestedMessage) return nestedMessage
    } else {
      const nestedMessage = sanitizeMessage(nestedError)
      if (nestedMessage) return nestedMessage
    }
  }

  return WORKFLOW_EXECUTION_FAILURE_MESSAGE
}

function isExecutionResult(value: unknown): value is ExecutionResult {
  if (!isRecord(value)) return false
  return typeof value.success === 'boolean' && isRecord(value.output)
}

function extractExecutionResult(error: unknown): ExecutionResult | null {
  if (!isRecord(error)) return null
  const candidate = error.executionResult
  return isExecutionResult(candidate) ? candidate : null
}

export function useWorkflowExecution() {
  const currentWorkflow = useCurrentWorkflow()
  const { activeWorkflowId, workflows } = useWorkflowRegistry()
  const { toggleConsole, addConsole } = useTerminalConsoleStore()
  const { getAllVariables, loadWorkspaceEnvironment } = useEnvironmentStore()
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
  const executionStream = useExecutionStream()
  const {
    diffWorkflow: executionDiffWorkflow,
    isDiffReady: isDiffWorkflowReady,
    isShowingDiff: isViewingDiff,
  } = useWorkflowDiffStore(
    useCallback(
      (state) => ({
        diffWorkflow: state.diffWorkflow,
        isDiffReady: state.isDiffReady,
        isShowingDiff: state.isShowingDiff,
      }),
      []
    ),
    shallow
  )
  const hasActiveDiffWorkflow =
    isDiffWorkflowReady &&
    isViewingDiff &&
    !!executionDiffWorkflow &&
    Object.keys(executionDiffWorkflow.blocks || {}).length > 0

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
  }, [
    setIsExecuting,
    setIsDebugging,
    setDebugContext,
    setExecutor,
    setPendingBlocks,
    setActiveBlocks,
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
            const { encodeSSE } = await import('@/lib/utils')
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
                  formData.append('context', 'execution')
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

            const streamCompletionTimes = new Map<string, number>()

            const onStream = async (streamingExecution: StreamingExecution) => {
              const promise = (async () => {
                if (!streamingExecution.stream) return
                const reader = streamingExecution.stream.getReader()
                const blockId = (streamingExecution.execution as any)?.blockId
                const streamStartTime = Date.now()
                let isFirstChunk = true

                if (blockId) {
                  streamedContent.set(blockId, '')
                }
                try {
                  while (true) {
                    const { done, value } = await reader.read()
                    if (done) {
                      // Record when this stream completed
                      if (blockId) {
                        streamCompletionTimes.set(blockId, Date.now())
                      }
                      break
                    }
                    const chunk = new TextDecoder().decode(value)
                    if (blockId) {
                      streamedContent.set(blockId, (streamedContent.get(blockId) || '') + chunk)
                    }

                    // Add separator before first chunk if this isn't the first block
                    let chunkToSend = chunk
                    if (isFirstChunk && streamedContent.size > 1) {
                      chunkToSend = `\n\n${chunk}`
                      isFirstChunk = false
                    } else if (isFirstChunk) {
                      isFirstChunk = false
                    }

                    controller.enqueue(encodeSSE({ blockId, chunk: chunkToSend }))
                  }
                } catch (error) {
                  logger.error('Error reading from stream:', error)
                  controller.error(error)
                }
              })()
              streamReadingPromises.push(promise)
            }

            // Handle non-streaming blocks (like Function blocks)
            const onBlockComplete = async (blockId: string, output: any) => {
              // Skip if this block already had streaming content (avoid duplicates)
              if (streamedContent.has(blockId)) {
                logger.debug('[handleRunWorkflow] Skipping onBlockComplete for streaming block', {
                  blockId,
                })
                return
              }

              // Get selected outputs from chat store
              const chatStore = await import('@/stores/chat/store').then((mod) => mod.useChatStore)
              const selectedOutputs = chatStore
                .getState()
                .getSelectedWorkflowOutput(activeWorkflowId)

              if (!selectedOutputs?.length) return

              const { extractBlockIdFromOutputId, extractPathFromOutputId, traverseObjectPath } =
                await import('@/lib/response-format')

              // Check if this block's output is selected
              const matchingOutputs = selectedOutputs.filter(
                (outputId) => extractBlockIdFromOutputId(outputId) === blockId
              )

              if (!matchingOutputs.length) return

              // Process each selected output from this block
              for (const outputId of matchingOutputs) {
                const path = extractPathFromOutputId(outputId, blockId)
                const outputValue = traverseObjectPath(output, path)

                if (outputValue !== undefined) {
                  const formattedOutput =
                    typeof outputValue === 'string'
                      ? outputValue
                      : JSON.stringify(outputValue, null, 2)

                  // Add separator if this isn't the first output
                  const separator = streamedContent.size > 0 ? '\n\n' : ''

                  // Send the non-streaming block output as a chunk
                  controller.enqueue(encodeSSE({ blockId, chunk: separator + formattedOutput }))

                  // Track that we've sent output for this block
                  streamedContent.set(blockId, formattedOutput)
                }
              }
            }

            try {
              const result = await executeWorkflow(
                workflowInput,
                onStream,
                executionId,
                onBlockComplete,
                'chat'
              )

              // Check if execution was cancelled
              if (
                result &&
                'success' in result &&
                !result.success &&
                result.error === 'Workflow execution was cancelled'
              ) {
                controller.enqueue(encodeSSE({ event: 'cancelled', data: result }))
                return
              }

              await Promise.all(streamReadingPromises)

              if (result && 'success' in result) {
                if (!result.metadata) {
                  result.metadata = { duration: 0, startTime: new Date().toISOString() }
                }
                ;(result.metadata as any).source = 'chat'

                // Update block logs with actual stream completion times
                if (result.logs && streamCompletionTimes.size > 0) {
                  const streamCompletionEndTime = new Date(
                    Math.max(...Array.from(streamCompletionTimes.values()))
                  ).toISOString()

                  result.logs.forEach((log: BlockLog) => {
                    if (streamCompletionTimes.has(log.blockId)) {
                      const completionTime = streamCompletionTimes.get(log.blockId)!
                      const startTime = new Date(log.startedAt).getTime()

                      // Update the log with actual stream completion time
                      log.endedAt = new Date(completionTime).toISOString()
                      log.durationMs = completionTime - startTime
                    }
                  })
                }

                // Update streamed content and apply tokenization
                if (result.logs) {
                  result.logs.forEach((log: BlockLog) => {
                    if (streamedContent.has(log.blockId)) {
                      // For console display, show the actual structured block output instead of formatted streaming content
                      // This ensures console logs match the block state structure
                      // Use replaceOutput to completely replace the output instead of merging
                      // Use the executionId from this execution context
                      useTerminalConsoleStore.getState().updateConsole(
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

                const { encodeSSE } = await import('@/lib/utils')
                controller.enqueue(encodeSSE({ event: 'final', data: result }))
                // Note: Logs are already persisted server-side via execution-core.ts
              }
            } catch (error: any) {
              // Create a proper error result for logging
              const errorResult = {
                success: false,
                error: error.message || 'Workflow execution failed',
                output: {},
                logs: [],
                metadata: {
                  duration: 0,
                  startTime: new Date().toISOString(),
                  source: 'chat' as const,
                },
              }

              // Send the error as final event so downstream handlers can treat it uniformly
              const { encodeSSE } = await import('@/lib/utils')
              controller.enqueue(encodeSSE({ event: 'final', data: errorResult }))

              // Do not error the controller to allow consumers to process the final event
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
      const manualExecutionId = uuidv4()
      try {
        const result = await executeWorkflow(
          workflowInput,
          undefined,
          manualExecutionId,
          undefined,
          'manual'
        )
        if (result && 'metadata' in result && result.metadata?.isDebugSession) {
          setDebugContext(result.metadata.context || null)
          if (result.metadata.pendingBlocks) {
            setPendingBlocks(result.metadata.pendingBlocks)
          }
        } else if (result && 'success' in result) {
          setExecutionResult(result)
          // Reset execution state after successful non-debug execution
          setIsExecuting(false)
          setIsDebugging(false)
          setActiveBlocks(new Set())

          if (isChatExecution) {
            if (!result.metadata) {
              result.metadata = { duration: 0, startTime: new Date().toISOString() }
            }
            ;(result.metadata as any).source = 'chat'
          }
        }
        return result
      } catch (error: any) {
        const errorResult = handleExecutionError(error, { executionId: manualExecutionId })
        // Note: Error logs are already persisted server-side via execution-core.ts
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
    executionId?: string,
    onBlockComplete?: (blockId: string, output: any) => Promise<void>,
    overrideTriggerType?: 'chat' | 'manual' | 'api'
  ): Promise<ExecutionResult | StreamingExecution> => {
    // Use diff workflow for execution when available, regardless of canvas view state
    const executionWorkflowState =
      hasActiveDiffWorkflow && executionDiffWorkflow ? executionDiffWorkflow : null
    const usingDiffForExecution = executionWorkflowState !== null

    // Read blocks and edges directly from store to ensure we get the latest state,
    // even if React hasn't re-rendered yet after adding blocks/edges
    const latestWorkflowState = useWorkflowStore.getState().getWorkflowState()
    const workflowBlocks = (executionWorkflowState?.blocks ??
      latestWorkflowState.blocks) as typeof currentWorkflow.blocks
    const workflowEdges = (executionWorkflowState?.edges ??
      latestWorkflowState.edges) as typeof currentWorkflow.edges

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
      overrideTriggerType === 'chat' ||
      (workflowInput && typeof workflowInput === 'object' && 'input' in workflowInput)

    logger.info('Executing workflow', {
      isDiffMode: currentWorkflow.isDiffMode,
      usingDiffForExecution,
      isViewingDiff,
      executingDiffWorkflow: usingDiffForExecution && isViewingDiff,
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

    // Do not filter out trigger blocks; executor may need to start from them
    const filteredStates = Object.entries(mergedStates).reduce(
      (acc, [id, block]) => {
        if (!block || !block.type) {
          logger.warn(`Skipping block with undefined type: ${id}`, block)
          return acc
        }
        acc[id] = block
        return acc
      },
      {} as typeof mergedStates
    )

    // If this is a chat execution, get the selected outputs
    let selectedOutputs: string[] | undefined
    if (isExecutingFromChat && activeWorkflowId) {
      // Get selected outputs from chat store
      const chatStore = await import('@/stores/chat/store').then((mod) => mod.useChatStore)
      selectedOutputs = chatStore.getState().getSelectedWorkflowOutput(activeWorkflowId)
    }

    // Helper to extract test values from inputFormat subblock
    const extractTestValuesFromInputFormat = (inputFormatValue: any): Record<string, any> => {
      const testInput: Record<string, any> = {}

      if (Array.isArray(inputFormatValue)) {
        inputFormatValue.forEach((field: any) => {
          if (field && typeof field === 'object' && field.name && field.value !== undefined) {
            testInput[field.name] = field.value
          }
        })
      }

      return testInput
    }

    // Determine start block and workflow input based on execution type
    let startBlockId: string | undefined
    let finalWorkflowInput = workflowInput

    if (isExecutingFromChat) {
      // For chat execution, find the appropriate chat trigger
      const startBlock = TriggerUtils.findStartBlock(filteredStates, 'chat')

      if (!startBlock) {
        throw new Error(TriggerUtils.getTriggerValidationMessage('chat', 'missing'))
      }

      startBlockId = startBlock.blockId
    } else {
      // Manual execution: detect and group triggers by paths
      const candidates = resolveStartCandidates(filteredStates, {
        execution: 'manual',
      })

      if (candidates.length === 0) {
        const error = new Error('Workflow requires at least one trigger block to execute')
        logger.error('No trigger blocks found for manual run', {
          allBlockTypes: Object.values(filteredStates).map((b) => b.type),
        })
        setIsExecuting(false)
        throw error
      }

      // Check for multiple API triggers (still not allowed)
      const apiCandidates = candidates.filter(
        (candidate) => candidate.path === StartBlockPath.SPLIT_API
      )
      if (apiCandidates.length > 1) {
        const error = new Error('Multiple API Trigger blocks found. Keep only one.')
        logger.error('Multiple API triggers found')
        setIsExecuting(false)
        throw error
      }

      // Select the best trigger
      // Priority: Start Block > Schedules > External Triggers > Legacy
      const selectedTriggers = selectBestTrigger(candidates, workflowEdges)

      // Execute the first/highest priority trigger
      const selectedCandidate = selectedTriggers[0]
      startBlockId = selectedCandidate.blockId
      const selectedTrigger = selectedCandidate.block

      // Validate outgoing connections for non-legacy triggers
      if (selectedCandidate.path !== StartBlockPath.LEGACY_STARTER) {
        const outgoingConnections = workflowEdges.filter((edge) => edge.source === startBlockId)
        if (outgoingConnections.length === 0) {
          const triggerName = selectedTrigger.name || selectedTrigger.type
          const error = new Error(`${triggerName} must be connected to other blocks to execute`)
          logger.error('Trigger has no outgoing connections', { triggerName, startBlockId })
          setIsExecuting(false)
          throw error
        }
      }

      // Prepare input based on trigger type
      if (triggerNeedsMockPayload(selectedCandidate)) {
        const mockPayload = extractTriggerMockPayload(selectedCandidate)
        finalWorkflowInput = mockPayload
      } else if (
        selectedCandidate.path === StartBlockPath.SPLIT_API ||
        selectedCandidate.path === StartBlockPath.SPLIT_INPUT ||
        selectedCandidate.path === StartBlockPath.UNIFIED
      ) {
        const inputFormatValue = selectedTrigger.subBlocks?.inputFormat?.value
        const testInput = extractTestValuesFromInputFormat(inputFormatValue)
        if (Object.keys(testInput).length > 0) {
          finalWorkflowInput = testInput
        }
      }
    }

    // If we don't have a valid startBlockId at this point, throw an error
    if (!startBlockId) {
      const error = new Error('No valid trigger block found to start execution')
      logger.error('No startBlockId found after trigger search')
      setIsExecuting(false)
      throw error
    }

    // Log the final startBlockId
    logger.info('Final execution setup:', {
      startBlockId,
      isExecutingFromChat,
      hasWorkflowInput: !!workflowInput,
    })

    // SERVER-SIDE EXECUTION (always)
    if (activeWorkflowId) {
      logger.info('Using server-side executor')

      let executionResult: ExecutionResult = {
        success: false,
        output: {},
        logs: [],
      }

      const activeBlocksSet = new Set<string>()
      const streamedContent = new Map<string, string>()

      // Execute the workflow
      try {
        await executionStream.execute({
          workflowId: activeWorkflowId,
          input: finalWorkflowInput,
          startBlockId,
          selectedOutputs,
          triggerType: overrideTriggerType || 'manual',
          useDraftState: true,
          // Pass diff workflow state if available for execution
          workflowStateOverride: executionWorkflowState
            ? {
                blocks: executionWorkflowState.blocks,
                edges: executionWorkflowState.edges,
                loops: executionWorkflowState.loops,
                parallels: executionWorkflowState.parallels,
              }
            : undefined,
          callbacks: {
            onExecutionStarted: (data) => {
              logger.info('Server execution started:', data)
            },

            onBlockStarted: (data) => {
              activeBlocksSet.add(data.blockId)
              // Create a new Set to trigger React re-render
              setActiveBlocks(new Set(activeBlocksSet))
            },

            onBlockCompleted: (data) => {
              logger.info('onBlockCompleted received:', { data })

              activeBlocksSet.delete(data.blockId)
              // Create a new Set to trigger React re-render
              setActiveBlocks(new Set(activeBlocksSet))

              // Add to console
              addConsole({
                input: data.input || {},
                output: data.output,
                success: true,
                durationMs: data.durationMs,
                startedAt: new Date(Date.now() - data.durationMs).toISOString(),
                endedAt: new Date().toISOString(),
                workflowId: activeWorkflowId,
                blockId: data.blockId,
                executionId: executionId || uuidv4(),
                blockName: data.blockName || 'Unknown Block',
                blockType: data.blockType || 'unknown',
                // Pass through iteration context for console pills
                iterationCurrent: data.iterationCurrent,
                iterationTotal: data.iterationTotal,
                iterationType: data.iterationType,
              })

              // Call onBlockComplete callback if provided
              if (onBlockComplete) {
                onBlockComplete(data.blockId, data.output).catch((error) => {
                  logger.error('Error in onBlockComplete callback:', error)
                })
              }
            },

            onBlockError: (data) => {
              activeBlocksSet.delete(data.blockId)
              // Create a new Set to trigger React re-render
              setActiveBlocks(new Set(activeBlocksSet))

              // Add error to console
              addConsole({
                input: data.input || {},
                output: {},
                success: false,
                error: data.error,
                durationMs: data.durationMs,
                startedAt: new Date(Date.now() - data.durationMs).toISOString(),
                endedAt: new Date().toISOString(),
                workflowId: activeWorkflowId,
                blockId: data.blockId,
                executionId: executionId || uuidv4(),
                blockName: data.blockName,
                blockType: data.blockType,
                // Pass through iteration context for console pills
                iterationCurrent: data.iterationCurrent,
                iterationTotal: data.iterationTotal,
                iterationType: data.iterationType,
              })
            },

            onStreamChunk: (data) => {
              const existing = streamedContent.get(data.blockId) || ''
              streamedContent.set(data.blockId, existing + data.chunk)

              // Call onStream callback if provided (create a fake StreamingExecution)
              if (onStream && isExecutingFromChat) {
                const stream = new ReadableStream({
                  start(controller) {
                    controller.enqueue(new TextEncoder().encode(data.chunk))
                    controller.close()
                  },
                })

                const streamingExec: StreamingExecution = {
                  stream,
                  execution: {
                    success: true,
                    output: { content: existing + data.chunk },
                    blockId: data.blockId,
                  } as any,
                }

                onStream(streamingExec).catch((error) => {
                  logger.error('Error in onStream callback:', error)
                })
              }
            },

            onStreamDone: (data) => {
              logger.info('Stream done for block:', data.blockId)
            },

            onExecutionCompleted: (data) => {
              executionResult = {
                success: data.success,
                output: data.output,
                metadata: {
                  duration: data.duration,
                  startTime: data.startTime,
                  endTime: data.endTime,
                },
                logs: [],
              }
            },

            onExecutionError: (data) => {
              executionResult = {
                success: false,
                output: {},
                error: data.error,
                metadata: {
                  duration: data.duration,
                },
                logs: [],
              }

              // Only add workflow-level error if no blocks have executed yet
              // This catches pre-execution errors (validation, serialization, etc.)
              // Block execution errors are already logged via onBlockError callback
              const { entries } = useTerminalConsoleStore.getState()
              const existingLogs = entries.filter(
                (log: ConsoleEntry) => log.executionId === executionId
              )

              if (existingLogs.length === 0) {
                // No blocks executed yet - this is a pre-execution error
                addConsole({
                  input: {},
                  output: {},
                  success: false,
                  error: data.error,
                  durationMs: data.duration || 0,
                  startedAt: new Date(Date.now() - (data.duration || 0)).toISOString(),
                  endedAt: new Date().toISOString(),
                  workflowId: activeWorkflowId,
                  blockId: 'validation',
                  executionId: executionId || uuidv4(),
                  blockName: 'Workflow Validation',
                  blockType: 'validation',
                })
              }
            },
          },
        })

        return executionResult
      } catch (error: any) {
        // Don't log abort errors - they're intentional user actions
        if (error.name === 'AbortError' || error.message?.includes('aborted')) {
          logger.info('Execution aborted by user')

          // Reset execution state
          setIsExecuting(false)
          setActiveBlocks(new Set())

          // Return gracefully without error
          return {
            success: false,
            output: {},
            metadata: { duration: 0 },
            logs: [],
          }
        }

        logger.error('Server-side execution failed:', error)
        throw error
      }
    }

    // Fallback: should never reach here
    throw new Error('Server-side execution is required')
  }

  const handleExecutionError = (error: unknown, options?: { executionId?: string }) => {
    const normalizedMessage = normalizeErrorMessage(error)
    const executionResultFromError = extractExecutionResult(error)

    let errorResult: ExecutionResult

    if (executionResultFromError) {
      const logs = Array.isArray(executionResultFromError.logs) ? executionResultFromError.logs : []

      errorResult = {
        ...executionResultFromError,
        success: false,
        error: executionResultFromError.error ?? normalizedMessage,
        logs,
      }
    } else {
      if (!executor) {
        try {
          let blockId = 'serialization'
          let blockName = 'Workflow'
          let blockType = 'serializer'
          if (error instanceof WorkflowValidationError) {
            blockId = error.blockId || blockId
            blockName = error.blockName || blockName
            blockType = error.blockType || blockType
          }

          useTerminalConsoleStore.getState().addConsole({
            input: {},
            output: {},
            success: false,
            error: normalizedMessage,
            durationMs: 0,
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            workflowId: activeWorkflowId || '',
            blockId,
            executionId: options?.executionId,
            blockName,
            blockType,
          })
        } catch {}
      }

      errorResult = {
        success: false,
        output: {},
        error: normalizedMessage,
        logs: [],
      }
    }

    setExecutionResult(errorResult)
    setIsExecuting(false)
    setIsDebugging(false)
    setActiveBlocks(new Set())

    let notificationMessage = WORKFLOW_EXECUTION_FAILURE_MESSAGE
    if (isRecord(error) && isRecord(error.request) && sanitizeMessage(error.request.url)) {
      notificationMessage += `: Request to ${(error.request.url as string).trim()} failed`
      if ('status' in error && typeof error.status === 'number') {
        notificationMessage += ` (Status: ${error.status})`
      }
    } else if (sanitizeMessage(errorResult.error)) {
      notificationMessage += `: ${errorResult.error}`
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

    // Cancel the execution stream (server-side)
    executionStream.cancel()

    // Reset execution state
    setIsExecuting(false)
    setIsDebugging(false)
    setActiveBlocks(new Set())

    // If in debug mode, also reset debug state
    if (isDebugging) {
      resetDebugState()
    }
  }, [
    executionStream,
    isDebugging,
    resetDebugState,
    setIsExecuting,
    setIsDebugging,
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
    handleCancelExecution,
  }
}
