/**
 * Shared OpenAI Chat Completions streaming tool loop (Step 9).
 *
 * Capability-honest: reasoning deltas only when the vendor streams them.
 * Final-turn-only answer projection via `turn` tags. Tool ends in completion
 * order; abort → cancelled.
 *
 * Streams each model turn live (thinking + tool_call_start). Answer text is
 * buffered until the turn is classified intermediate vs final — same contract
 * as Anthropic/Gemini/Bedrock loops. Tool args are assembled from streamed
 * `tool_calls` deltas (no blocking hybrid).
 */

import type { Logger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import type OpenAI from 'openai'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { NormalizedBlockOutput } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import {
  createOpenAICompatibleAgentEventStream,
  type OpenAICompatAssembledToolCall,
} from '@/providers/openai-compat/stream-events'
import type { AgentStreamEvent, ToolCallEndStatus } from '@/providers/stream-events'
import type { ProviderRequest, TimeSegment } from '@/providers/types'
import {
  calculateCost,
  prepareToolExecution,
  sumToolCosts,
  trackForcedToolUsage,
} from '@/providers/utils'
import { executeTool } from '@/tools'

export interface OpenAICompatStreamingToolLoopComplete {
  content: string
  tokens: { input: number; output: number; total: number }
  cost: NormalizedBlockOutput['cost']
  toolCalls?: { list: unknown[]; count: number }
  modelTime: number
  toolsTime: number
  firstResponseTime: number
  iterations: number
}

export type OpenAICompatCreateCompletion = (
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
  options?: { signal?: AbortSignal }
) => Promise<AsyncIterable<ChatCompletionChunk>>

/** @deprecated Prefer streamed tool-arg assembly; retained for callers that still pass it. */
export type OpenAICompatCreateCompletionBlocking = (
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  options?: { signal?: AbortSignal }
) => Promise<OpenAI.Chat.Completions.ChatCompletion>

export interface CreateOpenAICompatStreamingToolLoopOptions {
  providerName: string
  request: ProviderRequest
  /** Base chat.completions payload (messages, tools, model, …) without stream. */
  basePayload: Record<string, unknown>
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  createStream: OpenAICompatCreateCompletion
  /** Ignored — tool args come from streamed deltas. Kept for call-site compatibility. */
  createBlocking?: OpenAICompatCreateCompletionBlocking
  logger: Logger
  timeSegments: TimeSegment[]
  forcedTools?: string[]
  /**
   * When true, keep vendor reasoning fields on assistant history messages
   * during the tool loop (required by DeepSeek thinking + tools).
   */
  preserveAssistantReasoning?: boolean
  onComplete: (result: OpenAICompatStreamingToolLoopComplete) => void
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: string }).name
  return name === 'AbortError' || name === 'APIUserAbortError'
}

function settleOpenTools(
  controller: ReadableStreamDefaultController<AgentStreamEvent>,
  openTools: Map<string, string>,
  status: ToolCallEndStatus
): void {
  for (const [id, name] of openTools) {
    controller.enqueue({ type: 'tool_call_end', id, name, status })
  }
  openTools.clear()
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
          let assembledTools: OpenAICompatAssembledToolCall[] = []
          const bufferedText: string[] = []

          const eventStream = createOpenAICompatibleAgentEventStream(stream, {
            providerName,
            emitToolCallStarts: true,
            bufferTextDeltas: true,
            onComplete: (result) => {
              turnUsage = {
                prompt_tokens: result.usage.prompt_tokens ?? 0,
                completion_tokens: result.usage.completion_tokens ?? 0,
                total_tokens: result.usage.total_tokens ?? 0,
              }
              turnContent = result.content || ''
              turnReasoningContent = result.reasoning_content || ''
              turnReasoning = result.reasoning || ''
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
                // Should not arrive when bufferTextDeltas is true; keep for safety.
                bufferedText.push(value.text)
              }
            }
          }

          const pendingTools = assembledTools.filter((tc) => tc.id && tc.function?.name)
          const turnTag = pendingTools.length > 0 ? 'intermediate' : 'final'
          const textToFlush = turnContent || bufferedText.join('')
          if (textToFlush) {
            controller.enqueue({ type: 'text_delta', text: textToFlush, turn: turnTag })
          }

          const modelEnd = Date.now()
          const thisModelTime = modelEnd - modelStart
          modelTime += thisModelTime
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
            content = textToFlush || content
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

          const assistantHistory: Record<string, unknown> = {
            role: 'assistant',
            content: textToFlush || null,
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
          currentMessages.push(
            assistantHistory as OpenAI.Chat.Completions.ChatCompletionMessageParam
          )

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
                  skipPostProcess: true,
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
          iterations: iterationCount + 1,
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
