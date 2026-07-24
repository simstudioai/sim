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
import type OpenAI from 'openai'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import {
  createOpenAICompatibleAgentEventStream,
  type OpenAICompatAssembledToolCall,
} from '@/providers/openai-compat/stream-events'
import type { AgentStreamEvent, ToolCallEndStatus } from '@/providers/stream-events'
import {
  isAbortError,
  type StreamingToolLoopComplete,
  settleOpenTools,
} from '@/providers/streaming-tool-loop-shared'
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
      const streamOpts = request.abortSignal ? { signal: request.abortSignal } : undefined

      let currentToolChoice = basePayload.tool_choice
      let usedForcedTools: string[] = []
      let hasUsedForcedTool = false

      try {
        while (iterationCount < MAX_TOOL_ITERATIONS) {
          if (request.abortSignal?.aborted) {
            settleOpenTools(controller, openToolStarts, 'cancelled')
            throw new DOMException('Stream aborted', 'AbortError')
          }

          const modelStart = Date.now()
          const turnPayload = {
            ...basePayload,
            messages: currentMessages,
            ...(currentToolChoice !== undefined ? { tool_choice: currentToolChoice } : {}),
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
          let turnFinishReason: string | undefined
          let assembledTools: OpenAICompatAssembledToolCall[] = []
          const liveText: string[] = []

          const eventStream = createOpenAICompatibleAgentEventStream(stream, {
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
              turnFinishReason = result.finishReason
              assembledTools = result.toolCalls ?? []
            },
          })

          {
            const reader = eventStream.getReader()
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
          }

          /**
           * Only execute tools when the turn completed normally. A `length`
           * finish means the stream truncated mid-generation — assembled tool
           * arguments would be partial JSON.
           */
          const toolsExecutable = turnFinishReason !== 'length'
          const assembledPendingTools = assembledTools.filter((tc) => tc.id && tc.function?.name)
          if (assembledPendingTools.length > 0 && !toolsExecutable) {
            logger.warn('Skipping tool execution for truncated turn', {
              finishReason: turnFinishReason,
              toolCount: assembledPendingTools.length,
            })
            settleOpenTools(controller, openToolStarts, 'error')
          }
          const pendingTools = toolsExecutable ? assembledPendingTools : []
          const turnTag = pendingTools.length > 0 ? 'intermediate' : 'final'
          const turnText = turnContent || liveText.join('')
          // If the parser assembled text but we somehow missed deltas, still emit
          // it before the boundary so the turn_end classification covers it.
          if (turnText && liveText.length === 0) {
            controller.enqueue({ type: 'text_delta', text: turnText, turn: 'pending' })
          }
          controller.enqueue({ type: 'turn_end', turn: turnTag })
          if (turnText) {
            // Keep the latest turn's text so a MAX_TOOL_ITERATIONS exit still has content.
            content = turnText
          }

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
          } = {
            role: 'assistant',
            content: turnText || null,
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
          currentMessages.push(assistantHistory)

          const toolsStartTime = Date.now()
          const orderedResults = await Promise.all(
            pendingTools.map(async (tc) => {
              const toolCallStartTime = Date.now()
              const toolName = tc.function.name
              const toolUseId = tc.id
              let toolArgs: Record<string, unknown> = {}
              try {
                toolArgs = JSON.parse(tc.function.arguments || '{}')
              } catch {
                toolArgs = {}
              }

              try {
                if (request.abortSignal?.aborted) {
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
                  signal: request.abortSignal,
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
                const cancelled = isAbortError(error) || !!request.abortSignal?.aborted
                if (!cancelled) {
                  logger.error('Error processing tool call:', { error, toolName })
                }
                const toolCallEndTime = Date.now()
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
                  status: (cancelled ? 'cancelled' : 'error') as ToolCallEndStatus,
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
            if (value.result.success && value.result.output) {
              toolResults.push(value.result.output as Record<string, unknown>)
              resultContent = value.result.output
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

        /**
         * MAX_TOOL_ITERATIONS exit: every turn was tagged intermediate, so the
         * answer channel would otherwise be empty. Flush the last turn's text
         * as the final answer so legacy consumers still receive content.
         */
        if (!sawFinalTurn && content) {
          controller.enqueue({ type: 'text_delta', text: content, turn: 'final' })
        }

        const modelCost = calculateCost(request.model, tokens.input, tokens.output)
        const toolCostTotal = sumToolCosts(toolResults)
        onComplete({
          content,
          tokens,
          cost: {
            input: modelCost.input,
            output: modelCost.output,
            total: modelCost.total + (toolCostTotal || 0),
            ...(toolCostTotal ? { toolCost: toolCostTotal } : {}),
          },
          toolCalls:
            toolCalls.length > 0 ? { list: toolCalls, count: toolCalls.length } : undefined,
          modelTime,
          toolsTime,
          firstResponseTime,
          iterations: modelCalls,
        })
        controller.close()
      } catch (error) {
        const cancelled = isAbortError(error) || !!request.abortSignal?.aborted
        settleOpenTools(controller, openToolStarts, cancelled ? 'cancelled' : 'error')
        controller.error(toError(error))
      }
    },
  })
}
