import { createLogger } from '@sim/logger'
import { AzureOpenAI } from 'openai'
import type {
  ChatCompletion,
  ChatCompletionCreateParamsBase,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from 'openai/resources/chat/completions'
import type { ReasoningEffort } from 'openai/resources/shared'
import { env } from '@/lib/core/config/env'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import {
  checkForForcedToolUsage,
  createReadableStreamFromAzureOpenAIStream,
  extractApiVersionFromUrl,
  extractBaseUrl,
  extractDeploymentFromUrl,
  isChatCompletionsEndpoint,
  isResponsesEndpoint,
} from '@/providers/azure-openai/utils'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import { executeResponsesProviderRequest } from '@/providers/openai/core'
import type {
  FunctionCallResponse,
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/types'
import {
  calculateCost,
  prepareToolExecution,
  prepareToolsWithUsageControl,
} from '@/providers/utils'
import { executeTool } from '@/tools'

const logger = createLogger('AzureOpenAIProvider')

/**
 * Executes a request using the chat completions API.
 * Used when the endpoint URL indicates chat completions.
 */
async function executeChatCompletionsRequest(
  request: ProviderRequest,
  azureEndpoint: string,
  azureApiVersion: string,
  deploymentName: string
): Promise<ProviderResponse | StreamingExecution> {
  logger.info('Using Azure OpenAI Chat Completions API', {
    model: request.model,
    endpoint: azureEndpoint,
    deploymentName,
    apiVersion: azureApiVersion,
    hasSystemPrompt: !!request.systemPrompt,
    hasMessages: !!request.messages?.length,
    hasTools: !!request.tools?.length,
    toolCount: request.tools?.length || 0,
    hasResponseFormat: !!request.responseFormat,
    stream: !!request.stream,
  })

  const azureOpenAI = new AzureOpenAI({
    apiKey: request.apiKey,
    apiVersion: azureApiVersion,
    endpoint: azureEndpoint,
  })

  const allMessages: ChatCompletionMessageParam[] = []

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
    allMessages.push(...(request.messages as ChatCompletionMessageParam[]))
  }

  const tools: ChatCompletionTool[] | undefined = request.tools?.length
    ? request.tools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.id,
          description: tool.description,
          parameters: tool.parameters,
        },
      }))
    : undefined

  const payload: ChatCompletionCreateParamsBase & { verbosity?: string } = {
    model: deploymentName,
    messages: allMessages,
  }

  if (request.temperature !== undefined) payload.temperature = request.temperature
  if (request.maxTokens != null) payload.max_completion_tokens = request.maxTokens

  if (request.reasoningEffort !== undefined && request.reasoningEffort !== 'auto')
    payload.reasoning_effort = request.reasoningEffort as ReasoningEffort
  if (request.verbosity !== undefined && request.verbosity !== 'auto')
    payload.verbosity = request.verbosity

  if (request.responseFormat) {
    payload.response_format = {
      type: 'json_schema',
      json_schema: {
        name: request.responseFormat.name || 'response_schema',
        schema: request.responseFormat.schema || request.responseFormat,
        strict: request.responseFormat.strict !== false,
      },
    }

    logger.info('Added JSON schema response format to Azure OpenAI request')
  }

  let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null

  if (tools?.length) {
    preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'azure-openai')
    const { tools: filteredTools, toolChoice } = preparedTools

    if (filteredTools?.length && toolChoice) {
      payload.tools = filteredTools as ChatCompletionTool[]
      payload.tool_choice = toolChoice as ChatCompletionToolChoiceOption

      logger.info('Azure OpenAI request configuration:', {
        toolCount: filteredTools.length,
        toolChoice:
          typeof toolChoice === 'string'
            ? toolChoice
            : toolChoice.type === 'function'
              ? `force:${toolChoice.function.name}`
              : toolChoice.type === 'tool'
                ? `force:${toolChoice.name}`
                : toolChoice.type === 'any'
                  ? `force:${toolChoice.any?.name || 'unknown'}`
                  : 'unknown',
        model: deploymentName,
      })
    }
  }

  const providerStartTime = Date.now()
  const providerStartTimeISO = new Date(providerStartTime).toISOString()

  try {
    if (request.stream && (!tools || tools.length === 0)) {
      logger.info('Using streaming response for Azure OpenAI request')

      const streamingParams: ChatCompletionCreateParamsStreaming = {
        ...payload,
        stream: true,
        stream_options: { include_usage: true },
      }
      const streamResponse = await azureOpenAI.chat.completions.create(streamingParams)

      const streamingResult = {
        stream: createReadableStreamFromAzureOpenAIStream(streamResponse, (content, usage) => {
          streamingResult.execution.output.content = content
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

    let currentResponse = (await azureOpenAI.chat.completions.create(payload)) as ChatCompletion
    const firstResponseTime = Date.now() - initialCallTime

    let content = currentResponse.choices[0]?.message?.content || ''
    const tokens = {
      input: currentResponse.usage?.prompt_tokens || 0,
      output: currentResponse.usage?.completion_tokens || 0,
      total: currentResponse.usage?.total_tokens || 0,
    }
    const toolCalls: (FunctionCallResponse & { success: boolean })[] = []
    const toolResults: Record<string, unknown>[] = []
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

    const firstCheckResult = checkForForcedToolUsage(
      currentResponse,
      originalToolChoice ?? 'auto',
      logger,
      forcedTools,
      usedForcedTools
    )
    hasUsedForcedTool = firstCheckResult.hasUsedForcedTool
    usedForcedTools = firstCheckResult.usedForcedTools

    while (iterationCount < MAX_TOOL_ITERATIONS) {
      if (currentResponse.choices[0]?.message?.content) {
        content = currentResponse.choices[0].message.content
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

        let resultContent: Record<string, unknown>
        if (result.success) {
          toolResults.push(result.output as Record<string, unknown>)
          resultContent = result.output as Record<string, unknown>
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
      currentResponse = (await azureOpenAI.chat.completions.create(nextPayload)) as ChatCompletion

      const nextCheckResult = checkForForcedToolUsage(
        currentResponse,
        nextPayload.tool_choice ?? 'auto',
        logger,
        forcedTools,
        usedForcedTools
      )
      hasUsedForcedTool = nextCheckResult.hasUsedForcedTool
      usedForcedTools = nextCheckResult.usedForcedTools

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
      logger.info('Using streaming for final response after tool processing')

      const accumulatedCost = calculateCost(request.model, tokens.input, tokens.output)

      const streamingParams: ChatCompletionCreateParamsStreaming = {
        ...payload,
        messages: currentMessages,
        tool_choice: 'auto',
        stream: true,
        stream_options: { include_usage: true },
      }
      const streamResponse = await azureOpenAI.chat.completions.create(streamingParams)

      const streamingResult = {
        stream: createReadableStreamFromAzureOpenAIStream(streamResponse, (content, usage) => {
          streamingResult.execution.output.content = content
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

          const streamEndTime = Date.now()
          const streamEndTimeISO = new Date(streamEndTime).toISOString()

          if (streamingResult.execution.output.providerTiming) {
            streamingResult.execution.output.providerTiming.endTime = streamEndTimeISO
            streamingResult.execution.output.providerTiming.duration =
              streamEndTime - providerStartTime
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

    logger.error('Error in Azure OpenAI chat completions request:', {
      error,
      duration: totalDuration,
    })

    const enhancedError = new Error(error instanceof Error ? error.message : String(error))
    // @ts-ignore - Adding timing property to the error
    enhancedError.timing = {
      startTime: providerStartTimeISO,
      endTime: providerEndTimeISO,
      duration: totalDuration,
    }

    throw enhancedError
  }
}

/**
 * Azure OpenAI provider configuration
 */
export const azureOpenAIProvider: ProviderConfig = {
  id: 'azure-openai',
  name: 'Azure OpenAI',
  description: 'Microsoft Azure OpenAI Service models',
  version: '1.0.0',
  models: getProviderModels('azure-openai'),
  defaultModel: getProviderDefaultModel('azure-openai'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    const azureEndpoint = request.azureEndpoint || env.AZURE_OPENAI_ENDPOINT

    if (!azureEndpoint) {
      throw new Error(
        'Azure OpenAI endpoint is required. Please provide it via azureEndpoint parameter or AZURE_OPENAI_ENDPOINT environment variable.'
      )
    }

    if (!request.apiKey) {
      throw new Error('API key is required for Azure OpenAI')
    }

    // Check if the endpoint is a full chat completions URL
    if (isChatCompletionsEndpoint(azureEndpoint)) {
      logger.info('Detected chat completions endpoint URL')

      // Extract the base URL for the SDK (it needs just the host, not the full path)
      const baseUrl = extractBaseUrl(azureEndpoint)

      // Try to extract deployment from URL, fall back to model name
      const urlDeployment = extractDeploymentFromUrl(azureEndpoint)
      const deploymentName = urlDeployment || request.model.replace('azure/', '')

      // Try to extract api-version from URL, fall back to request param or env or default
      const urlApiVersion = extractApiVersionFromUrl(azureEndpoint)
      const azureApiVersion =
        urlApiVersion ||
        request.azureApiVersion ||
        env.AZURE_OPENAI_API_VERSION ||
        '2024-07-01-preview'

      logger.info('Chat completions configuration:', {
        originalEndpoint: azureEndpoint,
        baseUrl,
        deploymentName,
        apiVersion: azureApiVersion,
      })

      return executeChatCompletionsRequest(request, baseUrl, azureApiVersion, deploymentName)
    }

    // Check if the endpoint is already a full responses API URL
    if (isResponsesEndpoint(azureEndpoint)) {
      logger.info('Detected full responses endpoint URL, using it directly')

      const deploymentName = request.model.replace('azure/', '')

      // Use the URL as-is since it's already complete
      return executeResponsesProviderRequest(request, {
        providerId: 'azure-openai',
        providerLabel: 'Azure OpenAI',
        modelName: deploymentName,
        endpoint: azureEndpoint,
        headers: {
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'responses=v1',
          'api-key': request.apiKey,
        },
        logger,
      })
    }

    // Default: base URL provided, construct the responses API URL
    logger.info('Using base endpoint, constructing Responses API URL')
    const azureApiVersion =
      request.azureApiVersion || env.AZURE_OPENAI_API_VERSION || '2024-07-01-preview'
    const deploymentName = request.model.replace('azure/', '')
    const apiUrl = `${azureEndpoint.replace(/\/$/, '')}/openai/v1/responses?api-version=${azureApiVersion}`

    return executeResponsesProviderRequest(request, {
      providerId: 'azure-openai',
      providerLabel: 'Azure OpenAI',
      modelName: deploymentName,
      endpoint: apiUrl,
      headers: {
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'responses=v1',
        'api-key': request.apiKey,
      },
      logger,
    })
  },
}
