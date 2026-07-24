/**
 * Shared OpenAI Chat Completions streaming tool loop.
 *
 * Capability-honest: reasoning deltas only when the vendor streams them.
 * Tool ends in completion order; abort → cancelled.
 *
 * Streams each model turn live (thinking + tool_call_start + `pending` text
 * deltas) and classifies the turn with a `turn_end` event — same contract as
 * the Anthropic/Gemini/Bedrock loops. The pump projects pending text to the
 * answer channel only for final turns. Tool args are assembled from streamed
 * `tool_calls` deltas (no blocking hybrid).
 */

import type { Logger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import type OpenAI from 'openai'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import {
  createOpenAICompatibleAgentEventStream,
  type OpenAICompatAssembledToolCall,
} from '@/providers/openai-compat/stream-events'
import type { OpenRouterReasoningDetail } from '@/providers/openrouter/reasoning'
import type { AgentStreamEvent, ToolCallEndStatus } from '@/providers/stream-events'
import {
  isAbortError,
  parseToolArguments,
  type StreamingToolLoopComplete,
  settleOpenTools,
} from '@/providers/streaming-tool-loop-shared'
import { enrichLastModelSegmentFromChatCompletions } from '@/providers/trace-enrichment'
import type { ProviderRequest, TimeSegment } from '@/providers/types'
import {
  calculateCost,
  prepareToolExecution,
  sumToolCosts,
  trackForcedToolUsage,
} from '@/providers/utils'
import { executeTool } from '@/tools'

export type OpenAICompatCreateCompletion = (
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
  options?: { signal?: AbortSignal }
) => Promise<AsyncIterable<ChatCompletionChunk>>

export interface CreateOpenAICompatStreamingToolLoopOptions {
  providerName: string
  request: ProviderRequest
  /** Base chat.completions payload (messages, tools, model, …) without stream. */
  basePayload: Record<string, unknown>
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  createStream: OpenAICompatCreateCompletion
  logger: Logger
  timeSegments: TimeSegment[]
  forcedTools?: string[]
  /**
   * When true, keep vendor reasoning fields on assistant history messages
   * during the tool loop (required by DeepSeek thinking + tools).
   */
  preserveAssistantReasoning?: boolean
  onComplete: (result: StreamingToolLoopComplete) => void
}

function nextForcedToolChoice(
  forcedTools: string[],
  usedForcedTools: string[]
): 'auto' | { type: 'function'; function: { name: string } } {
  const remaining = forcedTools.filter((tool) => !usedForcedTools.includes(tool))
  if (remaining.length === 0) return 'auto'
  return { type: 'function', function: { name: remaining[0] } }
}

/**
 * Multi-turn OpenAI-compat tool loop as an agent-events-v1 object stream.
 */
export function createOpenAICompatStreamingToolLoopStream(
  options: CreateOpenAICompatStreamingToolLoopOptions
): ReadableStream<AgentStreamEvent> {
  const {
    providerName,
    request,
    basePayload,
    messages,
    createStream,
    logger,
    timeSegments,
    onComplete,
    preserveAssistantReasoning = false,
  } = options
  const forcedTools = options.forcedTools ?? []
  const loopAbortController = new AbortController()
  const abortFromRequest = () => loopAbortController.abort(request.abortSignal?.reason)
  let activeEventReader: ReadableStreamDefaultReader<AgentStreamEvent> | undefined

  if (request.abortSignal?.aborted) {
    abortFromRequest()
  } else {
    request.abortSignal?.addEventListener('abort', abortFromRequest, { once: true })
  }

  return new ReadableStream<AgentStreamEvent>({
    async start(controller) {
      const currentMessages = [...messages]
      let content = ''
      let iterationCount = 0
      let modelCalls = 0
      let sawFinalTurn = false
      let modelTime = 0
      let toolsTime = 0
      let firstResponseTime = 0
      const tokens = { input: 0, output: 0, total: 0 }
      const toolCalls: unknown[] = []
      const toolResults: Record<string, unknown>[] = []
      const openToolStarts = new Map<string, string>()
      const streamOpts = { signal: loopAbortController.signal }

      let currentToolChoice = basePayload.tool_choice
      let usedForcedTools: string[] = []
      let hasUsedForcedTool = false
      const reportProgress = () => {
        const modelCost = calculateCost(request.model, tokens.input, tokens.output)
        const toolCost = sumToolCosts(toolResults)
        onComplete({
          content,
          tokens,
          cost: {
            input: modelCost.input,
            output: modelCost.output,
            total: modelCost.total + (toolCost || 0),
            ...(toolCost ? { toolCost } : {}),
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
            settleOpenTools(controller, openToolStarts, 'cancelled')
            throw new DOMException('Stream aborted', 'AbortError')
          }

          const modelStart = Date.now()
          const finalSynthesis = iterationCount >= MAX_TOOL_ITERATIONS
          const turnPayload = {
            ...basePayload,
            messages: currentMessages,
            ...(finalSynthesis
              ? { tools: undefined, tool_choice: 'none' }
              : currentToolChoice !== undefined
                ? { tool_choice: currentToolChoice }
                : {}),
            stream: true as const,
          }

          const stream = await createStream(
            turnPayload as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
            streamOpts
          )

          let turnUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
          let turnContent = ''
          let turnReasoningContent = ''
          let turnReasoning = ''
          let turnReasoningDetails: OpenRouterReasoningDetail[] | undefined
          let turnFinishReason: string | undefined
          let assembledTools: OpenAICompatAssembledToolCall[] = []
          const liveText: string[] = []
          let sawToolCallDelta = false
          const inspectedStream = (async function* () {
            for await (const chunk of stream) {
              if (
                chunk.choices.some(
                  (choice) =>
                    Array.isArray(choice.delta.tool_calls) && choice.delta.tool_calls.length > 0
                )
              ) {
                sawToolCallDelta = true
              }
              yield chunk
            }
          })()

          const eventStream = createOpenAICompatibleAgentEventStream(inspectedStream, {
            providerName,
            emitToolCallStarts: true,
            onComplete: (result) => {
              turnUsage = {
                prompt_tokens: result.usage.prompt_tokens ?? 0,
                completion_tokens: result.usage.completion_tokens ?? 0,
                total_tokens: result.usage.total_tokens ?? 0,
              }
              turnContent = result.content || ''
              turnReasoningContent = result.reasoning_content || ''
              turnReasoning = result.reasoning || ''
              turnReasoningDetails = result.reasoning_details
              turnFinishReason = result.finishReason
              assembledTools = result.toolCalls ?? []
            },
          })

          {
            const reader = eventStream.getReader()
            activeEventReader = reader
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (value.type === 'thinking_delta' || value.type === 'tool_call_start') {
                if (value.type === 'tool_call_start') {
                  openToolStarts.set(value.id, value.name)
                }
                controller.enqueue(value)
              } else if (value.type === 'text_delta') {
                liveText.push(value.text)
                // Live pending text: sinks render it now; the pump projects it
                // to the answer only when this turn's turn_end says 'final'.
                controller.enqueue({ type: 'text_delta', text: value.text, turn: 'pending' })
              }
            }
            activeEventReader = undefined
          }

          const assembledPendingTools = assembledTools.filter((tc) => tc.id && tc.function?.name)
          if (turnFinishReason === undefined) {
            settleOpenTools(controller, openToolStarts, 'error')
            throw new Error(`${providerName} stream ended without finish_reason`)
          }
          if (finalSynthesis && assembledPendingTools.length > 0) {
            settleOpenTools(controller, openToolStarts, 'error')
            throw new Error(`${providerName} returned tool calls during final synthesis`)
          }
          if (assembledPendingTools.length > 0 && turnFinishReason !== 'tool_calls') {
            settleOpenTools(controller, openToolStarts, 'error')
            throw new Error(
              `${providerName} returned tool calls with finish_reason ${turnFinishReason}`
            )
          }
          const cappedTextTurn =
            turnFinishReason === 'length' && !sawToolCallDelta && openToolStarts.size === 0
          if (
            assembledPendingTools.length === 0 &&
            turnFinishReason !== 'stop' &&
            !cappedTextTurn
          ) {
            logger.warn('Rejecting incomplete model turn', {
              finishReason: turnFinishReason,
            })
            throw new Error(`${providerName} stream ended with finish_reason ${turnFinishReason}`)
          }
          const pendingTools = assembledPendingTools
          const turnTag = pendingTools.length > 0 ? 'intermediate' : 'final'
          const turnText = turnContent || liveText.join('')
          // If the parser assembled text but we somehow missed deltas, still emit
          // it before the boundary so the turn_end classification covers it.
          if (turnText && liveText.length === 0) {
            controller.enqueue({ type: 'text_delta', text: turnText, turn: 'pending' })
          }
          controller.enqueue({ type: 'turn_end', turn: turnTag })
          content = turnText

          const modelEnd = Date.now()
          const thisModelTime = modelEnd - modelStart
          modelTime += thisModelTime
          modelCalls++
          if (iterationCount === 0) firstResponseTime = thisModelTime
          timeSegments.push({
            type: 'model',
            name: request.model,
            startTime: modelStart,
            endTime: modelEnd,
            duration: thisModelTime,
          })
          enrichLastModelSegmentFromChatCompletions(
            timeSegments,
            {
              choices: [
                {
                  message: {
                    content: turnText,
                    tool_calls: pendingTools,
                    ...(turnReasoningContent ? { reasoning_content: turnReasoningContent } : {}),
                    ...(turnReasoning ? { reasoning: turnReasoning } : {}),
                    ...(turnReasoningDetails?.length
                      ? { reasoning_details: turnReasoningDetails }
                      : {}),
                  },
                  finish_reason: turnFinishReason,
                },
              ],
              usage: turnUsage,
            },
            pendingTools,
            {
              model: request.model,
              provider: providerName.toLowerCase(),
            }
          )
          tokens.input += turnUsage.prompt_tokens
          tokens.output += turnUsage.completion_tokens
          tokens.total +=
            turnUsage.total_tokens || turnUsage.prompt_tokens + turnUsage.completion_tokens

          if (pendingTools.length === 0) {
            sawFinalTurn = true
            break
          }

          if (
            typeof currentToolChoice === 'object' &&
            currentToolChoice !== null &&
            pendingTools.length > 0
          ) {
            const tracked = trackForcedToolUsage(
              pendingTools,
              currentToolChoice,
              logger,
              providerName.toLowerCase(),
              forcedTools,
              usedForcedTools
            )
            hasUsedForcedTool = tracked.hasUsedForcedTool
            usedForcedTools = tracked.usedForcedTools
          }

          const assistantHistory: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam & {
            reasoning_content?: string
            reasoning?: string
            reasoning_details?: OpenRouterReasoningDetail[]
          } = {
            role: 'assistant',
            content: turnText,
            tool_calls: pendingTools,
          }
          if (preserveAssistantReasoning) {
            if (turnReasoningContent) {
              assistantHistory.reasoning_content = turnReasoningContent
            }
            if (turnReasoning) {
              assistantHistory.reasoning = turnReasoning
            }
          }
          if (turnReasoningDetails?.length) {
            assistantHistory.reasoning_details = turnReasoningDetails
          }
          currentMessages.push(assistantHistory)

          const toolsStartTime = Date.now()
          const orderedResults = await Promise.all(
            pendingTools.map(async (tc) => {
              const toolCallStartTime = Date.now()
              const toolName = tc.function.name
              const toolUseId = tc.id
              /**
               * Malformed argument JSON must not execute the tool — running it
               * with defaulted `{}` args could fire side effects with missing
               * parameters. Fail the call and let the model react to the error.
               */
              let toolArgs: Record<string, unknown>
              try {
                toolArgs = parseToolArguments(tc.function.arguments, toolName)
              } catch (error) {
                const endTime = Date.now()
                openToolStarts.delete(toolUseId)
                controller.enqueue({
                  type: 'tool_call_end',
                  id: toolUseId,
                  name: toolName,
                  status: 'error',
                })
                return {
                  toolUseId,
                  toolName,
                  toolArgs: {},
                  toolParams: {} as Record<string, unknown>,
                  result: {
                    success: false as const,
                    output: undefined,
                    error: getErrorMessage(error, `Invalid tool arguments for ${toolName}`),
                  },
                  startTime: toolCallStartTime,
                  endTime,
                  duration: endTime - toolCallStartTime,
                  status: 'error' as ToolCallEndStatus,
                }
              }

              try {
                if (loopAbortController.signal.aborted) {
                  throw new DOMException('Stream aborted', 'AbortError')
                }
                const tool = request.tools?.find((t) => t.id === toolName)
                if (!tool) {
                  const value = {
                    toolUseId,
                    toolName,
                    toolArgs,
                    toolParams: {} as Record<string, unknown>,
                    result: {
                      success: false as const,
                      output: undefined,
                      error: `Tool not found: ${toolName}`,
                    },
                    startTime: toolCallStartTime,
                    endTime: Date.now(),
                    duration: Date.now() - toolCallStartTime,
                    status: 'error' as ToolCallEndStatus,
                  }
                  openToolStarts.delete(toolUseId)
                  controller.enqueue({
                    type: 'tool_call_end',
                    id: toolUseId,
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
                const value = {
                  toolUseId,
                  toolName,
                  toolArgs,
                  toolParams,
                  result,
                  startTime: toolCallStartTime,
                  endTime: toolCallEndTime,
                  duration: toolCallEndTime - toolCallStartTime,
                  status: (result.success ? 'success' : 'error') as ToolCallEndStatus,
                }
                openToolStarts.delete(toolUseId)
                controller.enqueue({
                  type: 'tool_call_end',
                  id: toolUseId,
                  name: toolName,
                  status: value.status,
                })
                return value
              } catch (error) {
                const toolCallEndTime = Date.now()
                if (loopAbortController.signal.aborted) {
                  openToolStarts.delete(toolUseId)
                  controller.enqueue({
                    type: 'tool_call_end',
                    id: toolUseId,
                    name: toolName,
                    status: 'cancelled',
                  })
                  throw error
                }
                if (isAbortError(error)) {
                  openToolStarts.delete(toolUseId)
                  controller.enqueue({
                    type: 'tool_call_end',
                    id: toolUseId,
                    name: toolName,
                    status: 'error',
                  })
                  throw error
                }

                logger.error('Error processing tool call:', { error, toolName })
                const value = {
                  toolUseId,
                  toolName,
                  toolArgs,
                  toolParams: {} as Record<string, unknown>,
                  result: {
                    success: false as const,
                    output: undefined,
                    error: getErrorMessage(error, 'Tool execution failed'),
                  },
                  startTime: toolCallStartTime,
                  endTime: toolCallEndTime,
                  duration: toolCallEndTime - toolCallStartTime,
                  status: 'error' as ToolCallEndStatus,
                }
                openToolStarts.delete(toolUseId)
                controller.enqueue({
                  type: 'tool_call_end',
                  id: toolUseId,
                  name: toolName,
                  status: value.status,
                })
                return value
              }
            })
          )

          for (const value of orderedResults) {
            timeSegments.push({
              type: 'tool',
              name: value.toolName,
              startTime: value.startTime,
              endTime: value.endTime,
              duration: value.duration,
              toolCallId: value.toolUseId,
            })

            let resultContent: unknown
            if (value.result.success) {
              if (isRecordLike(value.result.output)) {
                toolResults.push(value.result.output)
              }
              resultContent = value.result.output ?? null
            } else {
              resultContent = {
                error: true,
                message: value.result.error || 'Tool execution failed',
                tool: value.toolName,
              }
            }

            toolCalls.push({
              name: value.toolName,
              arguments: value.toolParams,
              startTime: new Date(value.startTime).toISOString(),
              endTime: new Date(value.endTime).toISOString(),
              duration: value.duration,
              result: resultContent,
              success: value.result.success,
            })

            currentMessages.push({
              role: 'tool',
              tool_call_id: value.toolUseId,
              content: JSON.stringify(resultContent),
            })
          }

          toolsTime += Date.now() - toolsStartTime

          // Rotate / clear forced tool_choice so the model can answer after forced tools.
          if (typeof currentToolChoice === 'object' && currentToolChoice !== null) {
            if (hasUsedForcedTool && forcedTools.length > 0) {
              const next = nextForcedToolChoice(forcedTools, usedForcedTools)
              currentToolChoice = next
              if (next === 'auto') {
                logger.info('All forced tools have been used, switching to auto tool_choice')
              } else {
                logger.info(`Forcing next tool: ${next.function.name}`)
              }
            }
          }

          iterationCount++
        }

        if (!sawFinalTurn) {
          throw new Error(`${providerName} tool loop ended without a final response`)
        }

        reportProgress()
        controller.close()
      } catch (error) {
        reportProgress()
        const cancelled = loopAbortController.signal.aborted
        settleOpenTools(controller, openToolStarts, cancelled ? 'cancelled' : 'error')
        if (cancelled) {
          if (controller.desiredSize !== null) {
            controller.close()
          }
        } else {
          controller.error(toError(error))
        }
      } finally {
        activeEventReader = undefined
        request.abortSignal?.removeEventListener('abort', abortFromRequest)
      }
    },
    async cancel(reason) {
      loopAbortController.abort(reason)
      await activeEventReader?.cancel(reason)
      request.abortSignal?.removeEventListener('abort', abortFromRequest)
    },
  })
}
