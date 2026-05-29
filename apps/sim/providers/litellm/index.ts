import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import OpenAI from 'openai'
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions'
import { env } from '@/lib/core/config/env'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { formatMessagesForProvider } from '@/providers/attachments'
import { createReadableStreamFromLiteLLMStream } from '@/providers/litellm/utils'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import { enrichLastModelSegmentFromChatCompletions } from '@/providers/trace-enrichment'
import type {
  Message,
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
import { useProvidersStore } from '@/stores/providers'
import { executeTool } from '@/tools'

const logger = createLogger('LiteLLMProvider')
const LITELLM_VERSION = '1.0.0'

export const litellmProvider: ProviderConfig = {
  id: 'litellm',
  name: 'LiteLLM',
  description: 'LiteLLM proxy with OpenAI-compatible API',
  version: LITELLM_VERSION,
  models: getProviderModels('litellm'),
  defaultModel: getProviderDefaultModel('litellm'),

  async initialize() {
    if (typeof window !== 'undefined') {
      logger.info('Skipping LiteLLM initialization on client side to avoid CORS issues')
      return
    }

    const baseUrl = (env.LITELLM_BASE_URL || '').replace(/\/$/, '')
    if (!baseUrl) {
      logger.info('LITELLM_BASE_URL not configured, skipping initialization')
      return
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (env.LITELLM_API_KEY) {
        headers.Authorization = `Bearer ${env.LITELLM_API_KEY}`
      }

      const response = await fetch(`${baseUrl}/v1/models`, { headers })
      if (!response.ok) {
        await response.text().catch(() => {})
        useProvidersStore.getState().setProviderModels('litellm', [])
        logger.warn('LiteLLM service is not available. The provider will be disabled.')
        return
      }

      const { vllmUpstreamResponseSchema } = await import('@/lib/api/contracts/providers')
      const data = vllmUpstreamResponseSchema.parse(await response.json())
      const models = data.data.map((model) => `litellm/${model.id}`)

      this.models = models
      useProvidersStore.getState().setProviderModels('litellm', models)

      logger.info(`Discovered ${models.length} LiteLLM model(s):`, { models })
    } catch (error) {
      logger.warn('LiteLLM model instantiation failed. The provider will be disabled.', {
        error: getErrorMessage(error, 'Unknown error'),
      })
    }
  },

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    logger.info('Preparing LiteLLM request', {
      model: request.model,
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.messages?.length,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      stream: !!request.stream,
    })

    const baseUrl = (env.LITELLM_BASE_URL || '').replace(/\/$/, '')
    if (!baseUrl) {
      throw new Error('LITELLM_BASE_URL is required for LiteLLM provider')
    }

    const apiKey = request.apiKey || env.LITELLM_API_KEY || 'empty'
    const litellm = new OpenAI({
      apiKey,
      baseURL: `${baseUrl}/v1`,
    })

    const allMessages: Message[] = []

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
    const formattedMessages = formatMessagesForProvider(allMessages, 'litellm') as Message[]

    const tools = request.tools?.length
      ? request.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.id,
            description: tool.description,
            parameters: tool.parameters,
          },
        }))
      : undefined

    const payload: any = {
      model: request.model.replace(/^litellm\//, ''),
      messages: formattedMessages,
    }

    if (request.temperature !== undefined) payload.temperature = request.temperature
    if (request.maxTokens != null) payload.max_completion_tokens = request.maxTokens

    if (request.reasoningEffort !== undefined && request.reasoningEffort !== 'auto') {
      payload.reasoning_effort = request.reasoningEffort
    }

    const isStrictResponseFormat = request.responseFormat
      ? request.responseFormat.strict !== false
      : false

    const responseFormatPayload = request.responseFormat
      ? {
          type: 'json_schema' as const,
          json_schema: {
            name: request.responseFormat.name || 'response_schema',
            schema: isStrictResponseFormat
              ? enforceStrictSchema(request.responseFormat.schema || request.responseFormat)
              : request.responseFormat.schema || request.responseFormat,
            strict: isStrictResponseFormat,
          },
        }
      : undefined

    let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null
    let hasActiveTools = false

    if (tools?.length) {
      preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'litellm')
      const { tools: filteredTools, toolChoice } = preparedTools

      if (filteredTools?.length && toolChoice) {
        payload.tools = filteredTools
        payload.tool_choice = toolChoice
        hasActiveTools = true

        logger.info('LiteLLM request configuration:', {
          toolCount: filteredTools.length,
          toolChoice:
            typeof toolChoice === 'string'
              ? toolChoice
              : toolChoice.type === 'function'
                ? `force:${toolChoice.function.name}`
                : 'unknown',
          model: payload.model,
        })
      }
    }

    const deferResponseFormat = !!responseFormatPayload && hasActiveTools
    if (responseFormatPayload && !deferResponseFormat) {
      payload.response_format = responseFormatPayload
      logger.info('Added JSON schema response format to LiteLLM request')
    }

    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      if (request.stream && (!tools || tools.length === 0 || !hasActiveTools)) {
        logger.info('Using streaming response for LiteLLM request')

        const streamingParams: ChatCompletionCreateParamsStreaming = {
          ...payload,
          stream: true,
          stream_options: { include_usage: true },
        }
        const streamResponse = await litellm.chat.completions.create(
          streamingParams,
          request.abortSignal ? { signal: request.abortSignal } : undefined
        )

        const streamingResult = {
          stream: createReadableStreamFromLiteLLMStream(streamResponse, (content, usage) => {
            let cleanContent = content
            if (cleanContent && request.responseFormat) {
              cleanContent = cleanContent.replace(/```json\n?|\n?```/g, '').trim()
            }

            streamingResult.execution.output.content = cleanContent
            streamingResult.execution.output.tokens = {
              input: usage.prompt_tokens,
              output: usage.completion_tokens,
              total: usage.total_tokens,
            }

            const costResult = calculateCost(
              request.model,
              usage.prompt_tokens,
              usage.completion_tokens
            )
            streamingResult.execution.output.cost = {
              input: costResult.input,
              output: costResult.output,
              total: costResult.total,
            }

            const streamEndTime = Date.now()
            const streamEndTimeISO = new Date(streamEndTime).toISOString()

            if (streamingResult.execution.output.providerTiming) {
              streamingResult.execution.output.providerTiming.endTime = streamEndTimeISO
              streamingResult.execution.output.providerTiming.duration =
                streamEndTime - providerStartTime

              if (streamingResult.execution.output.providerTiming.timeSegments?.[0]) {
                streamingResult.execution.output.providerTiming.timeSegments[0].endTime =
                  streamEndTime
                streamingResult.execution.output.providerTiming.timeSegments[0].duration =
                  streamEndTime - providerStartTime
              }
            }
          }),
          execution: {
            success: true,
            output: {
              content: '',
              model: request.model,
              tokens: { input: 0, output: 0, total: 0 },
              toolCalls: undefined,
              providerTiming: {
                startTime: providerStartTimeISO,
                endTime: new Date().toISOString(),
                duration: Date.now() - providerStartTime,
                timeSegments: [
                  {
                    type: 'model',
                    name: request.model,
                    startTime: providerStartTime,
                    endTime: Date.now(),
                    duration: Date.now() - providerStartTime,
                  },
                ],
              },
              cost: { input: 0, output: 0, total: 0 },
            },
            logs: [],
            metadata: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: Date.now() - providerStartTime,
            },
            isStreaming: true,
          },
        } as StreamingExecution

        return streamingResult as StreamingExecution
      }

      const initialCallTime = Date.now()

      const originalToolChoice = payload.tool_choice

      const forcedTools = preparedTools?.forcedTools || []
      let usedForcedTools: string[] = []

      const checkForForcedToolUsage = (
        response: any,
        toolChoice: string | { type: string; function?: { name: string }; name?: string; any?: any }
      ) => {
        if (typeof toolChoice === 'object' && response.choices[0]?.message?.tool_calls) {
          const toolCallsResponse = response.choices[0].message.tool_calls
          const result = trackForcedToolUsage(
            toolCallsResponse,
            toolChoice,
            logger,
            'litellm',
            forcedTools,
            usedForcedTools
          )
          hasUsedForcedTool = result.hasUsedForcedTool
          usedForcedTools = result.usedForcedTools
        }
      }

      let currentResponse = await litellm.chat.completions.create(
        payload,
        request.abortSignal ? { signal: request.abortSignal } : undefined
      )
      const firstResponseTime = Date.now() - initialCallTime

      let content = currentResponse.choices[0]?.message?.content || ''

      if (content && request.responseFormat) {
        content = content.replace(/```json\n?|\n?```/g, '').trim()
      }

      const tokens = {
        input: currentResponse.usage?.prompt_tokens || 0,
        output: currentResponse.usage?.completion_tokens || 0,
        total: currentResponse.usage?.total_tokens || 0,
      }
      const toolCalls = []
      const toolResults: Record<string, unknown>[] = []
      const currentMessages = [...formattedMessages]
      let iterationCount = 0

      let modelTime = firstResponseTime
      let toolsTime = 0

      let hasUsedForcedTool = false

      const timeSegments: TimeSegment[] = [
        {
          type: 'model',
          name: request.model,
          startTime: initialCallTime,
          endTime: initialCallTime + firstResponseTime,
          duration: firstResponseTime,
        },
      ]

      checkForForcedToolUsage(currentResponse, originalToolChoice)

      while (iterationCount < MAX_TOOL_ITERATIONS) {
        if (currentResponse.choices[0]?.message?.content) {
          content = currentResponse.choices[0].message.content
          if (request.responseFormat) {
            content = content.replace(/```json\n?|\n?```/g, '').trim()
          }
        }

        const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls

        enrichLastModelSegmentFromChatCompletions(
          timeSegments,
          currentResponse,
          toolCallsInResponse,
          { model: request.model, provider: 'litellm' }
        )

        if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
          break
        }

        logger.info(
          `Processing ${toolCallsInResponse.length} tool calls (iteration ${iterationCount + 1}/${MAX_TOOL_ITERATIONS})`
        )

        const toolsStartTime = Date.now()

        const toolExecutionPromises = toolCallsInResponse.map(async (toolCall) => {
          const toolCallStartTime = Date.now()
          const toolName = toolCall.function.name

          try {
            const toolArgs = toolCall.function.arguments
              ? JSON.parse(toolCall.function.arguments)
              : {}
            const tool = request.tools?.find((t) => t.id === toolName)

            if (!tool) return null

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

        currentMessages.push({
          role: 'assistant',
          content: null,
          tool_calls: toolCallsInResponse.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        })

        const respondedToolCallIds = new Set<string>()

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
            name: toolName,
            content: JSON.stringify(resultContent),
          })
          respondedToolCallIds.add(toolCall.id)
        }

        for (const tc of toolCallsInResponse) {
          if (respondedToolCallIds.has(tc.id)) continue
          currentMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: JSON.stringify({
              error: true,
              message: `Tool "${tc.function.name}" is not available`,
              tool: tc.function.name,
            }),
          })
        }

        const thisToolsTime = Date.now() - toolsStartTime
        toolsTime += thisToolsTime

        const nextPayload = {
          ...payload,
          messages: currentMessages,
        }

        if (typeof originalToolChoice === 'object' && hasUsedForcedTool && forcedTools.length > 0) {
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

        currentResponse = await litellm.chat.completions.create(
          nextPayload,
          request.abortSignal ? { signal: request.abortSignal } : undefined
        )

        checkForForcedToolUsage(currentResponse, nextPayload.tool_choice)

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
          if (request.responseFormat) {
            content = content.replace(/```json\n?|\n?```/g, '').trim()
          }
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
          { model: request.model, provider: 'litellm' }
        )
      }

      if (request.stream) {
        logger.info('Using streaming for final response after tool processing')

        const accumulatedCost = calculateCost(request.model, tokens.input, tokens.output)

        const streamingParams: ChatCompletionCreateParamsStreaming = {
          ...payload,
          messages: currentMessages,
          tool_choice: 'none',
          stream: true,
          stream_options: { include_usage: true },
        }
        if (deferResponseFormat && responseFormatPayload) {
          streamingParams.response_format = responseFormatPayload
          streamingParams.parallel_tool_calls = false
        }
        const streamResponse = await litellm.chat.completions.create(
          streamingParams,
          request.abortSignal ? { signal: request.abortSignal } : undefined
        )

        const streamingResult = {
          stream: createReadableStreamFromLiteLLMStream(streamResponse, (content, usage) => {
            let cleanContent = content
            if (cleanContent && request.responseFormat) {
              cleanContent = cleanContent.replace(/```json\n?|\n?```/g, '').trim()
            }

            streamingResult.execution.output.content = cleanContent
            streamingResult.execution.output.tokens = {
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
            streamingResult.execution.output.cost = {
              input: accumulatedCost.input + streamCost.input,
              output: accumulatedCost.output + streamCost.output,
              toolCost: tc || undefined,
              total: accumulatedCost.total + streamCost.total + tc,
            }
          }),
          execution: {
            success: true,
            output: {
              content: '',
              model: request.model,
              tokens: {
                input: tokens.input,
                output: tokens.output,
                total: tokens.total,
              },
              toolCalls:
                toolCalls.length > 0
                  ? {
                      list: toolCalls,
                      count: toolCalls.length,
                    }
                  : undefined,
              providerTiming: {
                startTime: providerStartTimeISO,
                endTime: new Date().toISOString(),
                duration: Date.now() - providerStartTime,
                modelTime: modelTime,
                toolsTime: toolsTime,
                firstResponseTime: firstResponseTime,
                iterations: iterationCount + 1,
                timeSegments: timeSegments,
              },
              cost: {
                input: accumulatedCost.input,
                output: accumulatedCost.output,
                total: accumulatedCost.total,
              },
            },
            logs: [],
            metadata: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: Date.now() - providerStartTime,
            },
            isStreaming: true,
          },
        } as StreamingExecution

        return streamingResult as StreamingExecution
      }

      if (deferResponseFormat && responseFormatPayload) {
        logger.info('Applying deferred JSON schema response format after tool processing')

        const finalFormatStartTime = Date.now()
        const finalPayload: any = {
          ...payload,
          messages: currentMessages,
          response_format: responseFormatPayload,
          tool_choice: 'none',
          parallel_tool_calls: false,
        }

        currentResponse = await litellm.chat.completions.create(
          finalPayload,
          request.abortSignal ? { signal: request.abortSignal } : undefined
        )

        const finalFormatEndTime = Date.now()
        timeSegments.push({
          type: 'model',
          name: request.model,
          startTime: finalFormatStartTime,
          endTime: finalFormatEndTime,
          duration: finalFormatEndTime - finalFormatStartTime,
        })
        modelTime += finalFormatEndTime - finalFormatStartTime

        const formattedContent = currentResponse.choices[0]?.message?.content
        if (formattedContent) {
          content = formattedContent.replace(/```json\n?|\n?```/g, '').trim()
        }

        if (currentResponse.usage) {
          tokens.input += currentResponse.usage.prompt_tokens || 0
          tokens.output += currentResponse.usage.completion_tokens || 0
          tokens.total += currentResponse.usage.total_tokens || 0
        }

        enrichLastModelSegmentFromChatCompletions(
          timeSegments,
          currentResponse,
          currentResponse.choices[0]?.message?.tool_calls,
          { model: request.model, provider: 'litellm' }
        )
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

      let errorMessage = toError(error).message
      let errorType: string | undefined
      let errorCode: string | number | undefined

      if (error && typeof error === 'object' && 'error' in error) {
        const litellmError = error.error as any
        if (litellmError && typeof litellmError === 'object') {
          errorMessage = litellmError.message || errorMessage
          errorType = litellmError.type
          errorCode = litellmError.code
        }
      }

      logger.error('Error in LiteLLM request:', {
        error: errorMessage,
        errorType,
        errorCode,
        duration: totalDuration,
      })

      throw new ProviderError(errorMessage, {
        startTime: providerStartTimeISO,
        endTime: providerEndTimeISO,
        duration: totalDuration,
      })
    }
  },
}
