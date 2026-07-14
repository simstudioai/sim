/**
 * Live Bedrock ConverseStream tool loop (Step 9).
 *
 * Capability-honest: text + tool_call_start/end only — no invented thinking.
 * Final-turn-only answer projection via `turn` tags. Abort → cancelled.
 */

import {
  type Message as BedrockMessage,
  type BedrockRuntimeClient,
  type ContentBlock,
  type ConversationRole,
  ConverseStreamCommand,
  type SystemContentBlock,
  type Tool,
  type ToolConfiguration,
  type ToolResultBlock,
  type ToolUseBlock,
} from '@aws-sdk/client-bedrock-runtime'
import type { Logger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import type { NormalizedBlockOutput } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { checkForForcedToolUsage, generateToolUseId } from '@/providers/bedrock/utils'
import type { AgentStreamEvent, ToolCallEndStatus } from '@/providers/stream-events'
import { enrichLastModelSegment } from '@/providers/trace-enrichment'
import type { ProviderRequest, TimeSegment } from '@/providers/types'
import { calculateCost, prepareToolExecution, sumToolCosts } from '@/providers/utils'
import { executeTool } from '@/tools'

export interface BedrockStreamingToolLoopComplete {
  content: string
  tokens: { input: number; output: number; total: number }
  cost: NormalizedBlockOutput['cost']
  toolCalls?: { list: unknown[]; count: number }
  modelTime: number
  toolsTime: number
  firstResponseTime: number
  iterations: number
}

export interface CreateBedrockStreamingToolLoopStreamOptions {
  client: BedrockRuntimeClient
  modelId: string
  request: ProviderRequest
  messages: BedrockMessage[]
  system?: SystemContentBlock[]
  inferenceConfig: { temperature: number; maxTokens?: number }
  bedrockTools: Tool[]
  toolChoice: ToolConfiguration['toolChoice']
  logger: Logger
  timeSegments: TimeSegment[]
  forcedTools?: string[]
  onComplete: (result: BedrockStreamingToolLoopComplete) => void
}

interface AssembledToolUse {
  toolUseId: string
  name: string
  inputJson: string
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

function parseToolInput(inputJson: string): Record<string, unknown> {
  if (!inputJson.trim()) return {}
  try {
    const parsed = JSON.parse(inputJson)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

async function drainBedrockTurn(
  stream: AsyncIterable<import('@aws-sdk/client-bedrock-runtime').ConverseStreamOutput>,
  controller: ReadableStreamDefaultController<AgentStreamEvent>,
  openTools: Map<string, string>
): Promise<{
  text: string
  textChunks: string[]
  toolUses: AssembledToolUse[]
  inputTokens: number
  outputTokens: number
  stopReason?: string
}> {
  let text = ''
  const textChunks: string[] = []
  const toolsByIndex = new Map<number, AssembledToolUse>()
  let currentIndex: number | undefined
  let inputTokens = 0
  let outputTokens = 0
  let stopReason: string | undefined

  for await (const event of stream) {
    if (event.contentBlockStart) {
      currentIndex = event.contentBlockStart.contentBlockIndex
      const start = event.contentBlockStart.start
      if (start && 'toolUse' in start && start.toolUse) {
        const id = start.toolUse.toolUseId || generateToolUseId(start.toolUse.name || 'tool')
        const name = start.toolUse.name || ''
        if (typeof currentIndex === 'number') {
          toolsByIndex.set(currentIndex, { toolUseId: id, name, inputJson: '' })
        }
        if (id && name && !openTools.has(id)) {
          openTools.set(id, name)
          controller.enqueue({ type: 'tool_call_start', id, name })
        }
      }
      continue
    }

    if (event.contentBlockDelta) {
      const idx = event.contentBlockDelta.contentBlockIndex ?? currentIndex
      const delta = event.contentBlockDelta.delta
      if (delta?.text) {
        text += delta.text
        textChunks.push(delta.text)
      }
      if (delta && 'toolUse' in delta && delta.toolUse?.input && typeof idx === 'number') {
        const pending = toolsByIndex.get(idx)
        if (pending) {
          pending.inputJson += delta.toolUse.input
        }
      }
      continue
    }

    if (event.metadata?.usage) {
      inputTokens = event.metadata.usage.inputTokens ?? inputTokens
      outputTokens = event.metadata.usage.outputTokens ?? outputTokens
      continue
    }

    if (event.messageStop?.stopReason) {
      stopReason = event.messageStop.stopReason
    }
  }

  return {
    text,
    textChunks,
    toolUses: [...toolsByIndex.values()],
    inputTokens,
    outputTokens,
    stopReason,
  }
}

/**
 * Multi-turn Bedrock ConverseStream tool loop as agent-events-v1.
 */
export function createBedrockStreamingToolLoopStream(
  options: CreateBedrockStreamingToolLoopStreamOptions
): ReadableStream<AgentStreamEvent> {
  const {
    client,
    modelId,
    request,
    messages: initialMessages,
    system,
    inferenceConfig,
    bedrockTools,
    logger,
    timeSegments,
    onComplete,
  } = options
  const forcedTools = options.forcedTools ?? []
  const originalToolChoice = options.toolChoice

  return new ReadableStream<AgentStreamEvent>({
    async start(controller) {
      const currentMessages = [...initialMessages]
      let toolChoice = originalToolChoice
      let usedForcedTools: string[] = []
      let hasUsedForcedTool = false

      let content = ''
      let iterationCount = 0
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

      try {
        while (iterationCount < MAX_TOOL_ITERATIONS) {
          if (request.abortSignal?.aborted) {
            settleOpenTools(controller, openToolStarts, 'cancelled')
            throw new DOMException('Stream aborted', 'AbortError')
          }

          const toolConfig: ToolConfiguration | undefined = bedrockTools.length
            ? { tools: bedrockTools, toolChoice }
            : undefined

          const modelStart = Date.now()
          const command = new ConverseStreamCommand({
            modelId,
            messages: currentMessages,
            system: system && system.length > 0 ? system : undefined,
            inferenceConfig,
            toolConfig,
          })

          const streamResponse = await client.send(
            command,
            request.abortSignal ? { abortSignal: request.abortSignal } : undefined
          )
          if (!streamResponse.stream) {
            throw new Error('No stream returned from Bedrock')
          }

          const drained = await drainBedrockTurn(streamResponse.stream, controller, openToolStarts)
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

          tokens.input += drained.inputTokens
          tokens.output += drained.outputTokens
          tokens.total += drained.inputTokens + drained.outputTokens

          const turnCost = calculateCost(request.model, drained.inputTokens, drained.outputTokens)
          costInput += turnCost.input
          costOutput += turnCost.output
          costTotal += turnCost.total
          latestPricing = turnCost.pricing

          const turnTag = drained.toolUses.length > 0 ? 'intermediate' : 'final'
          for (const chunk of drained.textChunks) {
            controller.enqueue({ type: 'text_delta', text: chunk, turn: turnTag })
          }
          if (drained.text) {
            content = drained.text
          }

          const assembledToolUses: ToolUseBlock[] = drained.toolUses.map((t) => ({
            toolUseId: t.toolUseId,
            name: t.name,
            input: parseToolInput(t.inputJson),
          }))

          enrichLastModelSegment(timeSegments, {
            assistantContent: drained.text || undefined,
            toolCalls:
              assembledToolUses.length > 0
                ? assembledToolUses.map((t) => ({
                    id: t.toolUseId || '',
                    name: t.name || '',
                    arguments: (t.input as Record<string, unknown>) || {},
                  }))
                : undefined,
            finishReason: drained.stopReason,
            tokens: {
              input: drained.inputTokens,
              output: drained.outputTokens,
              total: drained.inputTokens + drained.outputTokens,
            },
            cost: {
              input: turnCost.input,
              output: turnCost.output,
              total: turnCost.total,
            },
            provider: 'bedrock',
          })

          const forcedCheck = checkForForcedToolUsage(
            assembledToolUses.map((t) => ({ name: t.name || '' })),
            toolChoice,
            forcedTools,
            usedForcedTools
          )
          if (forcedCheck) {
            hasUsedForcedTool = forcedCheck.hasUsedForcedTool
            usedForcedTools = forcedCheck.usedForcedTools
          }

          if (assembledToolUses.length === 0) {
            break
          }

          const toolsStartTime = Date.now()
          const orderedResults = await Promise.all(
            assembledToolUses.map(async (toolUse) => {
              const toolCallStartTime = Date.now()
              const toolName = toolUse.name || ''
              const toolArgs = (toolUse.input as Record<string, unknown>) || {}
              const toolUseId = toolUse.toolUseId || generateToolUseId(toolName)

              try {
                if (request.abortSignal?.aborted) {
                  throw new DOMException('Stream aborted', 'AbortError')
                }

                const tool = request.tools?.find((t) => t.id === toolName)
                if (!tool) {
                  const value = {
                    toolUse,
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
                const status: ToolCallEndStatus = result.success ? 'success' : 'error'
                openToolStarts.delete(toolUseId)
                controller.enqueue({
                  type: 'tool_call_end',
                  id: toolUseId,
                  name: toolName,
                  status,
                })
                return {
                  toolUse,
                  toolUseId,
                  toolName,
                  toolArgs,
                  toolParams,
                  result,
                  startTime: toolCallStartTime,
                  endTime: toolCallEndTime,
                  duration: toolCallEndTime - toolCallStartTime,
                  status,
                }
              } catch (error) {
                const toolCallEndTime = Date.now()
                const cancelled = isAbortError(error) || !!request.abortSignal?.aborted
                if (!cancelled) {
                  logger.error('Error processing tool call:', { error, toolName })
                }
                const status: ToolCallEndStatus = cancelled ? 'cancelled' : 'error'
                openToolStarts.delete(toolUseId)
                controller.enqueue({
                  type: 'tool_call_end',
                  id: toolUseId,
                  name: toolName,
                  status,
                })
                return {
                  toolUse,
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
                  status,
                }
              }
            })
          )

          toolsTime += Date.now() - toolsStartTime

          const assistantContent: ContentBlock[] = assembledToolUses.map((toolUse) => ({
            toolUse: {
              toolUseId: toolUse.toolUseId,
              name: toolUse.name,
              input: toolUse.input,
            },
          }))
          currentMessages.push({
            role: 'assistant' as ConversationRole,
            content: assistantContent,
          })

          const toolResultContent: ContentBlock[] = []
          for (const value of orderedResults) {
            const { toolUseId, toolName, toolParams, result, startTime, endTime, duration } = value

            timeSegments.push({
              type: 'tool',
              name: toolName,
              startTime,
              endTime,
              duration,
              toolCallId: toolUseId,
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

            const toolResultBlock: ToolResultBlock = {
              toolUseId,
              content: [{ text: JSON.stringify(resultContent) }],
            }
            toolResultContent.push({ toolResult: toolResultBlock })
          }

          if (toolResultContent.length > 0) {
            currentMessages.push({
              role: 'user' as ConversationRole,
              content: toolResultContent,
            })
          }

          if (
            typeof originalToolChoice === 'object' &&
            hasUsedForcedTool &&
            forcedTools.length > 0
          ) {
            const remainingTools = forcedTools.filter((tool) => !usedForcedTools.includes(tool))
            toolChoice =
              remainingTools.length > 0 ? { tool: { name: remainingTools[0] } } : { auto: {} }
          } else if (hasUsedForcedTool && typeof originalToolChoice === 'object') {
            toolChoice = { auto: {} }
          }

          iterationCount += 1
        }

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
          iterations: iterationCount + 1,
        })
        controller.close()
      } catch (error) {
        if (isAbortError(error) || request.abortSignal?.aborted) {
          settleOpenTools(controller, openToolStarts, 'cancelled')
        } else {
          settleOpenTools(controller, openToolStarts, 'error')
          logger.error('Bedrock streaming tool loop failed', {
            error: toError(error).message,
          })
        }
        controller.error(error)
      }
    },
  })
}
