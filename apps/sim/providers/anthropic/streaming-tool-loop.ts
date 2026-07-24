/**
 * Live Anthropic streaming tool loop.
 *
 * Each model turn is streamed via `messages.stream` + `finalMessage()` so thinking
 * signatures round-trip correctly. Thinking, `tool_call_start`, and `pending`
 * text deltas emit live; a `turn_end` event classifies the turn as
 * `intermediate` (tool-use turns) or `final` so the pump projects only final
 * text to the answer channel. Tool ends emit in actual completion order; abort
 * settles in-flight tools as `cancelled`.
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { Logger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import type { IterationToolCall } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import {
  addAnthropicUsage,
  buildAnthropicUsageCost,
  buildAnthropicUsageTokens,
  createAnthropicUsageAccumulator,
} from '@/providers/anthropic/usage'
import { checkForForcedToolUsage } from '@/providers/anthropic/utils'
import type { AgentStreamEvent, ToolCallEndStatus } from '@/providers/stream-events'
import {
  isAbortError,
  type StreamingToolLoopComplete,
  settleOpenTools,
} from '@/providers/streaming-tool-loop-shared'
import { enrichLastModelSegment } from '@/providers/trace-enrichment'
import type { ProviderRequest, TimeSegment } from '@/providers/types'
import { prepareToolExecution, sumToolCosts } from '@/providers/utils'
import { executeTool } from '@/tools'

export type AnthropicStreamingToolLoopPayload = Anthropic.Messages.MessageStreamParams

type AnthropicStreamingToolLoopComplete = Omit<StreamingToolLoopComplete, 'tokens'> & {
  tokens: ReturnType<typeof buildAnthropicUsageTokens>
}

export interface CreateAnthropicStreamingToolLoopStreamOptions {
  anthropic: Anthropic
  payload: AnthropicStreamingToolLoopPayload
  request: ProviderRequest
  messages: Anthropic.Messages.MessageParam[]
  providerId: string
  logger: Logger
  /** Shared mutable segments; same array reference passed into createStreamingExecution. */
  timeSegments: TimeSegment[]
  /** Forced tool names from prepareToolsWithUsageControl (may be empty). */
  forcedTools?: string[]
  onComplete: (result: AnthropicStreamingToolLoopComplete) => void
}

function enrichModelSegment(
  timeSegments: TimeSegment[],
  response: Anthropic.Messages.Message,
  textContent: string,
  model: string,
  providerId: string
): void {
  const thinkingBlocks = response.content.filter(
    (item): item is Anthropic.Messages.ThinkingBlock | Anthropic.Messages.RedactedThinkingBlock =>
      item.type === 'thinking' || item.type === 'redacted_thinking'
  )
  const thinkingContent = thinkingBlocks
    .map((b) => (b.type === 'thinking' ? b.thinking : '[redacted]'))
    .join('\n\n')

  const toolUseBlocks = response.content.filter(
    (item): item is Anthropic.Messages.ToolUseBlock => item.type === 'tool_use'
  )
  const toolCalls: IterationToolCall[] = toolUseBlocks.map((t) => ({
    id: t.id,
    name: t.name,
    arguments:
      t.input && typeof t.input === 'object' && !Array.isArray(t.input)
        ? (t.input as Record<string, unknown>)
        : {},
  }))

  const usage = createAnthropicUsageAccumulator()
  addAnthropicUsage(usage, response.usage)
  const segmentTokens = buildAnthropicUsageTokens(usage)
  const segmentCost = buildAnthropicUsageCost(model, usage)

  enrichLastModelSegment(timeSegments, {
    assistantContent: textContent || undefined,
    thinkingContent: thinkingContent || undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason: response.stop_reason ?? undefined,
    tokens: segmentTokens,
    cost: {
      input: segmentCost.input,
      output: segmentCost.output,
      total: segmentCost.total,
    },
    provider: providerId,
  })
}

/**
 * Multi-turn Anthropic tool loop as an `agent-events-v1` object stream.
 */
export function createAnthropicStreamingToolLoopStream(
  options: CreateAnthropicStreamingToolLoopStreamOptions
): ReadableStream<AgentStreamEvent> {
  const { anthropic, payload, request, messages, providerId, logger, timeSegments, onComplete } =
    options
  const forcedToolNames = options.forcedTools ?? []
  const loopAbortController = new AbortController()
  const abortFromRequest = () => loopAbortController.abort(request.abortSignal?.reason)
  let activeMessageStream: { abort: () => void } | undefined

  if (request.abortSignal?.aborted) {
    abortFromRequest()
  } else {
    request.abortSignal?.addEventListener('abort', abortFromRequest, { once: true })
  }

  return new ReadableStream<AgentStreamEvent>({
    async start(controller) {
      const currentMessages = [...messages]
      const originalToolChoice = payload.tool_choice

      let usedForcedTools: string[] = []
      let hasUsedForcedTool = false
      let content = ''
      let iterationCount = 0
      let modelCalls = 0
      let sawFinalTurn = false
      let modelTime = 0
      let toolsTime = 0
      let firstResponseTime = 0
      const usage = createAnthropicUsageAccumulator()
      const toolCalls: unknown[] = []
      const toolResults: Record<string, unknown>[] = []
      /** Tools that received start but not yet end (abort settlement). */
      const openToolStarts = new Map<string, string>()

      const streamOptions = { signal: loopAbortController.signal }
      const reportProgress = () => {
        const tokens = buildAnthropicUsageTokens(usage)
        const toolCost = sumToolCosts(toolResults)
        onComplete({
          content,
          tokens,
          cost: buildAnthropicUsageCost(request.model, usage, toolCost),
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
            const abortErr = new DOMException('Stream aborted', 'AbortError')
            settleOpenTools(controller, openToolStarts, 'cancelled')
            throw abortErr
          }

          const turnPayload: AnthropicStreamingToolLoopPayload = {
            ...payload,
            messages: currentMessages,
          }
          const finalSynthesis = iterationCount >= MAX_TOOL_ITERATIONS
          // Streaming tool loop always streams each turn; never pass stream:true twice.
          ;(turnPayload as { stream?: boolean }).stream = undefined
          if (finalSynthesis) {
            turnPayload.tool_choice = { type: 'none' }
          }

          // Forced tool_choice vs thinking — same rules as silent loop.
          const thinkingEnabled = !!payload.thinking
          if (
            !finalSynthesis &&
            !thinkingEnabled &&
            typeof originalToolChoice === 'object' &&
            hasUsedForcedTool &&
            forcedToolNames.length > 0
          ) {
            const remainingTools = forcedToolNames.filter((tool) => !usedForcedTools.includes(tool))
            if (remainingTools.length > 0) {
              turnPayload.tool_choice = { type: 'tool', name: remainingTools[0] }
            } else {
              turnPayload.tool_choice = undefined
            }
          } else if (
            !finalSynthesis &&
            !thinkingEnabled &&
            hasUsedForcedTool &&
            typeof originalToolChoice === 'object'
          ) {
            turnPayload.tool_choice = undefined
          }

          const modelStart = Date.now()
          const messageStream = anthropic.messages.stream(turnPayload, streamOptions)
          activeMessageStream = messageStream

          const textChunks: string[] = []

          try {
            for await (const event of messageStream) {
              if (event.type === 'content_block_start') {
                const block = event.content_block
                if (block.type === 'tool_use' && block.id && block.name) {
                  openToolStarts.set(block.id, block.name)
                  controller.enqueue({
                    type: 'tool_call_start',
                    id: block.id,
                    name: block.name,
                  })
                }
                continue
              }
              if (event.type !== 'content_block_delta') {
                continue
              }
              const delta = event.delta
              if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
                controller.enqueue({ type: 'thinking_delta', text: delta.thinking })
                continue
              }
              if (delta.type === 'text_delta' && typeof delta.text === 'string') {
                textChunks.push(delta.text)
                // Live pending text: sinks render it now; the pump projects it
                // to the answer only when this turn's turn_end says 'final'.
                controller.enqueue({ type: 'text_delta', text: delta.text, turn: 'pending' })
              }
            }

            const finalMessage = await messageStream.finalMessage()
            activeMessageStream = undefined
            const modelEnd = Date.now()
            const thisModelTime = modelEnd - modelStart
            modelTime += thisModelTime
            modelCalls++
            if (iterationCount === 0) {
              firstResponseTime = thisModelTime
            }

            timeSegments.push({
              type: 'model',
              name: request.model,
              startTime: modelStart,
              endTime: modelEnd,
              duration: thisModelTime,
            })

            addAnthropicUsage(usage, finalMessage.usage)

            const textContent = finalMessage.content
              .filter((item): item is Anthropic.Messages.TextBlock => item.type === 'text')
              .map((item) => item.text)
              .join('\n')

            const toolUses = finalMessage.content.filter(
              (item): item is Anthropic.Messages.ToolUseBlock => item.type === 'tool_use'
            )
            /**
             * Only execute tools when the model actually stopped to call them.
             * On `max_tokens` / `malformed_tool_use` the assembled inputs are
             * truncated best-effort JSON — running tools on them would execute
             * with wrong or partial arguments.
             */
            const toolsExecutable = finalMessage.stop_reason === 'tool_use'
            if (toolUses.length > 0 && !toolsExecutable) {
              settleOpenTools(controller, openToolStarts, 'error')
              throw new Error(
                `Anthropic returned tool use with stop_reason ${finalMessage.stop_reason ?? 'missing'}`
              )
            }
            if (finalSynthesis && toolUses.length > 0) {
              settleOpenTools(controller, openToolStarts, 'error')
              throw new Error('Anthropic returned tool use during final synthesis')
            }
            const executableToolUses = toolsExecutable ? toolUses : []
            const cappedTextTurn =
              finalMessage.stop_reason === 'max_tokens' && openToolStarts.size === 0
            if (
              executableToolUses.length === 0 &&
              finalMessage.stop_reason !== 'end_turn' &&
              finalMessage.stop_reason !== 'stop_sequence' &&
              !cappedTextTurn
            ) {
              throw new Error(
                `Anthropic stream ended with stop_reason ${finalMessage.stop_reason ?? 'missing'}`
              )
            }

            const turnTag = executableToolUses.length > 0 ? 'intermediate' : 'final'
            // If the SDK assembled text but we somehow missed deltas, still emit it
            // before the boundary so the turn_end classification covers it.
            if (textChunks.length === 0 && textContent) {
              controller.enqueue({ type: 'text_delta', text: textContent, turn: 'pending' })
            }
            controller.enqueue({ type: 'turn_end', turn: turnTag })
            content = textChunks.length > 0 ? textChunks.join('') : textContent

            enrichModelSegment(timeSegments, finalMessage, textContent, request.model, providerId)

            const forcedCheck = checkForForcedToolUsage(
              finalMessage,
              turnPayload.tool_choice,
              forcedToolNames,
              usedForcedTools
            )
            if (forcedCheck) {
              hasUsedForcedTool = forcedCheck.hasUsedForcedTool
              usedForcedTools = forcedCheck.usedForcedTools
            }

            if (executableToolUses.length === 0) {
              sawFinalTurn = true
              break
            }

            const toolsStartTime = Date.now()

            // Emit ends in completion order; keep Promise.all result order (= start order) for history.
            const orderedResults = await Promise.all(
              executableToolUses.map(async (toolUse) => {
                const toolCallStartTime = Date.now()
                const toolName = toolUse.name
                const toolArgs = isRecordLike(toolUse.input) ? toolUse.input : undefined

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
                      toolUse,
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
                    openToolStarts.delete(toolUse.id)
                    controller.enqueue({
                      type: 'tool_call_end',
                      id: toolUse.id,
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
                    toolUse,
                    toolName,
                    toolArgs,
                    toolParams,
                    result,
                    startTime: toolCallStartTime,
                    endTime: toolCallEndTime,
                    duration: toolCallEndTime - toolCallStartTime,
                    status: (result.success ? 'success' : 'error') as ToolCallEndStatus,
                  }
                  openToolStarts.delete(toolUse.id)
                  controller.enqueue({
                    type: 'tool_call_end',
                    id: toolUse.id,
                    name: toolName,
                    status: value.status,
                  })
                  return value
                } catch (error) {
                  const toolCallEndTime = Date.now()
                  if (loopAbortController.signal.aborted) {
                    openToolStarts.delete(toolUse.id)
                    controller.enqueue({
                      type: 'tool_call_end',
                      id: toolUse.id,
                      name: toolName,
                      status: 'cancelled',
                    })
                    throw error
                  }
                  if (isAbortError(error)) {
                    openToolStarts.delete(toolUse.id)
                    controller.enqueue({
                      type: 'tool_call_end',
                      id: toolUse.id,
                      name: toolName,
                      status: 'error',
                    })
                    throw error
                  }

                  logger.error('Error processing tool call:', { error, toolName })
                  const value = {
                    toolUse,
                    toolName,
                    toolArgs: toolArgs ?? {},
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
                  openToolStarts.delete(toolUse.id)
                  controller.enqueue({
                    type: 'tool_call_end',
                    id: toolUse.id,
                    name: toolName,
                    status: value.status,
                  })
                  return value
                }
              })
            )

            const toolResultBlocks: Anthropic.Messages.ToolResultBlockParam[] = []

            for (const value of orderedResults) {
              const {
                toolUse,
                toolName,
                toolArgs,
                toolParams,
                result,
                startTime,
                endTime,
                duration,
              } = value

              timeSegments.push({
                type: 'tool',
                name: toolName,
                startTime,
                endTime,
                duration,
                toolCallId: toolUse.id,
              })

              let resultContent: unknown
              if (result.success) {
                if (isRecordLike(result.output)) {
                  toolResults.push(result.output)
                }
                resultContent = result.output ?? null
              } else {
                resultContent = {
                  error: true,
                  message: result.error || 'Tool execution failed',
                  tool: toolName,
                }
              }

              toolCalls.push({
                name: toolName,
                arguments: toolParams,
                startTime: new Date(startTime).toISOString(),
                endTime: new Date(endTime).toISOString(),
                duration,
                result: resultContent,
                success: result.success,
              })

              toolResultBlocks.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify(resultContent),
                is_error: !result.success,
              })
            }

            const assistantBlocks = finalMessage.content.filter(
              (
                item
              ): item is
                | Anthropic.Messages.TextBlock
                | Anthropic.Messages.ThinkingBlock
                | Anthropic.Messages.RedactedThinkingBlock
                | Anthropic.Messages.ToolUseBlock =>
                item.type === 'text' ||
                item.type === 'thinking' ||
                item.type === 'redacted_thinking' ||
                item.type === 'tool_use'
            )

            if (assistantBlocks.some((item) => item.type === 'tool_use')) {
              currentMessages.push({
                role: 'assistant',
                content: assistantBlocks,
              })
            }
            if (toolResultBlocks.length > 0) {
              currentMessages.push({
                role: 'user',
                content: toolResultBlocks as Anthropic.Messages.ContentBlockParam[],
              })
            }

            toolsTime += Date.now() - toolsStartTime
            iterationCount++

            if (loopAbortController.signal.aborted) {
              settleOpenTools(controller, openToolStarts, 'cancelled')
              throw new DOMException('Stream aborted', 'AbortError')
            }
          } catch (error) {
            settleOpenTools(
              controller,
              openToolStarts,
              loopAbortController.signal.aborted ? 'cancelled' : 'error'
            )
            throw error
          }
        }

        if (!sawFinalTurn) {
          throw new Error('Anthropic tool loop ended without a final response')
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
        activeMessageStream = undefined
        request.abortSignal?.removeEventListener('abort', abortFromRequest)
      }
    },
    cancel(reason) {
      loopAbortController.abort(reason)
      activeMessageStream?.abort()
      request.abortSignal?.removeEventListener('abort', abortFromRequest)
    },
  })
}
