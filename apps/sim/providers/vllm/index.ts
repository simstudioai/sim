import { createLogger } from '@sim/logger'
import OpenAI from 'openai'
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions'
import { env } from '@/lib/core/config/env'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/types'
import {
  calculateCost,
  prepareToolExecution,
  prepareToolsWithUsageControl,
  trackForcedToolUsage,
} from '@/providers/utils'
import { createReadableStreamFromVLLMStream } from '@/providers/vllm/utils'
import { useProvidersStore } from '@/stores/providers'
import { executeTool } from '@/tools'

const logger = createLogger('VLLMProvider')
const VLLM_VERSION = '1.0.0'

export const vllmProvider: ProviderConfig = {
  id: 'vllm',
  name: 'vLLM',
  description: 'Self-hosted vLLM with OpenAI-compatible API',
  version: VLLM_VERSION,
  models: getProviderModels('vllm'),
  defaultModel: getProviderDefaultModel('vllm'),

  async initialize() {
    if (typeof window !== 'undefined') {
      logger.info('Skipping vLLM initialization on client side to avoid CORS issues')
      return
    }

    const baseUrl = (env.VLLM_BASE_URL || '').replace(/\/$/, '')
    if (!baseUrl) {
      logger.info('VLLM_BASE_URL not configured, skipping initialization')
      return
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (env.VLLM_API_KEY) {
        headers.Authorization = `Bearer ${env.VLLM_API_KEY}`
      }

      const response = await fetch(`${baseUrl}/v1/models`, { headers })
      if (!response.ok) {
        useProvidersStore.getState().setProviderModels('vllm', [])
        logger.warn('vLLM service is not available. The provider will be disabled.')
        return
      }

      const data = (await response.json()) as { data: Array<{ id: string }> }
      const models = data.data.map((model) => `vllm/${model.id}`)

      this.models = models
      useProvidersStore.getState().setProviderModels('vllm', models)

      logger.info(`Discovered ${models.length} vLLM model(s):`, { models })
    } catch (error) {
      logger.warn('vLLM model instantiation failed. The provider will be disabled.', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  },

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    logger.info('Preparing vLLM request', {
      model: request.model,
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.messages?.length,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      stream: !!request.stream,
    })

    const baseUrl = (request.azureEndpoint || env.VLLM_BASE_URL || '').replace(/\/$/, '')
    if (!baseUrl) {
      throw new Error('VLLM_BASE_URL is required for vLLM provider')
    }

    const apiKey = request.apiKey || env.VLLM_API_KEY || 'empty'
    const vllm = new OpenAI({
      apiKey,
      baseURL: `${baseUrl}/v1`,
    })

    const allMessages = [] as any[]

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
      model: request.model.replace(/^vllm\//, ''),
      messages: allMessages,
    }

    if (request.temperature !== undefined) payload.temperature = request.temperature
    if (request.maxTokens != null) payload.max_completion_tokens = request.maxTokens

    if (request.responseFormat) {
      payload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: request.responseFormat.name || 'response_schema',
          schema: request.responseFormat.schema || request.responseFormat,
          strict: request.responseFormat.strict !== false,
        },
      }

      logger.info('Added JSON schema response format to vLLM request')
    }

    let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null
    let hasActiveTools = false

    if (tools?.length) {
      preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'vllm')
      const { tools: filteredTools, toolChoice } = preparedTools

      if (filteredTools?.length && toolChoice) {
        payload.tools = filteredTools
        payload.tool_choice = toolChoice
        hasActiveTools = true

        logger.info('vLLM request configuration:', {
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

    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      if (request.stream && (!tools || tools.length === 0 || !hasActiveTools)) {
        logger.info('Using streaming response for vLLM request')

        const streamingParams: ChatCompletionCreateParamsStreaming = {
          ...payload,
          stream: true,
          stream_options: { include_usage: true },
        }
        const streamResponse = await vllm.chat.completions.create(streamingParams)

        const streamingResult = {
          stream: createReadableStreamFromVLLMStream(streamResponse, (content, usage) => {
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
                    name: 'Streaming response',
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
            'vllm',
            forcedTools,
            usedForcedTools
          )
          hasUsedForcedTool = result.hasUsedForcedTool
          usedForcedTools = result.usedForcedTools
        }
      }

      let currentResponse = await vllm.chat.completions.create(payload)
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
      const toolResults = []
      const currentMessages = [...allMessages]
      let iterationCount = 0

      let modelTime = firstResponseTime
      let toolsTime = 0

      let hasUsedForcedTool = false

      const timeSegments: TimeSegment[] = [
        {
          type: 'model',
          name: 'Initial response',
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
            const toolArgs = JSON.parse(toolCall.function.arguments)
            const tool = request.tools?.find((t) => t.id === toolName)

            if (!tool) return null

            const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)
            const result = await executeTool(toolName, executionParams)
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
                error: error instanceof Error ? error.message : 'Tool execution failed',
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
          })

          let resultContent: any
          if (result.success) {
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

        currentResponse = await vllm.chat.completions.create(nextPayload)

        checkForForcedToolUsage(currentResponse, nextPayload.tool_choice)

        const nextModelEndTime = Date.now()
        const thisModelTime = nextModelEndTime - nextModelStartTime

        timeSegments.push({
          type: 'model',
          name: `Model response (iteration ${iterationCount + 1})`,
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

      if (request.stream) {
        logger.info('Using streaming for final response after tool processing')

        const accumulatedCost = calculateCost(request.model, tokens.input, tokens.output)

        const streamingParams: ChatCompletionCreateParamsStreaming = {
          ...payload,
          messages: currentMessages,
          tool_choice: 'auto',
          stream: true,
          stream_options: { include_usage: true },
        }
        const streamResponse = await vllm.chat.completions.create(streamingParams)

        const streamingResult = {
          stream: createReadableStreamFromVLLMStream(streamResponse, (content, usage) => {
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
            streamingResult.execution.output.cost = {
              input: accumulatedCost.input + streamCost.input,
              output: accumulatedCost.output + streamCost.output,
              total: accumulatedCost.total + streamCost.total,
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
          },
        } as StreamingExecution

        return streamingResult as StreamingExecution
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

      let errorMessage = error instanceof Error ? error.message : String(error)
      let errorType: string | undefined
      let errorCode: number | undefined

      if (error && typeof error === 'object' && 'error' in error) {
        const vllmError = error.error as any
        if (vllmError && typeof vllmError === 'object') {
          errorMessage = vllmError.message || errorMessage
          errorType = vllmError.type
          errorCode = vllmError.code
        }
      }

      logger.error('Error in vLLM request:', {
        error: errorMessage,
        errorType,
        errorCode,
        duration: totalDuration,
      })

      const enhancedError = new Error(errorMessage)
      // @ts-ignore
      enhancedError.timing = {
        startTime: providerStartTimeISO,
        endTime: providerEndTimeISO,
        duration: totalDuration,
      }
      if (errorType) {
        // @ts-ignore
        enhancedError.vllmErrorType = errorType
      }
      if (errorCode) {
        // @ts-ignore
        enhancedError.vllmErrorCode = errorCode
      }

      throw enhancedError
    }
  },
}
