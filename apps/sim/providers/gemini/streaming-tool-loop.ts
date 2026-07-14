/**
 * Live Gemini streaming tool loop (Step 9).
 *
 * Each model turn uses generateContentStream. Thought parts → thinking_delta
 * live; functionCall parts → tool_call_start (with local ids when missing);
 * text buffered until the turn is classified intermediate vs final.
 * Tool ends emit in completion order; abort → cancelled.
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
import type { IterationToolCall, NormalizedBlockOutput } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import {
  checkForForcedToolUsage,
  cleanSchemaForGemini,
  convertUsageMetadata,
  ensureStructResponse,
} from '@/providers/google/utils'
import type { AgentStreamEvent, ToolCallEndStatus } from '@/providers/stream-events'
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

export interface GeminiStreamingToolLoopComplete {
  content: string
  tokens: { input: number; output: number; total: number }
  cost: NormalizedBlockOutput['cost']
  toolCalls?: { list: unknown[]; count: number }
  modelTime: number
  toolsTime: number
  firstResponseTime: number
  iterations: number
}

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
  onComplete: (result: GeminiStreamingToolLoopComplete) => void
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
  const allForcedToolsUsed =
    forcedTools.length > 0 && usedForcedTools.length === forcedTools.length

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
  openTools: Map<string, string>
): Promise<{
  text: string
  thinking: string
  functionCallParts: Part[]
  usage: GeminiUsage
  textChunks: string[]
  finishReason?: string
}> {
  let text = ''
  let thinking = ''
  const textChunks: string[] = []
  const functionCallParts: Part[] = []
  const seenKeys = new Set<string>()
  let usage: GeminiUsage = { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 }
  let finishReason: string | undefined

  for await (const chunk of stream) {
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
        textChunks.push(fallback)
      }
      continue
    }

    for (const part of parts) {
      if (part.functionCall) {
        const id = ensureToolCallId(part.functionCall.id, 'gemini')
        const name = part.functionCall.name ?? ''
        const key = id
        if (!seenKeys.has(key) && name) {
          seenKeys.add(key)
          const normalized: Part = {
            ...part,
            functionCall: { ...part.functionCall, id },
          }
          functionCallParts.push(normalized)
          if (!openTools.has(id)) {
            openTools.set(id, name)
            controller.enqueue({ type: 'tool_call_start', id, name })
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
        textChunks.push(part.text)
      }
    }
  }

  return { text, thinking, functionCallParts, usage, textChunks, finishReason }
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

  return new ReadableStream<AgentStreamEvent>({
    async start(controller) {
      let contents = [...initialContents]
      let currentToolConfig = options.toolConfig
      let usedForcedTools: string[] = []

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

          const turnConfig = buildNextConfig(
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
            config: turnConfig,
          })

          const drained = await drainGeminiTurn(streamGenerator, controller, openToolStarts)
          const modelEnd = Date.now()
          const thisModelTime = modelEnd - modelStart
          modelTime += thisModelTime
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

          const turnTag = drained.functionCallParts.length > 0 ? 'intermediate' : 'final'
          for (const chunk of drained.textChunks) {
            controller.enqueue({ type: 'text_delta', text: chunk, turn: turnTag })
          }
          if (drained.text) {
            content = drained.text
          }

          const toolCallsForEnrich: IterationToolCall[] = drained.functionCallParts
            .filter((p): p is Part & { functionCall: NonNullable<Part['functionCall']> } =>
              Boolean(p.functionCall)
            )
            .map((p) => ({
              id: p.functionCall.id ?? '',
              name: p.functionCall.name ?? '',
              arguments: (p.functionCall.args ?? {}) as Record<string, unknown>,
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
            drained.functionCallParts
              .map((p) => p.functionCall)
              .filter((fc): fc is NonNullable<typeof fc> => Boolean(fc)),
            currentToolConfig,
            forcedTools,
            usedForcedTools
          )
          if (forcedCheck) {
            usedForcedTools = forcedCheck.usedForcedTools
            currentToolConfig = forcedCheck.nextToolConfig
          }

          if (drained.functionCallParts.length === 0) {
            break
          }

          const toolsStartTime = Date.now()

          const orderedResults = await Promise.all(
            drained.functionCallParts.map(async (part) => {
              const functionCall = part.functionCall!
              const toolCallId = ensureToolCallId(functionCall.id, 'gemini')
              const toolName = functionCall.name ?? ''
              const toolArgs = (functionCall.args ?? {}) as Record<string, unknown>
              const toolCallStartTime = Date.now()

              try {
                if (request.abortSignal?.aborted) {
                  throw new DOMException('Stream aborted', 'AbortError')
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
                  signal: request.abortSignal,
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
                const cancelled = isAbortError(error) || !!request.abortSignal?.aborted
                if (!cancelled) {
                  logger.error('Error processing function call:', {
                    error: toError(error).message,
                    functionName: toolName,
                  })
                }
                const status: ToolCallEndStatus = cancelled ? 'cancelled' : 'error'
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

          const modelParts: Part[] = orderedResults.map((r) => ({
            ...r.part,
            functionCall: {
              ...r.part.functionCall!,
              id: r.toolCallId,
            },
          }))
          const userParts: Part[] = orderedResults.map((r) => ({
            functionResponse: {
              name: r.toolName,
              response: r.resultContent,
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
            if (r.success && r.result?.output) {
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
          logger.error('Gemini streaming tool loop failed', {
            error: toError(error).message,
          })
        }
        controller.error(error)
      }
    },
  })
}
