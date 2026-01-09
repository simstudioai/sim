import { createLogger } from '@sim/logger'
import {
  extractBlockIdFromOutputId,
  extractPathFromOutputId,
  traverseObjectPath,
} from '@/lib/core/utils/response-format'
import { encodeSSE } from '@/lib/core/utils/sse'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { processStreamingBlockLogs } from '@/lib/tokenization'
import { executeWorkflow } from '@/lib/workflows/executor/execute-workflow'
import type { BlockLog, ExecutionResult, StreamingExecution } from '@/executor/types'

/**
 * Extended streaming execution type that includes blockId on the execution.
 * The runtime passes blockId but the base StreamingExecution type doesn't declare it.
 */
interface StreamingExecutionWithBlockId extends Omit<StreamingExecution, 'execution'> {
  execution?: StreamingExecution['execution'] & { blockId?: string }
}

const logger = createLogger('WorkflowStreaming')

const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype']

export interface StreamingConfig {
  selectedOutputs?: string[]
  isSecureMode?: boolean
  workflowTriggerType?: 'api' | 'chat'
}

export interface StreamingResponseOptions {
  requestId: string
  workflow: {
    id: string
    userId: string
    workspaceId?: string | null
    isDeployed?: boolean
    variables?: Record<string, unknown>
  }
  input: unknown
  executingUserId: string
  streamConfig: StreamingConfig
  executionId?: string
}

interface StreamingState {
  streamedContent: Map<string, string>
  processedOutputs: Set<string>
  streamCompletionTimes: Map<string, number>
}

function extractOutputValue(output: unknown, path: string): unknown {
  return traverseObjectPath(output, path)
}

function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEYS.includes(key)
}

function buildMinimalResult(
  result: ExecutionResult,
  selectedOutputs: string[] | undefined,
  streamedContent: Map<string, string>,
  requestId: string
): { success: boolean; error?: string; output: Record<string, unknown> } {
  const minimalResult = {
    success: result.success,
    error: result.error,
    output: {} as Record<string, unknown>,
  }

  if (!selectedOutputs?.length) {
    minimalResult.output = result.output || {}
    return minimalResult
  }

  if (!result.output || !result.logs) {
    return minimalResult
  }

  for (const outputId of selectedOutputs) {
    const blockId = extractBlockIdFromOutputId(outputId)

    if (streamedContent.has(blockId)) {
      continue
    }

    if (isDangerousKey(blockId)) {
      logger.warn(`[${requestId}] Blocked dangerous blockId: ${blockId}`)
      continue
    }

    const path = extractPathFromOutputId(outputId, blockId)
    if (isDangerousKey(path)) {
      logger.warn(`[${requestId}] Blocked dangerous path: ${path}`)
      continue
    }

    const blockLog = result.logs.find((log: BlockLog) => log.blockId === blockId)
    if (!blockLog?.output) {
      continue
    }

    const value = extractOutputValue(blockLog.output, path)
    if (value === undefined) {
      continue
    }

    if (!minimalResult.output[blockId]) {
      minimalResult.output[blockId] = Object.create(null) as Record<string, unknown>
    }
    ;(minimalResult.output[blockId] as Record<string, unknown>)[path] = value
  }

  return minimalResult
}

function updateLogsWithStreamedContent(logs: BlockLog[], state: StreamingState): BlockLog[] {
  return logs.map((log: BlockLog) => {
    if (!state.streamedContent.has(log.blockId)) {
      return log
    }

    const content = state.streamedContent.get(log.blockId)
    const updatedLog = { ...log }

    if (state.streamCompletionTimes.has(log.blockId)) {
      const completionTime = state.streamCompletionTimes.get(log.blockId)!
      const startTime = new Date(log.startedAt).getTime()
      updatedLog.endedAt = new Date(completionTime).toISOString()
      updatedLog.durationMs = completionTime - startTime
    }

    if (log.output && content) {
      updatedLog.output = { ...log.output, content }
    }

    return updatedLog
  })
}

async function completeLoggingSession(result: ExecutionResult): Promise<void> {
  if (!result._streamingMetadata?.loggingSession) {
    return
  }

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

export async function createStreamingResponse(
  options: StreamingResponseOptions
): Promise<ReadableStream> {
  const { requestId, workflow, input, executingUserId, streamConfig, executionId } = options

  return new ReadableStream({
    async start(controller) {
      const state: StreamingState = {
        streamedContent: new Map(),
        processedOutputs: new Set(),
        streamCompletionTimes: new Map(),
      }

      const sendChunk = (blockId: string, content: string) => {
        const separator = state.processedOutputs.size > 0 ? '\n\n' : ''
        controller.enqueue(encodeSSE({ blockId, chunk: separator + content }))
        state.processedOutputs.add(blockId)
      }

      /**
       * Callback for handling streaming execution events.
       */
      const onStreamCallback = async (streamingExec: StreamingExecutionWithBlockId) => {
        const blockId = streamingExec.execution?.blockId
        if (!blockId) {
          logger.warn(`[${requestId}] Streaming execution missing blockId`)
          return
        }

        const reader = streamingExec.stream.getReader()
        const decoder = new TextDecoder()
        let isFirstChunk = true

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              state.streamCompletionTimes.set(blockId, Date.now())
              break
            }

            const textChunk = decoder.decode(value, { stream: true })
            state.streamedContent.set(
              blockId,
              (state.streamedContent.get(blockId) || '') + textChunk
            )

            if (isFirstChunk) {
              sendChunk(blockId, textChunk)
              isFirstChunk = false
            } else {
              controller.enqueue(encodeSSE({ blockId, chunk: textChunk }))
            }
          }
        } catch (error) {
          logger.error(`[${requestId}] Error reading stream for block ${blockId}:`, error)
          controller.enqueue(
            encodeSSE({
              event: 'stream_error',
              blockId,
              error: error instanceof Error ? error.message : 'Stream reading error',
            })
          )
        }
      }

      const onBlockCompleteCallback = async (blockId: string, output: unknown) => {
        if (!streamConfig.selectedOutputs?.length) {
          return
        }

        if (state.streamedContent.has(blockId)) {
          return
        }

        const matchingOutputs = streamConfig.selectedOutputs.filter(
          (outputId) => extractBlockIdFromOutputId(outputId) === blockId
        )

        for (const outputId of matchingOutputs) {
          const path = extractPathFromOutputId(outputId, blockId)
          const outputValue = extractOutputValue(output, path)

          if (outputValue !== undefined) {
            const formattedOutput =
              typeof outputValue === 'string' ? outputValue : JSON.stringify(outputValue, null, 2)
            sendChunk(blockId, formattedOutput)
          }
        }
      }

      try {
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
            skipLoggingComplete: true,
          },
          executionId
        )

        if (result.logs && state.streamedContent.size > 0) {
          result.logs = updateLogsWithStreamedContent(result.logs, state)
          processStreamingBlockLogs(result.logs, state.streamedContent)
        }

        await completeLoggingSession(result)

        const minimalResult = buildMinimalResult(
          result,
          streamConfig.selectedOutputs,
          state.streamedContent,
          requestId
        )

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
