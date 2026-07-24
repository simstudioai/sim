/**
 * Live Gemini streaming tool loop.
 *
 * Each model turn uses generateContentStream. Thought parts → thinking_delta
 * live; functionCall parts → tool_call_start (with local ids when the model
 * omits them); text parts → `pending` text deltas live, classified by a
 * `turn_end` event as intermediate vs final. Tool ends emit in completion
 * order; abort → cancelled.
 *
 * Function-call parts are echoed back into request history verbatim — Google
 * requires signatures/ids to round-trip exactly as received, so local ids are
 * used only for agent events and trace segments, never injected into history.
 */

import {
  type Content,
  FunctionCallingConfigMode,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type GoogleGenAI,
  type Part,
  type Schema,
  type ToolConfig,
} from '@google/genai'
import type { Logger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import type { IterationToolCall } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import {
  checkForForcedToolUsage,
  cleanSchemaForGemini,
  convertUsageMetadata,
  ensureStructResponse,
} from '@/providers/google/utils'
import type { AgentStreamEvent, ToolCallEndStatus } from '@/providers/stream-events'
import {
  isAbortError,
  type StreamingToolLoopComplete,
  settleOpenTools,
} from '@/providers/streaming-tool-loop-shared'
import { ensureToolCallId } from '@/providers/tool-call-id'
import { enrichLastModelSegment } from '@/providers/trace-enrichment'
import type { ProviderRequest, TimeSegment } from '@/providers/types'
import {
  calculateCost,
  isGemini3Model,
  prepareToolExecution,
  sumToolCosts,
} from '@/providers/utils'
import { executeTool } from '@/tools'
import type { GeminiUsage } from './types'

export interface CreateGeminiStreamingToolLoopStreamOptions {
  ai: GoogleGenAI
  model: string
  baseConfig: GenerateContentConfig
  contents: Content[]
  request: ProviderRequest
  logger: Logger
  timeSegments: TimeSegment[]
  forcedTools?: string[]
  toolConfig?: ToolConfig
  onComplete: (result: StreamingToolLoopComplete) => void
}

/**
 * A streamed functionCall part paired with the execution-local id used on the
 * agent-events stream. The part itself stays verbatim for history echo.
 */
interface StreamedFunctionCall {
  part: Part
  localId: string
}

function buildNextConfig(
  baseConfig: GenerateContentConfig,
  currentToolConfig: ToolConfig | undefined,
  usedForcedTools: string[],
  forcedTools: string[],
  request: ProviderRequest,
  logger: Logger,
  model: string
): GenerateContentConfig {
  const nextConfig = { ...baseConfig }
  const allForcedToolsUsed = forcedTools.length > 0 && usedForcedTools.length === forcedTools.length

  if (allForcedToolsUsed && request.responseFormat) {
    nextConfig.tools = undefined
    nextConfig.toolConfig = undefined
    if (isGemini3Model(model)) {
      logger.info('Gemini 3: Stripping tools after forced tool execution, schema already set')
    } else {
      nextConfig.responseMimeType = 'application/json'
      nextConfig.responseSchema = cleanSchemaForGemini(request.responseFormat.schema) as Schema
      logger.info('Using structured output for final response after tool execution')
    }
  } else if (currentToolConfig) {
    nextConfig.toolConfig = currentToolConfig
  } else {
    nextConfig.toolConfig = { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } }
  }

  return nextConfig
}

/**
 * Drain one generateContentStream turn into live agent events + aggregated parts.
 */
async function drainGeminiTurn(
  stream: AsyncGenerator<GenerateContentResponse>,
  controller: ReadableStreamDefaultController<AgentStreamEvent>,
  openTools: Map<string, string>,
  onIteratorChange: (
    iterator: AsyncIterator<GenerateContentResponse> | undefined
  ) => void = () => {}
): Promise<{
  text: string
  thinking: string
  functionCalls: StreamedFunctionCall[]
  hasFunctionCallPart: boolean
  usage: GeminiUsage
  finishReason?: string
}> {
  let text = ''
  let thinking = ''
  const functionCalls: StreamedFunctionCall[] = []
  let hasFunctionCallPart = false
  const seenKeys = new Set<string>()
  let usage: GeminiUsage = { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 }
  let finishReason: string | undefined

  const iterator = stream[Symbol.asyncIterator]()
  onIteratorChange(iterator)
  try {
    while (true) {
      const next = await iterator.next()
      if (next.done) break
      const chunk = next.value
      if (chunk.promptFeedback?.blockReason) {
        throw new Error(
          `Gemini prompt blocked: ${chunk.promptFeedback.blockReason}${
            chunk.promptFeedback.blockReasonMessage
              ? ` (${chunk.promptFeedback.blockReasonMessage})`
              : ''
          }`
        )
      }
      if (chunk.usageMetadata) {
        usage = convertUsageMetadata(chunk.usageMetadata)
      }

      const candidate = chunk.candidates?.[0]
      if (candidate?.finishReason) {
        finishReason = String(candidate.finishReason)
      }

      const parts = candidate?.content?.parts
      if (!Array.isArray(parts)) {
        const fallback = chunk.text
        if (fallback) {
          text += fallback
          controller.enqueue({ type: 'text_delta', text: fallback, turn: 'pending' })
        }
        continue
      }

      for (const part of parts) {
        if (part.functionCall) {
          hasFunctionCallPart = true
          const localId = ensureToolCallId(part.functionCall.id, 'gemini')
          const name = part.functionCall.name ?? ''
          if (!seenKeys.has(localId) && name) {
            seenKeys.add(localId)
            functionCalls.push({ part, localId })
            if (!openTools.has(localId)) {
              openTools.set(localId, name)
              controller.enqueue({ type: 'tool_call_start', id: localId, name })
            }
          }
          continue
        }

        if (!part.text) continue
        if (part.thought === true) {
          thinking += part.text
          controller.enqueue({ type: 'thinking_delta', text: part.text })
        } else {
          text += part.text
          // Live pending text: sinks render it now; the pump projects it to the
          // answer only when this turn's turn_end says 'final'.
          controller.enqueue({ type: 'text_delta', text: part.text, turn: 'pending' })
        }
      }
    }
  } finally {
    onIteratorChange(undefined)
  }

  return { text, thinking, functionCalls, hasFunctionCallPart, usage, finishReason }
}

/**
 * Multi-turn Gemini tool loop as an agent-events-v1 object stream.
 */
export function createGeminiStreamingToolLoopStream(
  options: CreateGeminiStreamingToolLoopStreamOptions
): ReadableStream<AgentStreamEvent> {
  const {
    ai,
    model,
    baseConfig,
    contents: initialContents,
    request,
    logger,
    timeSegments,
    onComplete,
  } = options
  const forcedTools = options.forcedTools ?? []
  const loopAbortController = new AbortController()
  const abortFromRequest = () => loopAbortController.abort(request.abortSignal?.reason)
  let activeStreamIterator: AsyncIterator<GenerateContentResponse> | undefined
  let consumerCancelled = false

  if (request.abortSignal?.aborted) {
    abortFromRequest()
  } else {
    request.abortSignal?.addEventListener('abort', abortFromRequest, { once: true })
  }

  return new ReadableStream<AgentStreamEvent>({
    start(controller) {
      void (async () => {
        let contents = [...initialContents]
        let currentToolConfig = options.toolConfig
        let usedForcedTools: string[] = []

        let content = ''
        let iterationCount = 0
        let modelCalls = 0
        let sawFinalTurn = false
        let modelTime = 0
        let toolsTime = 0
        let firstResponseTime = 0
        const tokens = { input: 0, output: 0, total: 0 }
        let costInput = 0
        let costOutput = 0
        let costTotal = 0
        let latestPricing: ReturnType<typeof calculateCost>['pricing'] | undefined
        const toolCalls: unknown[] = []
        const toolResults: Record<string, unknown>[] = []
        const openToolStarts = new Map<string, string>()
        const reportProgress = () => {
          const toolCost = sumToolCosts(toolResults)
          onComplete({
            content,
            tokens,
            cost: {
              input: costInput,
              output: costOutput,
              toolCost: toolCost || undefined,
              total: costTotal + toolCost,
              pricing: latestPricing,
            },
            toolCalls:
              toolCalls.length > 0 ? { list: toolCalls, count: toolCalls.length } : undefined,
            modelTime,
            toolsTime,
            firstResponseTime,
            iterations: modelCalls,
          })
        }

        try {
          while (modelCalls <= MAX_TOOL_ITERATIONS) {
            if (loopAbortController.signal.aborted) {
              if (!consumerCancelled) {
                settleOpenTools(controller, openToolStarts, 'cancelled')
              }
              throw new DOMException('Stream aborted', 'AbortError')
            }

            const finalSynthesis = iterationCount >= MAX_TOOL_ITERATIONS
            const turnConfig = finalSynthesis
              ? { ...baseConfig, tools: undefined, toolConfig: undefined }
              : buildNextConfig(
                  baseConfig,
                  currentToolConfig,
                  usedForcedTools,
                  forcedTools,
                  request,
                  logger,
                  model
                )

            const modelStart = Date.now()
            const streamGenerator = await ai.models.generateContentStream({
              model,
              contents,
              config: {
                ...turnConfig,
                abortSignal: loopAbortController.signal,
              },
            })

            const drained = await drainGeminiTurn(
              streamGenerator,
              controller,
              openToolStarts,
              (iterator) => {
                activeStreamIterator = iterator
              }
            )
            const modelEnd = Date.now()
            const thisModelTime = modelEnd - modelStart
            modelTime += thisModelTime
            modelCalls++
            if (iterationCount === 0) {
              firstResponseTime = thisModelTime
            }

            timeSegments.push({
              type: 'model',
              name: model,
              startTime: modelStart,
              endTime: modelEnd,
              duration: thisModelTime,
            })

            tokens.input += drained.usage.promptTokenCount
            tokens.output += drained.usage.candidatesTokenCount
            tokens.total += drained.usage.totalTokenCount

            const turnCost = calculateCost(
              model,
              drained.usage.promptTokenCount,
              drained.usage.candidatesTokenCount
            )
            costInput += turnCost.input
            costOutput += turnCost.output
            costTotal += turnCost.total
            latestPricing = turnCost.pricing

            const isCompleteTurn =
              drained.finishReason === 'STOP' ||
              (drained.finishReason === 'MAX_TOKENS' &&
                Boolean(drained.text) &&
                !drained.hasFunctionCallPart)
            if (!isCompleteTurn) {
              settleOpenTools(controller, openToolStarts, 'error')
              throw new Error(
                `Gemini stream ended with finish reason ${drained.finishReason ?? 'missing'}`
              )
            }
            if (finalSynthesis && drained.functionCalls.length > 0) {
              settleOpenTools(controller, openToolStarts, 'error')
              throw new Error('Gemini returned function calls during final synthesis')
            }

            const turnTag = drained.functionCalls.length > 0 ? 'intermediate' : 'final'
            controller.enqueue({ type: 'turn_end', turn: turnTag })
            content = drained.text

            const toolCallsForEnrich: IterationToolCall[] = drained.functionCalls
              .filter((fc) => Boolean(fc.part.functionCall))
              .map((fc) => ({
                id: fc.localId,
                name: fc.part.functionCall?.name ?? '',
                arguments: (fc.part.functionCall?.args ?? {}) as Record<string, unknown>,
              }))

            enrichLastModelSegment(timeSegments, {
              assistantContent: drained.text || undefined,
              thinkingContent: drained.thinking || undefined,
              toolCalls: toolCallsForEnrich.length > 0 ? toolCallsForEnrich : undefined,
              finishReason: drained.finishReason,
              tokens: {
                input: drained.usage.promptTokenCount,
                output: drained.usage.candidatesTokenCount,
                total: drained.usage.totalTokenCount,
              },
              cost: {
                input: turnCost.input,
                output: turnCost.output,
                total: turnCost.total,
              },
              provider: 'google',
            })

            const forcedCheck = checkForForcedToolUsage(
              drained.functionCalls
                .map((fc) => fc.part.functionCall)
                .filter((fc): fc is NonNullable<typeof fc> => Boolean(fc)),
              currentToolConfig,
              forcedTools,
              usedForcedTools
            )
            if (forcedCheck) {
              usedForcedTools = forcedCheck.usedForcedTools
              currentToolConfig = forcedCheck.nextToolConfig
            }

            if (drained.functionCalls.length === 0) {
              sawFinalTurn = true
              break
            }

            const toolsStartTime = Date.now()

            const orderedResults = await Promise.all(
              drained.functionCalls.map(async ({ part, localId }) => {
                const functionCall = part.functionCall!
                const toolCallId = localId
                const toolName = functionCall.name ?? ''
                const toolArgs = isRecordLike(functionCall.args) ? functionCall.args : undefined
                const toolCallStartTime = Date.now()

                try {
                  if (loopAbortController.signal.aborted) {
                    throw new DOMException('Stream aborted', 'AbortError')
                  }
                  if (!toolArgs) {
                    throw new Error(`Arguments for tool "${toolName}" must be an object`)
                  }

                  const tool = request.tools?.find((t) => t.id === toolName)
                  if (!tool) {
                    const value = {
                      part,
                      toolCallId,
                      toolName,
                      toolArgs,
                      toolParams: {} as Record<string, unknown>,
                      resultContent: {
                        error: true,
                        message: `Tool ${toolName} not found`,
                        tool: toolName,
                      },
                      result: undefined as
                        | { success: boolean; output?: unknown; error?: string }
                        | undefined,
                      startTime: toolCallStartTime,
                      endTime: Date.now(),
                      duration: Date.now() - toolCallStartTime,
                      status: 'error' as ToolCallEndStatus,
                      success: false,
                    }
                    openToolStarts.delete(toolCallId)
                    controller.enqueue({
                      type: 'tool_call_end',
                      id: toolCallId,
                      name: toolName,
                      status: 'error',
                    })
                    return value
                  }

                  const { toolParams, executionParams } = prepareToolExecution(
                    tool,
                    toolArgs,
                    request
                  )
                  const result = await executeTool(toolName, executionParams, {
                    signal: loopAbortController.signal,
                  })
                  const toolCallEndTime = Date.now()
                  const resultContent: Record<string, unknown> = result.success
                    ? ensureStructResponse(result.output)
                    : {
                        error: true,
                        message: result.error || 'Tool execution failed',
                        tool: toolName,
                      }
                  const status: ToolCallEndStatus = result.success ? 'success' : 'error'
                  openToolStarts.delete(toolCallId)
                  controller.enqueue({
                    type: 'tool_call_end',
                    id: toolCallId,
                    name: toolName,
                    status,
                  })
                  return {
                    part,
                    toolCallId,
                    toolName,
                    toolArgs,
                    toolParams,
                    resultContent,
                    result,
                    startTime: toolCallStartTime,
                    endTime: toolCallEndTime,
                    duration: toolCallEndTime - toolCallStartTime,
                    status,
                    success: result.success,
                  }
                } catch (error) {
                  const toolCallEndTime = Date.now()
                  if (loopAbortController.signal.aborted) {
                    openToolStarts.delete(toolCallId)
                    if (!consumerCancelled) {
                      controller.enqueue({
                        type: 'tool_call_end',
                        id: toolCallId,
                        name: toolName,
                        status: 'cancelled',
                      })
                    }
                    throw error
                  }
                  if (isAbortError(error)) {
                    openToolStarts.delete(toolCallId)
                    controller.enqueue({
                      type: 'tool_call_end',
                      id: toolCallId,
                      name: toolName,
                      status: 'error',
                    })
                    throw error
                  }

                  logger.error('Error processing function call:', {
                    error: toError(error).message,
                    functionName: toolName,
                  })
                  const status: ToolCallEndStatus = 'error'
                  openToolStarts.delete(toolCallId)
                  controller.enqueue({
                    type: 'tool_call_end',
                    id: toolCallId,
                    name: toolName,
                    status,
                  })
                  return {
                    part,
                    toolCallId,
                    toolName,
                    toolArgs: toolArgs ?? {},
                    toolParams: {} as Record<string, unknown>,
                    resultContent: {
                      error: true,
                      message: getErrorMessage(error, 'Tool execution failed'),
                      tool: toolName,
                    },
                    result: undefined,
                    startTime: toolCallStartTime,
                    endTime: toolCallEndTime,
                    duration: toolCallEndTime - toolCallStartTime,
                    status,
                    success: false,
                  }
                }
              })
            )

            toolsTime += Date.now() - toolsStartTime

            /**
             * Echo the model's functionCall parts verbatim (signatures and any
             * model-provided ids must round-trip untouched). A functionResponse
             * id is attached only when the model itself provided one.
             */
            const modelParts: Part[] = orderedResults.map((r) => r.part)
            const userParts: Part[] = orderedResults.map((r) => ({
              functionResponse: {
                name: r.toolName,
                response: r.resultContent,
                ...(r.part.functionCall?.id ? { id: r.part.functionCall.id } : {}),
              },
            }))

            contents = [
              ...contents,
              { role: 'model', parts: modelParts },
              { role: 'user', parts: userParts },
            ]

            for (const r of orderedResults) {
              toolCalls.push({
                name: r.toolName,
                arguments: r.toolParams,
                startTime: new Date(r.startTime).toISOString(),
                endTime: new Date(r.endTime).toISOString(),
                duration: r.duration,
                result: r.resultContent,
                success: r.success,
              })
              if (
                r.success &&
                r.result?.output &&
                typeof r.result.output === 'object' &&
                !Array.isArray(r.result.output)
              ) {
                toolResults.push(r.result.output as Record<string, unknown>)
              }
              timeSegments.push({
                type: 'tool',
                name: r.toolName,
                startTime: r.startTime,
                endTime: r.endTime,
                duration: r.duration,
                toolCallId: r.toolCallId,
              })
            }

            iterationCount += 1
          }

          if (!sawFinalTurn) {
            throw new Error('Gemini tool loop ended without a final response')
          }

          reportProgress()
          controller.close()
        } catch (error) {
          reportProgress()
          if (loopAbortController.signal.aborted) {
            if (!consumerCancelled) {
              settleOpenTools(controller, openToolStarts, 'cancelled')
              controller.close()
            }
          } else {
            settleOpenTools(controller, openToolStarts, 'error')
            logger.error('Gemini streaming tool loop failed', {
              error: toError(error).message,
            })
            controller.error(error)
          }
        } finally {
          activeStreamIterator = undefined
          request.abortSignal?.removeEventListener('abort', abortFromRequest)
        }
      })()
    },
    async cancel(reason) {
      consumerCancelled = true
      loopAbortController.abort(reason)
      await activeStreamIterator?.return?.()
      request.abortSignal?.removeEventListener('abort', abortFromRequest)
    },
  })
}
