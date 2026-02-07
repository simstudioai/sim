import { createLogger } from '@sim/logger'
import OpenAI from 'openai'
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import {
  checkForForcedToolUsage,
  createReadableStreamFromOpenAIStream,
  supportsNativeStructuredOutputs,
} from '@/providers/openrouter/utils'
import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/types'
import {
  calculateCost,
  generateSchemaInstructions,
  prepareToolExecution,
  prepareToolsWithUsageControl,
} from '@/providers/utils'
import { executeTool } from '@/tools'

const logger = createLogger('OpenRouterProvider')

/**
 * Applies structured output configuration to a payload based on model capabilities.
 * Uses json_schema with require_parameters for supported models, falls back to json_object with prompt instructions.
 */
async function applyResponseFormat(
  targetPayload: any,
  messages: any[],
  responseFormat: any,
  model: string
): Promise<any[]> {
  const useNative = await supportsNativeStructuredOutputs(model)

  if (useNative) {
    logger.info('Using native structured outputs for OpenRouter model', { model })
    targetPayload.response_format = {
      type: 'json_schema',
      json_schema: {
        name: responseFormat.name || 'response_schema',
        schema: responseFormat.schema || responseFormat,
        strict: responseFormat.strict !== false,
      },
    }
    targetPayload.provider = { ...targetPayload.provider, require_parameters: true }
    return messages
  }

  logger.info('Using json_object mode with prompt instructions for OpenRouter model', { model })
  const schema = responseFormat.schema || responseFormat
  const schemaInstructions = generateSchemaInstructions(schema, responseFormat.name)
  targetPayload.response_format = { type: 'json_object' }
  return [...messages, { role: 'user', content: schemaInstructions }]
}

export const openRouterProvider: ProviderConfig = {
  id: 'openrouter',
  name: 'OpenRouter',
  description: 'Unified access to many models via OpenRouter',
  version: '1.0.0',
  models: getProviderModels('openrouter'),
  defaultModel: getProviderDefaultModel('openrouter'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for OpenRouter')
    }

    const client = new OpenAI({
      apiKey: request.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    })

    const requestedModel = request.model.replace(/^openrouter\//, '')

    logger.info('Preparing OpenRouter request', {
      model: requestedModel,
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.messages?.length,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      stream: !!request.stream,
    })

    const allMessages = [] as any[]

    if (request.systemPrompt) {
      allMessages.push({ role: 'system', content: request.systemPrompt })
    }

    if (request.context) {
      allMessages.push({ role: 'user', content: request.context })
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
      model: requestedModel,
      messages: allMessages,
    }

    if (request.temperature !== undefined) payload.temperature = request.temperature
    if (request.maxTokens != null) payload.max_tokens = request.maxTokens

    let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null
    let hasActiveTools = false
    if (tools?.length) {
      preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'openrouter')
      const { tools: filteredTools, toolChoice } = preparedTools
      if (filteredTools?.length && toolChoice) {
        payload.tools = filteredTools
        payload.tool_choice = toolChoice
        hasActiveTools = true
      }
    }

    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      if (request.responseFormat && !hasActiveTools) {
        payload.messages = await applyResponseFormat(
          payload,
          payload.messages,
          request.responseFormat,
          requestedModel
        )
      }

      if (request.stream && (!tools || tools.length === 0 || !hasActiveTools)) {
        const streamingParams: ChatCompletionCreateParamsStreaming = {
          ...payload,
          stream: true,
          stream_options: { include_usage: true },
        }
        const streamResponse = await client.chat.completions.create(streamingParams)

        const streamingResult = {
          stream: createReadableStreamFromOpenAIStream(streamResponse, (content, usage) => {
            streamingResult.execution.output.content = content
            streamingResult.execution.output.tokens = {
              input: usage.prompt_tokens,
              output: usage.completion_tokens,
              total: usage.total_tokens,
            }

            const costResult = calculateCost(
              requestedModel,
              usage.prompt_tokens,
              usage.completion_tokens
            )
            streamingResult.execution.output.cost = {
              input: costResult.input,
              output: costResult.output,
              total: costResult.total,
            }

            const end = Date.now()
            const endISO = new Date(end).toISOString()
            if (streamingResult.execution.output.providerTiming) {
              streamingResult.execution.output.providerTiming.endTime = endISO
              streamingResult.execution.output.providerTiming.duration = end - providerStartTime
              if (streamingResult.execution.output.providerTiming.timeSegments?.[0]) {
                streamingResult.execution.output.providerTiming.timeSegments[0].endTime = end
                streamingResult.execution.output.providerTiming.timeSegments[0].duration =
                  end - providerStartTime
              }
            }
          }),
          execution: {
            success: true,
            output: {
              content: '',
              model: requestedModel,
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

      let currentResponse = await client.chat.completions.create(payload)
      const firstResponseTime = Date.now() - initialCallTime

      let content = currentResponse.choices[0]?.message?.content || ''
      const tokens = {
        input: currentResponse.usage?.prompt_tokens || 0,
        output: currentResponse.usage?.completion_tokens || 0,
        total: currentResponse.usage?.total_tokens || 0,
      }
      const toolCalls = [] as any[]
      const toolResults = [] as any[]
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

      const forcedToolResult = checkForForcedToolUsage(
        currentResponse,
        originalToolChoice,
        forcedTools,
        usedForcedTools
      )
      hasUsedForcedTool = forcedToolResult.hasUsedForcedTool
      usedForcedTools = forcedToolResult.usedForcedTools

      while (iterationCount < MAX_TOOL_ITERATIONS) {
        if (currentResponse.choices[0]?.message?.content) {
          content = currentResponse.choices[0].message.content
        }

        const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls
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
            logger.error('Error processing tool call (OpenRouter):', {
              error: error instanceof Error ? error.message : String(error),
              toolName,
            })

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
            nextPayload.tool_choice = { type: 'function', function: { name: remainingTools[0] } }
          } else {
            nextPayload.tool_choice = 'auto'
          }
        }

        const nextModelStartTime = Date.now()
        currentResponse = await client.chat.completions.create(nextPayload)
        const nextForcedToolResult = checkForForcedToolUsage(
          currentResponse,
          nextPayload.tool_choice,
          forcedTools,
          usedForcedTools
        )
        hasUsedForcedTool = nextForcedToolResult.hasUsedForcedTool
        usedForcedTools = nextForcedToolResult.usedForcedTools
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
        }
        if (currentResponse.usage) {
          tokens.input += currentResponse.usage.prompt_tokens || 0
          tokens.output += currentResponse.usage.completion_tokens || 0
          tokens.total += currentResponse.usage.total_tokens || 0
        }
        iterationCount++
      }

      if (request.stream) {
        const accumulatedCost = calculateCost(requestedModel, tokens.input, tokens.output)

        const streamingParams: ChatCompletionCreateParamsStreaming & { provider?: any } = {
          ...payload,
          messages: [...currentMessages],
          tool_choice: 'auto',
          stream: true,
          stream_options: { include_usage: true },
        }

        if (request.responseFormat) {
          ;(streamingParams as any).messages = await applyResponseFormat(
            streamingParams as any,
            streamingParams.messages,
            request.responseFormat,
            requestedModel
          )
        }

        const streamResponse = await client.chat.completions.create(streamingParams)

        const streamingResult = {
          stream: createReadableStreamFromOpenAIStream(streamResponse, (content, usage) => {
            streamingResult.execution.output.content = content
            streamingResult.execution.output.tokens = {
              input: tokens.input + usage.prompt_tokens,
              output: tokens.output + usage.completion_tokens,
              total: tokens.total + usage.total_tokens,
            }

            const streamCost = calculateCost(
              requestedModel,
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
              model: requestedModel,
              tokens: { input: tokens.input, output: tokens.output, total: tokens.total },
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

      if (request.responseFormat && hasActiveTools) {
        const finalPayload: any = {
          model: payload.model,
          messages: [...currentMessages],
        }
        if (payload.temperature !== undefined) {
          finalPayload.temperature = payload.temperature
        }
        if (payload.max_tokens !== undefined) {
          finalPayload.max_tokens = payload.max_tokens
        }

        finalPayload.messages = await applyResponseFormat(
          finalPayload,
          finalPayload.messages,
          request.responseFormat,
          requestedModel
        )

        const finalStartTime = Date.now()
        const finalResponse = await client.chat.completions.create(finalPayload)
        const finalEndTime = Date.now()
        const finalDuration = finalEndTime - finalStartTime

        timeSegments.push({
          type: 'model',
          name: 'Final structured response',
          startTime: finalStartTime,
          endTime: finalEndTime,
          duration: finalDuration,
        })
        modelTime += finalDuration

        if (finalResponse.choices[0]?.message?.content) {
          content = finalResponse.choices[0].message.content
        }
        if (finalResponse.usage) {
          tokens.input += finalResponse.usage.prompt_tokens || 0
          tokens.output += finalResponse.usage.completion_tokens || 0
          tokens.total += finalResponse.usage.total_tokens || 0
        }
      }

      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      return {
        content,
        model: requestedModel,
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

      const errorDetails: Record<string, any> = {
        error: error instanceof Error ? error.message : String(error),
        duration: totalDuration,
      }
      if (error && typeof error === 'object') {
        const err = error as any
        if (err.status) errorDetails.status = err.status
        if (err.code) errorDetails.code = err.code
        if (err.type) errorDetails.type = err.type
        if (err.error?.message) errorDetails.providerMessage = err.error.message
        if (err.error?.metadata) errorDetails.metadata = err.error.metadata
      }

      logger.error('Error in OpenRouter request:', errorDetails)
      const enhancedError = new Error(error instanceof Error ? error.message : String(error))
      // @ts-ignore
      enhancedError.timing = {
        startTime: providerStartTimeISO,
        endTime: providerEndTimeISO,
        duration: totalDuration,
      }
      throw enhancedError
    }
  },
}
