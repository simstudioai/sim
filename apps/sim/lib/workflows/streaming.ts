import { createLogger } from '@/lib/logs/console/logger'
import { encodeSSE } from '@/lib/utils'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('WorkflowStreaming')

export interface StreamingConfig {
  selectedOutputs?: string[]
  isSecureMode?: boolean
  workflowTriggerType?: 'api' | 'chat'
  onStream?: (streamingExec: {
    stream: ReadableStream
    execution?: { blockId?: string }
  }) => Promise<void>
}

export interface StreamingResponseOptions {
  requestId: string
  workflow: {
    id: string
    userId: string
    workspaceId?: string | null
    isDeployed?: boolean
    variables?: Record<string, any>
  }
  input: any
  executingUserId: string
  streamConfig: StreamingConfig
  createFilteredResult: (result: ExecutionResult) => any
  executionId?: string
}

export async function createStreamingResponse(
  options: StreamingResponseOptions
): Promise<ReadableStream> {
  const {
    requestId,
    workflow,
    input,
    executingUserId,
    streamConfig,
    createFilteredResult,
    executionId,
  } = options

  const { executeWorkflow, createFilteredResult: defaultFilteredResult } = await import(
    '@/app/api/workflows/[id]/execute/route'
  )
  const filterResultFn = createFilteredResult || defaultFilteredResult

  return new ReadableStream({
    async start(controller) {
      try {
        const streamedContent = new Map<string, string>()
        const processedOutputs = new Set<string>()
        const streamCompletionTimes = new Map<string, number>()

        const sendChunk = (blockId: string, content: string) => {
          const separator = processedOutputs.size > 0 ? '\n\n' : ''
          controller.enqueue(encodeSSE({ blockId, chunk: separator + content }))
          processedOutputs.add(blockId)
        }

        const onStreamCallback = async (streamingExec: {
          stream: ReadableStream
          execution?: { blockId?: string }
        }) => {
          const blockId = streamingExec.execution?.blockId || 'unknown'
          const reader = streamingExec.stream.getReader()
          const decoder = new TextDecoder()
          let isFirstChunk = true

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) {
                // Record when this stream completed
                streamCompletionTimes.set(blockId, Date.now())
                break
              }

              const textChunk = decoder.decode(value, { stream: true })
              streamedContent.set(blockId, (streamedContent.get(blockId) || '') + textChunk)

              if (isFirstChunk) {
                sendChunk(blockId, textChunk)
                isFirstChunk = false
              } else {
                controller.enqueue(encodeSSE({ blockId, chunk: textChunk }))
              }
            }
          } catch (streamError) {
            logger.error(`[${requestId}] Error reading agent stream:`, streamError)
            controller.enqueue(
              encodeSSE({
                event: 'stream_error',
                blockId,
                error: streamError instanceof Error ? streamError.message : 'Stream reading error',
              })
            )
          }
        }

        const onBlockCompleteCallback = async (blockId: string, output: any) => {
          if (!streamConfig.selectedOutputs?.length) return

          const { extractBlockIdFromOutputId, extractPathFromOutputId, traverseObjectPath } =
            await import('@/lib/response-format')

          const matchingOutputs = streamConfig.selectedOutputs.filter(
            (outputId) => extractBlockIdFromOutputId(outputId) === blockId
          )

          if (!matchingOutputs.length) return

          for (const outputId of matchingOutputs) {
            const path = extractPathFromOutputId(outputId, blockId)

            let outputValue = traverseObjectPath(output, path)
            if (outputValue === undefined && output.response) {
              outputValue = traverseObjectPath(output.response, path)
            }

            if (outputValue !== undefined) {
              const formattedOutput =
                typeof outputValue === 'string' ? outputValue : JSON.stringify(outputValue, null, 2)
              sendChunk(blockId, formattedOutput)
            }
          }
        }

        const result = await executeWorkflow(
          workflow,
          requestId,
          input,
          executingUserId,
          {
            enabled: true,
            selectedOutputs: streamConfig.selectedOutputs,
            isSecureMode: streamConfig.isSecureMode,
            workflowTriggerType: streamConfig.workflowTriggerType,
            onStream: onStreamCallback,
            onBlockComplete: onBlockCompleteCallback,
            skipLoggingComplete: true, // We'll complete logging after tokenization
          },
          executionId
        )

        if (result.logs && streamedContent.size > 0) {
          result.logs = result.logs.map((log: any) => {
            if (streamedContent.has(log.blockId)) {
              const content = streamedContent.get(log.blockId)

              // Update timing to reflect actual stream completion
              if (streamCompletionTimes.has(log.blockId)) {
                const completionTime = streamCompletionTimes.get(log.blockId)!
                const startTime = new Date(log.startedAt).getTime()
                log.endedAt = new Date(completionTime).toISOString()
                log.durationMs = completionTime - startTime
              }

              if (log.output && content) {
                return { ...log, output: { ...log.output, content } }
              }
            }
            return log
          })

          const { processStreamingBlockLogs } = await import('@/lib/tokenization')
          processStreamingBlockLogs(result.logs, streamedContent)
        }

        // Complete the logging session with updated trace spans that include cost data
        if (result._streamingMetadata?.loggingSession) {
          const { buildTraceSpans } = await import('@/lib/logs/execution/trace-spans/trace-spans')
          const { traceSpans, totalDuration } = buildTraceSpans(result)

          await result._streamingMetadata.loggingSession.safeComplete({
            endedAt: new Date().toISOString(),
            totalDurationMs: totalDuration || 0,
            finalOutput: result.output || {},
            traceSpans: (traceSpans || []) as any,
            workflowInput: result._streamingMetadata.processedInput,
          })

          result._streamingMetadata = undefined
        }

        // Create a minimal result with only selected outputs
        const minimalResult = {
          success: result.success,
          error: result.error,
          output: {} as any,
        }

        if (streamConfig.selectedOutputs?.length && result.output) {
          const { extractBlockIdFromOutputId, extractPathFromOutputId, traverseObjectPath } =
            await import('@/lib/response-format')

          for (const outputId of streamConfig.selectedOutputs) {
            const blockId = extractBlockIdFromOutputId(outputId)
            const path = extractPathFromOutputId(outputId, blockId)

            if (result.logs) {
              const blockLog = result.logs.find((log: any) => log.blockId === blockId)
              if (blockLog?.output) {
                let value = traverseObjectPath(blockLog.output, path)
                if (value === undefined && blockLog.output.response) {
                  value = traverseObjectPath(blockLog.output.response, path)
                }
                if (value !== undefined) {
                  const dangerousKeys = ['__proto__', 'constructor', 'prototype']
                  if (dangerousKeys.includes(blockId) || dangerousKeys.includes(path)) {
                    logger.warn(
                      `[${requestId}] Blocked potentially dangerous property assignment`,
                      {
                        blockId,
                        path,
                      }
                    )
                    continue
                  }

                  if (!minimalResult.output[blockId]) {
                    minimalResult.output[blockId] = Object.create(null)
                  }
                  minimalResult.output[blockId][path] = value
                }
              }
            }
          }
        } else if (!streamConfig.selectedOutputs?.length) {
          minimalResult.output = result.output
        }

        controller.enqueue(encodeSSE({ event: 'final', data: minimalResult }))
        controller.enqueue(encodeSSE('[DONE]'))
        controller.close()
      } catch (error: any) {
        logger.error(`[${requestId}] Stream error:`, error)
        controller.enqueue(
          encodeSSE({ event: 'error', error: error.message || 'Stream processing error' })
        )
        controller.close()
      }
    },
  })
}
