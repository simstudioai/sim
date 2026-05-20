import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { createTimeoutAbortController, getTimeoutErrorMessage } from '@/lib/core/execution-limits'
import {
  extractBlockIdFromOutputId,
  extractPathFromOutputId,
  parseOutputContentSafely,
} from '@/lib/core/utils/response-format'
import { encodeSSE } from '@/lib/core/utils/sse'
import {
  getInlineJsonByteLength,
  materializeInlineExecutionValue,
} from '@/lib/execution/payloads/inline-materialization.server'
import {
  assertInlineMaterializationSize,
  type ExecutionMaterializationContext,
  MAX_INLINE_MATERIALIZATION_BYTES,
} from '@/lib/execution/payloads/materialization.server'
import { compactExecutionPayload } from '@/lib/execution/payloads/serializer'
import { isExecutionResourceLimitError } from '@/lib/execution/resource-errors'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { processStreamingBlockLogs } from '@/lib/tokenization'
import {
  cleanupExecutionBase64Cache,
  hydrateUserFilesWithBase64,
} from '@/lib/uploads/utils/user-file-base64.server'
import type { BlockLog, ExecutionResult, StreamingExecution } from '@/executor/types'
import { navigatePathAsync } from '@/executor/variables/resolvers/reference-async.server'

/**
 * Extended streaming execution type that includes blockId on the execution.
 * The runtime passes blockId but the base StreamingExecution type doesn't declare it.
 */
interface StreamingExecutionWithBlockId extends Omit<StreamingExecution, 'execution'> {
  execution?: StreamingExecution['execution'] & { blockId?: string }
}

const logger = createLogger('WorkflowStreaming')

const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype']
const SELECTED_OUTPUT_TOO_LARGE_MESSAGE =
  'Selected output is too large to inline; select a nested field or use pagination/preview.'

interface StreamingConfig {
  selectedOutputs?: string[]
  isSecureMode?: boolean
  workflowTriggerType?: 'api' | 'chat'
  includeFileBase64?: boolean
  base64MaxBytes?: number
  timeoutMs?: number
}

export type StreamingExecutorFn = (callbacks: {
  onStream: (streamingExec: StreamingExecution) => Promise<void>
  onBlockComplete: (blockId: string, output: unknown) => Promise<void>
  abortSignal: AbortSignal
}) => Promise<ExecutionResult>

export interface StreamingResponseOptions {
  requestId: string
  streamConfig: StreamingConfig
  executionId?: string
  largeValueExecutionIds?: string[]
  largeValueKeys?: string[]
  fileKeys?: string[]
  allowLargeValueWorkflowScope?: boolean
  workspaceId?: string
  workflowId?: string
  userId?: string
  executeFn: StreamingExecutorFn
}

interface StreamingState {
  streamedChunks: Map<string, string[]>
  processedOutputs: Set<string>
  streamCompletionTimes: Map<string, number>
  completedBlockIds: Set<string>
  selectedOutputBytes: number
  streamedSelectedOutputKeys: Set<string>
  selectedOutputError?: string
}

interface SelectedOutputDescriptor {
  outputId: string
  blockId: string
  path: string
  key: string
}

function resolveStreamedContent(state: StreamingState): Map<string, string> {
  const result = new Map<string, string>()
  for (const [blockId, chunks] of state.streamedChunks) {
    result.set(blockId, chunks.join(''))
  }
  return result
}

type OutputExtractionContext = Pick<
  StreamingResponseOptions,
  | 'requestId'
  | 'workspaceId'
  | 'workflowId'
  | 'executionId'
  | 'largeValueExecutionIds'
  | 'largeValueKeys'
  | 'fileKeys'
  | 'allowLargeValueWorkflowScope'
  | 'userId'
> & { base64MaxBytes?: number }

async function extractOutputValue(
  output: unknown,
  path: string,
  context: OutputExtractionContext
): Promise<unknown> {
  const parsedOutput = parseOutputContentSafely(output)
  const outputValue = path
    ? await navigatePathAsync(parsedOutput, path.split('.'), {
        executionContext: {
          workflowId: context.workflowId ?? '',
          workspaceId: context.workspaceId,
          executionId: context.executionId,
          largeValueExecutionIds: context.largeValueExecutionIds,
          largeValueKeys: context.largeValueKeys,
          fileKeys: context.fileKeys,
          allowLargeValueWorkflowScope: context.allowLargeValueWorkflowScope,
          userId: context.userId,
          metadata: { requestId: context.requestId },
          base64MaxBytes: context.base64MaxBytes,
        },
        allowLargeValueRefs: true,
      })
    : parsedOutput

  return outputValue
}

function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEYS.includes(key)
}

function getSelectedOutputDescriptors(
  selectedOutputs: string[] | undefined
): SelectedOutputDescriptor[] {
  const descriptors: SelectedOutputDescriptor[] = []
  const seen = new Set<string>()
  for (const outputId of selectedOutputs ?? []) {
    const blockId = extractBlockIdFromOutputId(outputId)
    const path = extractPathFromOutputId(outputId, blockId)
    const key = `${blockId}\u0000${path}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    descriptors.push({ outputId, blockId, path, key })
  }
  return descriptors
}

function getSelectedOutputErrorMessage(error: unknown): string {
  if (isExecutionResourceLimitError(error)) {
    return SELECTED_OUTPUT_TOO_LARGE_MESSAGE
  }
  return getErrorMessage(error, 'Selected output could not be materialized')
}

function buildMaterializationContext(
  context: Omit<OutputExtractionContext, 'requestId'>
): ExecutionMaterializationContext {
  return {
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    executionId: context.executionId,
    largeValueExecutionIds: context.largeValueExecutionIds,
    largeValueKeys: context.largeValueKeys,
    fileKeys: context.fileKeys,
    allowLargeValueWorkflowScope: context.allowLargeValueWorkflowScope,
    userId: context.userId,
  }
}

function getRemainingSelectedOutputBytes(usedBytes: number): number {
  return MAX_INLINE_MATERIALIZATION_BYTES - usedBytes
}

function getBase64DecodedByteBudget(remainingJsonBytes: number): number {
  return Math.max(0, Math.floor(((remainingJsonBytes - 2) * 3) / 4))
}

function assertSelectedOutputBytes(value: unknown): number {
  const bytes = getInlineJsonByteLength(value) ?? 0
  assertInlineMaterializationSize(bytes, MAX_INLINE_MATERIALIZATION_BYTES)
  return bytes
}

async function buildMinimalResult(
  result: ExecutionResult,
  selectedOutputs: string[] | undefined,
  streamedContent: Map<string, string>,
  completedBlockIds: Set<string>,
  streamedSelectedOutputKeys: Set<string>,
  requestId: string,
  includeFileBase64: boolean,
  base64MaxBytes: number | undefined,
  executionId?: string,
  context: Omit<OutputExtractionContext, 'executionId'> = { requestId }
): Promise<{ success: boolean; error?: string; output: Record<string, unknown> }> {
  const durableContext = {
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    executionId,
    userId: context.userId,
    requireDurable: Boolean(context.workspaceId && context.workflowId && executionId),
  }

  const minimalResult = {
    success: result.success,
    error: result.error,
    output: {} as Record<string, unknown>,
  }

  if (result.status === 'paused') {
    minimalResult.output = result.output || {}
    return compactExecutionPayload(minimalResult, {
      ...durableContext,
      preserveUserFileBase64: includeFileBase64,
      preserveRoot: true,
    })
  }

  if (!selectedOutputs?.length) {
    minimalResult.output = result.output || {}
    return compactExecutionPayload(minimalResult, {
      ...durableContext,
      preserveUserFileBase64: includeFileBase64,
      preserveRoot: true,
    })
  }

  if (!result.output || !result.logs) {
    return minimalResult
  }

  let selectedOutputBytes = assertSelectedOutputBytes(minimalResult.output)
  for (const descriptor of getSelectedOutputDescriptors(selectedOutputs)) {
    const { blockId, path } = descriptor

    if (streamedContent.has(blockId)) {
      continue
    }

    if (streamedSelectedOutputKeys.has(descriptor.key)) {
      continue
    }

    if (!completedBlockIds.has(blockId)) {
      continue
    }

    if (isDangerousKey(blockId)) {
      logger.warn(`[${requestId}] Blocked dangerous blockId: ${blockId}`)
      continue
    }

    if (isDangerousKey(path)) {
      logger.warn(`[${requestId}] Blocked dangerous path: ${path}`)
      continue
    }

    const blockLog = result.logs.find((log: BlockLog) => log.blockId === blockId)
    if (!blockLog?.output) {
      continue
    }

    const remainingBytes = getRemainingSelectedOutputBytes(selectedOutputBytes)
    const extractionContext = {
      ...context,
      executionId,
      base64MaxBytes: Math.min(
        base64MaxBytes ?? MAX_INLINE_MATERIALIZATION_BYTES,
        getBase64DecodedByteBudget(remainingBytes)
      ),
    }
    const value = await extractOutputValue(blockLog.output, path, extractionContext)
    if (value === undefined) {
      continue
    }
    const materializedValue = await materializeInlineExecutionValue(
      value,
      buildMaterializationContext(extractionContext),
      { maxBytes: remainingBytes }
    )

    if (!minimalResult.output[blockId]) {
      minimalResult.output[blockId] = Object.create(null) as Record<string, unknown>
    }
    ;(minimalResult.output[blockId] as Record<string, unknown>)[path] = materializedValue
    selectedOutputBytes = assertSelectedOutputBytes(minimalResult.output)
  }

  return minimalResult
}

function updateLogsWithStreamedContent(
  logs: BlockLog[],
  streamedContent: Map<string, string>,
  streamCompletionTimes: Map<string, number>
): BlockLog[] {
  return logs.map((log: BlockLog) => {
    if (!streamedContent.has(log.blockId)) {
      return log
    }

    const content = streamedContent.get(log.blockId)
    const updatedLog = { ...log }

    if (streamCompletionTimes.has(log.blockId)) {
      const completionTime = streamCompletionTimes.get(log.blockId)!
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
  const { requestId, streamConfig, executionId, executeFn } = options
  const durableContext = {
    workspaceId: options.workspaceId,
    workflowId: options.workflowId,
    executionId,
    userId: options.userId,
    requireDurable: Boolean(options.workspaceId && options.workflowId && executionId),
  }
  const timeoutController = createTimeoutAbortController(streamConfig.timeoutMs)

  return new ReadableStream({
    async start(controller) {
      const state: StreamingState = {
        streamedChunks: new Map(),
        processedOutputs: new Set(),
        streamCompletionTimes: new Map(),
        completedBlockIds: new Set(),
        selectedOutputBytes: 0,
        streamedSelectedOutputKeys: new Set(),
      }

      const sendChunk = (
        blockId: string,
        content: string,
        options: { selectedOutputKey?: string; selectedOutputBytes?: number } = {}
      ) => {
        const separator = state.processedOutputs.size > 0 ? '\n\n' : ''
        const chunk = separator + content
        if (options.selectedOutputKey) {
          const selectedOutputBytes =
            options.selectedOutputBytes ?? Buffer.byteLength(chunk, 'utf8')
          const nextSelectedOutputBytes = state.selectedOutputBytes + selectedOutputBytes
          assertInlineMaterializationSize(nextSelectedOutputBytes, MAX_INLINE_MATERIALIZATION_BYTES)
          state.selectedOutputBytes = nextSelectedOutputBytes
          state.streamedSelectedOutputKeys.add(options.selectedOutputKey)
        }
        controller.enqueue(encodeSSE({ blockId, chunk }))
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
            if (!state.streamedChunks.has(blockId)) {
              state.streamedChunks.set(blockId, [])
            }
            state.streamedChunks.get(blockId)!.push(textChunk)

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
              error: getErrorMessage(error, 'Stream reading error'),
            })
          )
        }
      }

      const includeFileBase64 = streamConfig.includeFileBase64 ?? true
      const base64MaxBytes = streamConfig.base64MaxBytes

      const onBlockCompleteCallback = async (blockId: string, output: unknown) => {
        state.completedBlockIds.add(blockId)

        if (!streamConfig.selectedOutputs?.length) {
          return
        }

        if (state.streamedChunks.has(blockId)) {
          return
        }

        const matchingOutputs = getSelectedOutputDescriptors(streamConfig.selectedOutputs).filter(
          (descriptor) => descriptor.blockId === blockId
        )

        for (const descriptor of matchingOutputs) {
          if (state.selectedOutputError) {
            break
          }
          try {
            const remainingBytes = getRemainingSelectedOutputBytes(state.selectedOutputBytes)
            const extractionContext = {
              requestId,
              workspaceId: options.workspaceId,
              workflowId: options.workflowId,
              executionId,
              largeValueExecutionIds: options.largeValueExecutionIds,
              largeValueKeys: options.largeValueKeys,
              fileKeys: options.fileKeys,
              allowLargeValueWorkflowScope: options.allowLargeValueWorkflowScope,
              userId: options.userId,
              base64MaxBytes: Math.min(
                base64MaxBytes ?? MAX_INLINE_MATERIALIZATION_BYTES,
                getBase64DecodedByteBudget(remainingBytes)
              ),
            }
            const materializationContext = buildMaterializationContext(extractionContext)
            const outputValue = await extractOutputValue(output, descriptor.path, extractionContext)

            if (outputValue !== undefined) {
              const materializedOutput = await materializeInlineExecutionValue(
                outputValue,
                materializationContext,
                { maxBytes: remainingBytes }
              )
              const shouldHydrateOutput = includeFileBase64
              const hydratedOutput = shouldHydrateOutput
                ? await hydrateUserFilesWithBase64(materializedOutput, {
                    requestId,
                    ...materializationContext,
                    maxBytes: Math.min(
                      base64MaxBytes ?? MAX_INLINE_MATERIALIZATION_BYTES,
                      getBase64DecodedByteBudget(remainingBytes)
                    ),
                    preserveLargeValueMetadata: true,
                  })
                : materializedOutput
              await materializeInlineExecutionValue(hydratedOutput, materializationContext, {
                maxBytes: getRemainingSelectedOutputBytes(state.selectedOutputBytes),
              })
              const formattedOutput =
                typeof hydratedOutput === 'string'
                  ? hydratedOutput
                  : JSON.stringify(hydratedOutput, null, 2)
              const selectedOutputBytes = Math.max(
                getInlineJsonByteLength(hydratedOutput) ?? 0,
                Buffer.byteLength(formattedOutput, 'utf8')
              )
              sendChunk(blockId, formattedOutput, {
                selectedOutputKey: descriptor.key,
                selectedOutputBytes,
              })
            }
          } catch (error) {
            logger.warn(`[${requestId}] Failed to materialize selected output`, {
              blockId,
              outputId: descriptor.outputId,
              error,
            })
            const errorMessage = getSelectedOutputErrorMessage(error)
            state.selectedOutputError ??= errorMessage
            controller.enqueue(
              encodeSSE({
                event: 'error',
                blockId,
                error: errorMessage,
              })
            )
            break
          }
        }
      }

      try {
        const result = await executeFn({
          onStream: onStreamCallback,
          onBlockComplete: onBlockCompleteCallback,
          abortSignal: timeoutController.signal,
        })

        const streamedContent =
          state.streamedChunks.size > 0 ? resolveStreamedContent(state) : new Map<string, string>()

        if (result.logs && streamedContent.size > 0) {
          result.logs = updateLogsWithStreamedContent(
            result.logs,
            streamedContent,
            state.streamCompletionTimes
          )
          processStreamingBlockLogs(result.logs, streamedContent)
        }

        if (
          result.status === 'cancelled' &&
          timeoutController.isTimedOut() &&
          timeoutController.timeoutMs
        ) {
          const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutController.timeoutMs)
          logger.info(`[${requestId}] Streaming execution timed out`, {
            timeoutMs: timeoutController.timeoutMs,
          })
          if (result._streamingMetadata?.loggingSession) {
            await result._streamingMetadata.loggingSession.markAsFailed(timeoutErrorMessage)
          }
          controller.enqueue(encodeSSE({ event: 'error', error: timeoutErrorMessage }))
        } else {
          await completeLoggingSession(result)

          if (!state.selectedOutputError) {
            const minimalResult = await buildMinimalResult(
              result,
              streamConfig.selectedOutputs,
              streamedContent,
              state.completedBlockIds,
              state.streamedSelectedOutputKeys,
              requestId,
              streamConfig.includeFileBase64 ?? true,
              streamConfig.base64MaxBytes,
              executionId,
              {
                requestId,
                workspaceId: options.workspaceId,
                workflowId: options.workflowId,
                largeValueExecutionIds: options.largeValueExecutionIds,
                largeValueKeys: result.metadata?.largeValueKeys ?? options.largeValueKeys,
                fileKeys: result.metadata?.fileKeys ?? options.fileKeys,
                allowLargeValueWorkflowScope: options.allowLargeValueWorkflowScope,
                userId: options.userId,
              }
            )

            controller.enqueue(
              encodeSSE({
                event: 'final',
                data: {
                  ...minimalResult,
                  ...(result.status === 'paused' && { status: 'paused' }),
                },
              })
            )
          }
        }

        controller.enqueue(encodeSSE('[DONE]'))

        if (executionId) {
          await cleanupExecutionBase64Cache(executionId)
        }

        controller.close()
      } catch (error) {
        logger.error(`[${requestId}] Stream error:`, error)
        const errorMessage =
          streamConfig.selectedOutputs?.length && isExecutionResourceLimitError(error)
            ? SELECTED_OUTPUT_TOO_LARGE_MESSAGE
            : getErrorMessage(error, 'Stream processing error')
        controller.enqueue(encodeSSE({ event: 'error', error: errorMessage }))

        if (executionId) {
          await cleanupExecutionBase64Cache(executionId)
        }

        controller.close()
      } finally {
        timeoutController.cleanup()
      }
    },
    async cancel(reason) {
      logger.info(`[${requestId}] Streaming response cancelled`, { reason })
      timeoutController.abort()
      timeoutController.cleanup()
      if (executionId) {
        try {
          await cleanupExecutionBase64Cache(executionId)
        } catch (error) {
          logger.error(`[${requestId}] Failed to cleanup base64 cache`, { error })
        }
      }
    },
  })
}
