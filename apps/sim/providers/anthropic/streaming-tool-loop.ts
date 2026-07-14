/**
 * Live Anthropic streaming tool loop (Step 7).
 *
 * Each model turn is streamed via `messages.stream` + `finalMessage()` so thinking
 * signatures round-trip correctly. Thinking and `tool_call_start` emit live;
 * text is buffered until the turn completes so it can be tagged
 * `intermediate` (tool-use turns) or `final` (answer channel / SSE `chunk`).
 * Tool ends emit in actual completion order; abort settles in-flight tools as
 * `cancelled`.
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { Logger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import type { BlockTokens, IterationToolCall, NormalizedBlockOutput } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { checkForForcedToolUsage } from '@/providers/anthropic/utils'
import type { AgentStreamEvent, ToolCallEndStatus } from '@/providers/stream-events'
import { enrichLastModelSegment } from '@/providers/trace-enrichment'
import type { ProviderRequest, TimeSegment } from '@/providers/types'
import { calculateCost, prepareToolExecution, sumToolCosts } from '@/providers/utils'
import { executeTool } from '@/tools'

/** Custom payload fields shared with `core.ts` (adaptive thinking, output_format). */
export type AnthropicStreamingToolLoopPayload = Omit<
  Anthropic.Messages.MessageStreamParams,
  'thinking'
> & {
  thinking?: Anthropic.Messages.ThinkingConfigParam | { type: 'adaptive' }
  output_format?: { type: 'json_schema'; schema: Record<string, unknown> }
  output_config?: { effort: string }
}

export interface AnthropicStreamingToolLoopComplete {
  content: string
  tokens: { input: number; output: number; total: number }
  cost: NormalizedBlockOutput['cost']
  toolCalls?: { list: unknown[]; count: number }
  modelTime: number
  toolsTime: number
  firstResponseTime: number
  iterations: number
}

export interface CreateAnthropicStreamingToolLoopStreamOptions {
  anthropic: Anthropic
  payload: AnthropicStreamingToolLoopPayload
  request: ProviderRequest
  messages: Anthropic.Messages.MessageParam[]
  logger: Logger
  /** Shared mutable segments; same array reference passed into createStreamingExecution. */
  timeSegments: TimeSegment[]
  /** Forced tool names from prepareToolsWithUsageControl (may be empty). */
  forcedTools?: string[]
  onComplete: (result: AnthropicStreamingToolLoopComplete) => void
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: string }).name
  return name === 'AbortError' || name === 'APIUserAbortError'
}

function buildSegmentTokens(usage: Anthropic.Messages.Usage): BlockTokens {
  const input = usage.input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  return {
    input,
    output,
    total: input + output + cacheRead + cacheWrite,
    ...(cacheRead > 0 && { cacheRead }),
    ...(cacheWrite > 0 && { cacheWrite }),
  }
}

function enrichModelSegment(
  timeSegments: TimeSegment[],
  response: Anthropic.Messages.Message,
  textContent: string,
  model: string
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

  const segmentTokens = response.usage ? buildSegmentTokens(response.usage) : undefined
  let cost: { input: number; output: number; total: number } | undefined
  if (
    segmentTokens &&
    typeof segmentTokens.input === 'number' &&
    typeof segmentTokens.output === 'number'
  ) {
    const useCached = (segmentTokens.cacheRead ?? 0) > 0
    const full = calculateCost(model, segmentTokens.input, segmentTokens.output, useCached)
    cost = { input: full.input, output: full.output, total: full.total }
  }

  enrichLastModelSegment(timeSegments, {
    assistantContent: textContent || undefined,
    thinkingContent: thinkingContent || undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason: response.stop_reason ?? undefined,
    tokens: segmentTokens,
    cost,
    provider: 'anthropic',
  })
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

/**
 * Multi-turn Anthropic tool loop as an `agent-events-v1` object stream.
 */
export function createAnthropicStreamingToolLoopStream(
  options: CreateAnthropicStreamingToolLoopStreamOptions
): ReadableStream<AgentStreamEvent> {
  const { anthropic, payload, request, messages, logger, timeSegments, onComplete } = options
  const forcedToolNames = options.forcedTools ?? []

  return new ReadableStream<AgentStreamEvent>({
    async start(controller) {
      const currentMessages = [...messages]
      const originalToolChoice = payload.tool_choice

      let usedForcedTools: string[] = []
      let hasUsedForcedTool = false
      let content = ''
      let iterationCount = 0
      let modelTime = 0
      let toolsTime = 0
      let firstResponseTime = 0
      const tokens = { input: 0, output: 0, total: 0 }
      const toolCalls: unknown[] = []
      const toolResults: Record<string, unknown>[] = []
      /** Tools that received start but not yet end (abort settlement). */
      const openToolStarts = new Map<string, string>()

      const streamOptions = request.abortSignal ? { signal: request.abortSignal } : undefined

      try {
        while (iterationCount < MAX_TOOL_ITERATIONS) {
          if (request.abortSignal?.aborted) {
            const abortErr = new DOMException('Stream aborted', 'AbortError')
            settleOpenTools(controller, openToolStarts, 'cancelled')
            throw abortErr
          }

          const turnPayload: AnthropicStreamingToolLoopPayload = {
            ...payload,
            messages: currentMessages,
          }
          // Streaming tool loop always streams each turn; never pass stream:true twice.
          ;(turnPayload as { stream?: boolean }).stream = undefined

          // Forced tool_choice vs thinking — same rules as silent loop.
          const thinkingEnabled = !!payload.thinking
          if (
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
            !thinkingEnabled &&
            hasUsedForcedTool &&
            typeof originalToolChoice === 'object'
          ) {
            turnPayload.tool_choice = undefined
          }

          const modelStart = Date.now()
          if (iterationCount === 0) {
            // firstResponseTime set after first turn
          }

          const messageStream = anthropic.messages.stream(
            turnPayload as Anthropic.Messages.MessageStreamParams,
            streamOptions
          )

          const textChunks: string[] = []
          let inputTokens = 0
          let outputTokens = 0

          try {
            for await (const event of messageStream) {
              if (event.type === 'message_start') {
                inputTokens = event.message.usage?.input_tokens ?? 0
                continue
              }
              if (event.type === 'message_delta') {
                outputTokens = event.usage?.output_tokens ?? outputTokens
                continue
              }
              if (event.type === 'content_block_start') {
                const block = event.content_block as {
                  type?: string
                  id?: string
                  name?: string
                }
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
              const delta = event.delta as {
                type?: string
                text?: string
                thinking?: string
              }
              if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
                controller.enqueue({ type: 'thinking_delta', text: delta.thinking })
                continue
              }
              if (delta.type === 'text_delta' && typeof delta.text === 'string') {
                textChunks.push(delta.text)
              }
            }

            const finalMessage = await messageStream.finalMessage()
            const modelEnd = Date.now()
            const thisModelTime = modelEnd - modelStart
            modelTime += thisModelTime
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

            // Prefer finalMessage.usage when present (includes cache fields).
            const turnInput = finalMessage.usage?.input_tokens ?? inputTokens
            const turnOutput = finalMessage.usage?.output_tokens ?? outputTokens
            tokens.input += turnInput
            tokens.output += turnOutput
            tokens.total += turnInput + turnOutput

            const textContent = finalMessage.content
              .filter((item): item is Anthropic.Messages.TextBlock => item.type === 'text')
              .map((item) => item.text)
              .join('\n')

            const toolUses = finalMessage.content.filter(
              (item): item is Anthropic.Messages.ToolUseBlock => item.type === 'tool_use'
            )

            const turnTag = toolUses.length > 0 ? 'intermediate' : 'final'
            for (const chunk of textChunks) {
              controller.enqueue({ type: 'text_delta', text: chunk, turn: turnTag })
            }
            // If the SDK assembled text but we somehow missed deltas, still project final text.
            if (textChunks.length === 0 && textContent && turnTag === 'final') {
              controller.enqueue({ type: 'text_delta', text: textContent, turn: 'final' })
            }
            if (turnTag === 'final' && textContent) {
              content = textContent
            } else if (textContent) {
              // Keep last intermediate text available if we hit max iterations mid-loop.
              content = textContent
            }

            enrichModelSegment(timeSegments, finalMessage, textContent, request.model)

            const forcedCheck = checkForForcedToolUsage(
              finalMessage,
              turnPayload.tool_choice ?? originalToolChoice,
              forcedToolNames,
              usedForcedTools
            )
            if (forcedCheck) {
              hasUsedForcedTool = forcedCheck.hasUsedForcedTool
              usedForcedTools = forcedCheck.usedForcedTools
            }

            if (toolUses.length === 0) {
              break
            }

            const toolsStartTime = Date.now()

            // Emit ends in completion order; keep Promise.all result order (= start order) for history.
            const orderedResults = await Promise.all(
              toolUses.map(async (toolUse) => {
                const toolCallStartTime = Date.now()
                const toolName = toolUse.name
                const toolArgs = (toolUse.input ?? {}) as Record<string, unknown>

                try {
                  if (request.abortSignal?.aborted) {
                    throw new DOMException('Stream aborted', 'AbortError')
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
                    skipPostProcess: true,
                    signal: request.abortSignal,
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
                  const cancelled = isAbortError(error) || !!request.abortSignal?.aborted
                  if (!cancelled) {
                    logger.error('Error processing tool call:', { error, toolName })
                  }
                  const value = {
                    toolUse,
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

            const toolUseBlocks: Anthropic.Messages.ToolUseBlockParam[] = []
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
              if (result.success && result.output) {
                toolResults.push(result.output as Record<string, unknown>)
                resultContent = result.output
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

              toolUseBlocks.push({
                type: 'tool_use',
                id: toolUse.id,
                name: toolName,
                input: toolArgs,
              })

              toolResultBlocks.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify(resultContent),
              })
            }

            const thinkingBlocks = finalMessage.content.filter(
              (
                item
              ): item is
                | Anthropic.Messages.ThinkingBlock
                | Anthropic.Messages.RedactedThinkingBlock =>
                item.type === 'thinking' || item.type === 'redacted_thinking'
            )

            if (toolUseBlocks.length > 0) {
              currentMessages.push({
                role: 'assistant',
                content: [
                  ...thinkingBlocks,
                  ...toolUseBlocks,
                ] as Anthropic.Messages.ContentBlockParam[],
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

            if (request.abortSignal?.aborted) {
              settleOpenTools(controller, openToolStarts, 'cancelled')
              throw new DOMException('Stream aborted', 'AbortError')
            }
          } catch (error) {
            settleOpenTools(controller, openToolStarts, isAbortError(error) ? 'cancelled' : 'error')
            throw error
          }
        }

        const modelCost = calculateCost(request.model, tokens.input, tokens.output)
        const toolCostTotal = sumToolCosts(toolResults)
        const cost = {
          input: modelCost.input,
          output: modelCost.output,
          total: modelCost.total + (toolCostTotal || 0),
          ...(toolCostTotal ? { toolCost: toolCostTotal } : {}),
        }

        onComplete({
          content,
          tokens,
          cost,
          toolCalls:
            toolCalls.length > 0 ? { list: toolCalls, count: toolCalls.length } : undefined,
          modelTime,
          toolsTime,
          firstResponseTime,
          iterations: iterationCount + 1,
        })

        controller.close()
      } catch (error) {
        const cancelled = isAbortError(error)
        settleOpenTools(controller, openToolStarts, cancelled ? 'cancelled' : 'error')
        controller.error(toError(error))
      }
    },
  })
}
