import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import OpenAI from 'openai'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { formatMessagesForProvider } from '@/providers/attachments'
import { createReadableStreamFromKimiStream } from '@/providers/kimi/utils'
import {
  getModelCapabilities,
  getProviderDefaultModel,
  getProviderModels,
} from '@/providers/models'
import { createStreamingExecution } from '@/providers/streaming-execution'
import { adaptOpenAIChatToolSchema } from '@/providers/tool-schema-adapter'
import { enrichLastModelSegmentFromChatCompletions } from '@/providers/trace-enrichment'
import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/types'
import { ProviderError } from '@/providers/types'
import {
  calculateCost,
  enforceStrictSchema,
  prepareToolExecution,
  prepareToolsWithUsageControl,
  sumToolCosts,
  trackForcedToolUsage,
} from '@/providers/utils'
import { executeTool } from '@/tools'

const logger = createLogger('KimiProvider')

const KIMI_BASE_URL = 'https://api.moonshot.ai/v1'

/** Kimi models whose thinking mode can be toggled off; the rest always reason. */
const THINKING_TOGGLE_MODELS = new Set(
  getProviderModels('kimi').filter((id) =>
    getModelCapabilities(id)?.thinking?.levels.includes('disabled')
  )
)

function buildResponseFormatPayload(
  responseFormat: NonNullable<ProviderRequest['responseFormat']>
) {
  const isStrict = responseFormat.strict !== false
  const rawSchema = responseFormat.schema || responseFormat
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: responseFormat.name || 'response_schema',
      schema: isStrict ? enforceStrictSchema(rawSchema) : rawSchema,
      strict: isStrict,
    },
  }
}

/**
 * Moonshot AI's Kimi models via an OpenAI-compatible chat-completions API (`api.moonshot.ai`),
 * with these documented model-family constraints baked into the adapter:
 * - Every current Kimi model pins `temperature`/`top_p` server-side (passing another value is
 *   rejected), so the adapter never sends `temperature` and no model declares the capability.
 * - Output length is capped via `max_completion_tokens` (Kimi's documented parameter).
 * - `thinking: { type }` maps from `request.thinkingLevel` on the models whose definition
 *   declares the toggle (currently kimi-k2.6); always-reasoning models (kimi-k3,
 *   kimi-k2.7-code) take no toggle, so the parameter is never sent for them.
 * - `response_format: json_schema` structured output is supported natively (`name`/`strict`/
 *   `schema` nesting per Kimi's API reference).
 * - `tool_choice` supports `"auto"` and the `{ type: "function" }` object form, but the API
 *   rejects the object form whenever thinking is enabled ("tool_choice 'specified' is
 *   incompatible with thinking enabled", verified live). On models with a thinking toggle the
 *   adapter therefore sends `thinking: { type: "disabled" }` for the duration of a forced-tool
 *   request; on always-thinking models (kimi-k3, kimi-k2.7-code) it downgrades the forced
 *   choice to `"auto"` with a warning, mirroring the Z.ai adapter's behavior.
 */
export const kimiProvider: ProviderConfig = {
  id: 'kimi',
  name: 'Kimi',
  description: "Moonshot AI's Kimi models via an OpenAI-compatible API",
  version: '1.0.0',
  models: getProviderModels('kimi'),
  defaultModel: getProviderDefaultModel('kimi'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Kimi')
    }

    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      const kimi = new OpenAI({
        apiKey: request.apiKey,
        baseURL: KIMI_BASE_URL,
      })

      const allMessages = []

      if (request.systemPrompt) {
        allMessages.push({
          role: 'system',
          content: request.systemPrompt,
        })
      }

      if (request.context) {
        allMessages.push({
          role: 'user',
          content: request.context,
        })
      }

      if (request.messages) {
        allMessages.push(...request.messages)
      }
      const formattedMessages = formatMessagesForProvider(allMessages, 'kimi')

      const tools = request.tools?.length
        ? request.tools.map((tool) => adaptOpenAIChatToolSchema(tool))
        : undefined

      const payload: any = {
        model: request.model,
        messages: formattedMessages,
      }

      if (request.maxTokens != null) payload.max_completion_tokens = request.maxTokens

      if (
        THINKING_TOGGLE_MODELS.has(request.model) &&
        (request.thinkingLevel === 'enabled' || request.thinkingLevel === 'disabled')
      ) {
        payload.thinking = { type: request.thinkingLevel }
      }

      if (request.responseFormat) {
        payload.response_format = buildResponseFormatPayload(request.responseFormat)
      }

      let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null
      let hasActiveTools = false

      if (tools?.length) {
        preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'openai')
        const { tools: filteredTools, toolChoice } = preparedTools

        if (filteredTools?.length && toolChoice) {
          payload.tools = filteredTools
          payload.tool_choice = toolChoice
          hasActiveTools = true

          if (typeof toolChoice === 'object') {
            if (THINKING_TOGGLE_MODELS.has(request.model)) {
              if (payload.thinking?.type === 'enabled') {
                logger.warn(
                  'Kimi rejects forced tool_choice while thinking is enabled — disabling thinking for this forced-tool request',
                  { model: request.model }
                )
              }
              payload.thinking = { type: 'disabled' }
            } else {
              logger.warn(
                'Kimi rejects forced tool_choice on always-thinking models — ignoring force setting and falling back to auto',
                { forcedTools: preparedTools.forcedTools, model: request.model }
              )
              payload.tool_choice = 'auto'
            }
          }

          logger.info('Kimi request configuration:', {
            toolCount: filteredTools.length,
            toolChoice:
              typeof payload.tool_choice === 'string'
                ? payload.tool_choice
                : `force:${payload.tool_choice.function?.name}`,
            model: request.model,
          })
        }
      }

      if (request.stream && (!tools || tools.length === 0 || !hasActiveTools)) {
        logger.info('Using streaming response for Kimi request (no tools)')

        const streamResponse = await kimi.chat.completions.create(
          {
            ...payload,
            stream: true,
            stream_options: { include_usage: true },
          },
          request.abortSignal ? { signal: request.abortSignal } : undefined
        )

        const streamingResult = createStreamingExecution({
          model: request.model,
          providerStartTime,
          providerStartTimeISO,
          timing: { kind: 'simple', segmentName: request.model },
          initialTokens: { input: 0, output: 0, total: 0 },
          initialCost: { input: 0, output: 0, total: 0 },
          isStreaming: true,
          streamFormat: 'agent-events-v1',
          createStream: ({ output }) =>
            createReadableStreamFromKimiStream(
              // double-cast-allowed: payload is untyped so the SDK cannot resolve the streaming overload; the stream yields OpenAI ChatCompletionChunk objects
              streamResponse as unknown as AsyncIterable<ChatCompletionChunk>,
              (content, usage) => {
                output.content = content
                output.tokens = {
                  input: usage.prompt_tokens,
                  output: usage.completion_tokens,
                  total: usage.total_tokens,
                }

                const costResult = calculateCost(
                  request.model,
                  usage.prompt_tokens,
                  usage.completion_tokens
                )
                output.cost = {
                  input: costResult.input,
                  output: costResult.output,
                  total: costResult.total,
                }
              }
            ),
        })

        return streamingResult
      }

      const initialCallTime = Date.now()
      const originalToolChoice = payload.tool_choice
      const forcedTools = preparedTools?.forcedTools || []
      let usedForcedTools: string[] = []

      let currentResponse = await kimi.chat.completions.create(
        payload,
        request.abortSignal ? { signal: request.abortSignal } : undefined
      )
      const firstResponseTime = Date.now() - initialCallTime

      let content = currentResponse.choices[0]?.message?.content || ''

      const tokens = {
        input: currentResponse.usage?.prompt_tokens || 0,
        output: currentResponse.usage?.completion_tokens || 0,
        total: currentResponse.usage?.total_tokens || 0,
      }
      const toolCalls = []
      const toolResults: Record<string, unknown>[] = []
      const currentMessages = [...formattedMessages]
      let iterationCount = 0
      let hasUsedForcedTool = false
      let modelTime = firstResponseTime
      let toolsTime = 0

      const timeSegments: TimeSegment[] = [
        {
          type: 'model',
          name: request.model,
          startTime: initialCallTime,
          endTime: initialCallTime + firstResponseTime,
          duration: firstResponseTime,
        },
      ]

      if (
        typeof originalToolChoice === 'object' &&
        currentResponse.choices[0]?.message?.tool_calls
      ) {
        const toolCallsResponse = currentResponse.choices[0].message.tool_calls
        const result = trackForcedToolUsage(
          toolCallsResponse,
          originalToolChoice,
          logger,
          'openai',
          forcedTools,
          usedForcedTools
        )
        hasUsedForcedTool = result.hasUsedForcedTool
        usedForcedTools = result.usedForcedTools
      }

      try {
        while (iterationCount < MAX_TOOL_ITERATIONS) {
          if (currentResponse.choices[0]?.message?.content) {
            content = currentResponse.choices[0].message.content
          }

          const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls

          enrichLastModelSegmentFromChatCompletions(
            timeSegments,
            currentResponse,
            toolCallsInResponse,
            { model: request.model, provider: 'kimi' }
          )

          if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
            break
          }

          const toolsStartTime = Date.now()

          const toolExecutionPromises = toolCallsInResponse.map(async (toolCall) => {
            const toolCallStartTime = Date.now()
            const toolName = toolCall.function.name

            try {
              const toolArgs = JSON.parse(toolCall.function.arguments)
              const tool = request.tools?.find((t) => t.id === toolName)

              if (!tool) {
                const toolCallEndTime = Date.now()
                return {
                  toolCall,
                  toolName,
                  toolParams: {},
                  result: {
                    success: false,
                    output: undefined,
                    error: `Tool "${toolName}" is not available`,
                  },
                  startTime: toolCallStartTime,
                  endTime: toolCallEndTime,
                  duration: toolCallEndTime - toolCallStartTime,
                }
              }

              const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)
              const result = await executeTool(toolName, executionParams, {
                signal: request.abortSignal,
              })
              const toolCallEndTime = Date.now()

              return {
                toolCall,
                toolName,
                toolParams,
                result,
                startTime: toolCallStartTime,
                endTime: toolCallEndTime,
                duration: toolCallEndTime - toolCallStartTime,
              }
            } catch (error) {
              const toolCallEndTime = Date.now()
              logger.error('Error processing tool call:', { error, toolName })

              return {
                toolCall,
                toolName,
                toolParams: {},
                result: {
                  success: false,
                  output: undefined,
                  error: getErrorMessage(error, 'Tool execution failed'),
                },
                startTime: toolCallStartTime,
                endTime: toolCallEndTime,
                duration: toolCallEndTime - toolCallStartTime,
              }
            }
          })

          const executionResults = await Promise.allSettled(toolExecutionPromises)

          const assistantReasoning = (
            currentResponse.choices[0]?.message as { reasoning_content?: string } | undefined
          )?.reasoning_content

          currentMessages.push({
            role: 'assistant',
            content: null,
            ...(assistantReasoning ? { reasoning_content: assistantReasoning } : {}),
            tool_calls: toolCallsInResponse.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            })),
          })

          for (const settledResult of executionResults) {
            if (settledResult.status === 'rejected' || !settledResult.value) continue

            const { toolCall, toolName, toolParams, result, startTime, endTime, duration } =
              settledResult.value

            timeSegments.push({
              type: 'tool',
              name: toolName,
              startTime: startTime,
              endTime: endTime,
              duration: duration,
              toolCallId: toolCall.id,
            })

            let resultContent: any
            if (result.success && result.output) {
              toolResults.push(result.output)
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
              duration: duration,
              result: resultContent,
              success: result.success,
            })

            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(resultContent),
            })
          }

          const thisToolsTime = Date.now() - toolsStartTime
          toolsTime += thisToolsTime

          const nextPayload = {
            ...payload,
            messages: currentMessages,
          }

          if (
            typeof originalToolChoice === 'object' &&
            hasUsedForcedTool &&
            forcedTools.length > 0
          ) {
            const remainingTools = forcedTools.filter((tool) => !usedForcedTools.includes(tool))

            if (remainingTools.length > 0) {
              nextPayload.tool_choice = {
                type: 'function',
                function: { name: remainingTools[0] },
              }
              logger.info(`Forcing next tool: ${remainingTools[0]}`)
            } else {
              nextPayload.tool_choice = 'auto'
              logger.info('All forced tools have been used, switching to auto tool_choice')
            }
          }

          const nextModelStartTime = Date.now()
          currentResponse = await kimi.chat.completions.create(
            nextPayload,
            request.abortSignal ? { signal: request.abortSignal } : undefined
          )

          if (
            typeof nextPayload.tool_choice === 'object' &&
            currentResponse.choices[0]?.message?.tool_calls
          ) {
            const toolCallsResponse = currentResponse.choices[0].message.tool_calls
            const result = trackForcedToolUsage(
              toolCallsResponse,
              nextPayload.tool_choice,
              logger,
              'openai',
              forcedTools,
              usedForcedTools
            )
            hasUsedForcedTool = result.hasUsedForcedTool
            usedForcedTools = result.usedForcedTools
          }

          const nextModelEndTime = Date.now()
          const thisModelTime = nextModelEndTime - nextModelStartTime

          timeSegments.push({
            type: 'model',
            name: request.model,
            startTime: nextModelStartTime,
            endTime: nextModelEndTime,
            duration: thisModelTime,
          })

          modelTime += thisModelTime

          if (currentResponse.choices[0]?.message?.content) {
            content = currentResponse.choices[0].message.content
          }

          if (currentResponse.usage) {
            tokens.input += currentResponse.usage.prompt_tokens || 0
            tokens.output += currentResponse.usage.completion_tokens || 0
            tokens.total += currentResponse.usage.total_tokens || 0
          }

          iterationCount++
        }

        if (iterationCount === MAX_TOOL_ITERATIONS) {
          enrichLastModelSegmentFromChatCompletions(
            timeSegments,
            currentResponse,
            currentResponse.choices[0]?.message?.tool_calls,
            { model: request.model, provider: 'kimi' }
          )
        }
      } catch (error) {
        logger.error('Error in Kimi request:', { error })
        throw error
      }

      if (request.stream) {
        logger.info('Using streaming for final Kimi response after tool processing')

        const streamingPayload: any = {
          ...payload,
          messages: currentMessages,
          stream: true,
          stream_options: { include_usage: true },
        }
        streamingPayload.tools = undefined
        streamingPayload.tool_choice = undefined

        const streamResponse = await kimi.chat.completions.create(
          streamingPayload,
          request.abortSignal ? { signal: request.abortSignal } : undefined
        )

        const accumulatedCost = calculateCost(request.model, tokens.input, tokens.output)

        const streamingResult = createStreamingExecution({
          model: request.model,
          providerStartTime,
          providerStartTimeISO,
          timing: {
            kind: 'accumulated',
            modelTime,
            toolsTime,
            firstResponseTime,
            iterations: iterationCount + 1,
            timeSegments,
          },
          initialTokens: {
            input: tokens.input,
            output: tokens.output,
            total: tokens.total,
          },
          initialCost: {
            input: accumulatedCost.input,
            output: accumulatedCost.output,
            toolCost: undefined as number | undefined,
            total: accumulatedCost.total,
          },
          toolCalls:
            toolCalls.length > 0
              ? {
                  list: toolCalls,
                  count: toolCalls.length,
                }
              : undefined,
          isStreaming: true,
          streamFormat: 'agent-events-v1',
          createStream: ({ output }) =>
            createReadableStreamFromKimiStream(
              // double-cast-allowed: payload is untyped so the SDK cannot resolve the streaming overload; the stream yields OpenAI ChatCompletionChunk objects
              streamResponse as unknown as AsyncIterable<ChatCompletionChunk>,
              (content, usage) => {
                output.content = content
                output.tokens = {
                  input: tokens.input + usage.prompt_tokens,
                  output: tokens.output + usage.completion_tokens,
                  total: tokens.total + usage.total_tokens,
                }

                const streamCost = calculateCost(
                  request.model,
                  usage.prompt_tokens,
                  usage.completion_tokens
                )
                const tc = sumToolCosts(toolResults)
                output.cost = {
                  input: accumulatedCost.input + streamCost.input,
                  output: accumulatedCost.output + streamCost.output,
                  toolCost: tc || undefined,
                  total: accumulatedCost.total + streamCost.total + tc,
                }
              }
            ),
        })

        return streamingResult
      }

      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      return {
        content,
        model: request.model,
        tokens,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
        timing: {
          startTime: providerStartTimeISO,
          endTime: providerEndTimeISO,
          duration: totalDuration,
          modelTime: modelTime,
          toolsTime: toolsTime,
          firstResponseTime: firstResponseTime,
          iterations: iterationCount + 1,
          timeSegments: timeSegments,
        },
      }
    } catch (error) {
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      logger.error('Error in Kimi request:', {
        error,
        duration: totalDuration,
      })

      throw new ProviderError(toError(error).message, {
        startTime: providerStartTimeISO,
        endTime: providerEndTimeISO,
        duration: totalDuration,
      })
    }
  },
}
