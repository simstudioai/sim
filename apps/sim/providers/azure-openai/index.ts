import { AzureOpenAI } from 'openai'
import { env } from '@/lib/core/config/env'
import { createLogger } from '@/lib/logs/console/logger'
import type { StreamingExecution } from '@/executor/types'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/types'
import {
  prepareToolExecution,
  prepareToolsWithUsageControl,
  trackForcedToolUsage,
} from '@/providers/utils'
import { executeTool } from '@/tools'

const logger = createLogger('AzureOpenAIProvider')

/**
 * Determines if the API version uses the Responses API (2025+) or Chat Completions API
 */
function useResponsesApi(apiVersion: string): boolean {
  // 2025-* versions use the Responses API
  // 2024-* and earlier versions use the Chat Completions API
  return apiVersion.startsWith('2025-')
}

/**
 * Helper function to convert an Azure OpenAI Responses API stream to a standard ReadableStream
 * and collect completion metrics
 */
function createReadableStreamFromResponsesApiStream(
  responsesStream: any,
  onComplete?: (content: string, usage?: any) => void
): ReadableStream {
  let fullContent = ''
  let usageData: any = null

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of responsesStream) {
          if (event.usage) {
            usageData = event.usage
          }

          if (event.type === 'response.output_text.delta') {
            const content = event.delta || ''
            if (content) {
              fullContent += content
              controller.enqueue(new TextEncoder().encode(content))
            }
          } else if (event.type === 'response.content_part.delta') {
            const content = event.delta?.text || ''
            if (content) {
              fullContent += content
              controller.enqueue(new TextEncoder().encode(content))
            }
          } else if (event.type === 'response.completed' || event.type === 'response.done') {
            if (event.response?.usage) {
              usageData = event.response.usage
            }
          }
        }

        if (onComplete) {
          onComplete(fullContent, usageData)
        }

        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

/**
 * Helper function to convert an Azure OpenAI stream to a standard ReadableStream
 * and collect completion metrics
 */
function createReadableStreamFromChatCompletionsStream(
  azureOpenAIStream: any,
  onComplete?: (content: string, usage?: any) => void
): ReadableStream {
  let fullContent = ''
  let usageData: any = null

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of azureOpenAIStream) {
          if (chunk.usage) {
            usageData = chunk.usage
          }

          const content = chunk.choices[0]?.delta?.content || ''
          if (content) {
            fullContent += content
            controller.enqueue(new TextEncoder().encode(content))
          }
        }

        if (onComplete) {
          onComplete(fullContent, usageData)
        }

        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

/**
 * Executes a request using the Responses API (for 2025+ API versions)
 */
async function executeWithResponsesApi(
  azureOpenAI: AzureOpenAI,
  request: ProviderRequest,
  deploymentName: string,
  providerStartTime: number,
  providerStartTimeISO: string
): Promise<ProviderResponse | StreamingExecution> {
  const inputMessages: any[] = []

  if (request.context) {
    inputMessages.push({
      role: 'user',
      content: request.context,
    })
  }

  if (request.messages) {
    inputMessages.push(...request.messages)
  }

  const tools = request.tools?.length
    ? request.tools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.id,
          description: tool.description,
          parameters: tool.parameters,
        },
      }))
    : undefined

  const payload: any = {
    model: deploymentName,
    input: inputMessages.length > 0 ? inputMessages : request.systemPrompt || '',
  }

  if (request.systemPrompt) {
    payload.instructions = request.systemPrompt
  }

  if (request.temperature !== undefined) payload.temperature = request.temperature
  if (request.maxTokens !== undefined) payload.max_output_tokens = request.maxTokens

  if (request.reasoningEffort !== undefined) {
    payload.reasoning = { effort: request.reasoningEffort }
  }

  if (request.responseFormat) {
    payload.text = {
      format: {
        type: 'json_schema',
        json_schema: {
          name: request.responseFormat.name || 'response_schema',
          schema: request.responseFormat.schema || request.responseFormat,
          strict: request.responseFormat.strict !== false,
        },
      },
    }
    logger.info('Added JSON schema text format to Responses API request')
  }

  if (tools?.length) {
    payload.tools = tools

    const forcedTools = request.tools?.filter((t) => t.usageControl === 'force') || []
    if (forcedTools.length > 0) {
      if (forcedTools.length === 1) {
        payload.tool_choice = {
          type: 'function',
          function: { name: forcedTools[0].id },
        }
      } else {
        payload.tool_choice = 'required'
      }
    } else {
      payload.tool_choice = 'auto'
    }

    logger.info('Responses API request configuration:', {
      toolCount: tools.length,
      model: deploymentName,
    })
  }

  try {
    if (request.stream && (!tools || tools.length === 0)) {
      logger.info('Using streaming response for Responses API request')

      const streamResponse = await (azureOpenAI as any).responses.create({
        ...payload,
        stream: true,
      })

      const tokenUsage = {
        prompt: 0,
        completion: 0,
        total: 0,
      }

      const streamingResult = {
        stream: createReadableStreamFromResponsesApiStream(streamResponse, (content, usage) => {
          streamingResult.execution.output.content = content

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

          if (usage) {
            streamingResult.execution.output.tokens = {
              prompt: usage.input_tokens || usage.prompt_tokens || 0,
              completion: usage.output_tokens || usage.completion_tokens || 0,
              total:
                (usage.input_tokens || usage.prompt_tokens || 0) +
                (usage.output_tokens || usage.completion_tokens || 0),
            }
          }
        }),
        execution: {
          success: true,
          output: {
            content: '',
            model: request.model,
            tokens: tokenUsage,
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
          },
          logs: [],
          metadata: {
            startTime: providerStartTimeISO,
            endTime: new Date().toISOString(),
            duration: Date.now() - providerStartTime,
          },
        },
      } as StreamingExecution

      return streamingResult
    }

    const initialCallTime = Date.now()
    let currentResponse = await (azureOpenAI as any).responses.create(payload)
    const firstResponseTime = Date.now() - initialCallTime

    let content = currentResponse.output_text || ''

    const tokens = {
      prompt: currentResponse.usage?.input_tokens || 0,
      completion: currentResponse.usage?.output_tokens || 0,
      total:
        (currentResponse.usage?.input_tokens || 0) + (currentResponse.usage?.output_tokens || 0),
    }

    const toolCalls: any[] = []
    const toolResults: any[] = []
    let iterationCount = 0
    const MAX_ITERATIONS = 10

    let modelTime = firstResponseTime
    let toolsTime = 0

    const timeSegments: TimeSegment[] = [
      {
        type: 'model',
        name: 'Initial response',
        startTime: initialCallTime,
        endTime: initialCallTime + firstResponseTime,
        duration: firstResponseTime,
      },
    ]

    while (iterationCount < MAX_ITERATIONS) {
      const toolCallsInResponse =
        currentResponse.output?.filter((item: any) => item.type === 'function_call') || []

      if (toolCallsInResponse.length === 0) {
        break
      }

      logger.info(
        `Processing ${toolCallsInResponse.length} tool calls (iteration ${iterationCount + 1}/${MAX_ITERATIONS})`
      )

      const toolsStartTime = Date.now()

      for (const toolCall of toolCallsInResponse) {
        try {
          const toolName = toolCall.name
          const toolArgs =
            typeof toolCall.arguments === 'string'
              ? JSON.parse(toolCall.arguments)
              : toolCall.arguments

          const tool = request.tools?.find((t) => t.id === toolName)
          if (!tool) continue

          const toolCallStartTime = Date.now()
          const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)

          const result = await executeTool(toolName, executionParams, true)
          const toolCallEndTime = Date.now()
          const toolCallDuration = toolCallEndTime - toolCallStartTime

          timeSegments.push({
            type: 'tool',
            name: toolName,
            startTime: toolCallStartTime,
            endTime: toolCallEndTime,
            duration: toolCallDuration,
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
            startTime: new Date(toolCallStartTime).toISOString(),
            endTime: new Date(toolCallEndTime).toISOString(),
            duration: toolCallDuration,
            result: resultContent,
            success: result.success,
          })

          // Add function call output to input for next request
          inputMessages.push({
            type: 'function_call_output',
            call_id: toolCall.call_id || toolCall.id,
            output: JSON.stringify(resultContent),
          })
        } catch (error) {
          logger.error('Error processing tool call:', {
            error,
            toolName: toolCall?.name,
          })
        }
      }

      const thisToolsTime = Date.now() - toolsStartTime
      toolsTime += thisToolsTime

      // Make the next request
      const nextModelStartTime = Date.now()
      const nextPayload = {
        ...payload,
        input: inputMessages,
        tool_choice: 'auto',
      }

      currentResponse = await (azureOpenAI as any).responses.create(nextPayload)

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

      // Update content
      if (currentResponse.output_text) {
        content = currentResponse.output_text
      }

      // Update token counts
      if (currentResponse.usage) {
        tokens.prompt += currentResponse.usage.input_tokens || 0
        tokens.completion += currentResponse.usage.output_tokens || 0
        tokens.total = tokens.prompt + tokens.completion
      }

      iterationCount++
    }

    // Handle streaming for final response after tool processing
    if (request.stream) {
      logger.info('Using streaming for final response after tool processing (Responses API)')

      const streamingPayload = {
        ...payload,
        input: inputMessages,
        tool_choice: 'auto',
        stream: true,
      }

      const streamResponse = await (azureOpenAI as any).responses.create(streamingPayload)

      const streamingResult = {
        stream: createReadableStreamFromResponsesApiStream(streamResponse, (content, usage) => {
          streamingResult.execution.output.content = content

          if (usage) {
            streamingResult.execution.output.tokens = {
              prompt: usage.input_tokens || tokens.prompt,
              completion: usage.output_tokens || tokens.completion,
              total:
                (usage.input_tokens || tokens.prompt) + (usage.output_tokens || tokens.completion),
            }
          }
        }),
        execution: {
          success: true,
          output: {
            content: '',
            model: request.model,
            tokens: {
              prompt: tokens.prompt,
              completion: tokens.completion,
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
          },
          logs: [],
          metadata: {
            startTime: providerStartTimeISO,
            endTime: new Date().toISOString(),
            duration: Date.now() - providerStartTime,
          },
        },
      } as StreamingExecution

      return streamingResult
    }

    // Calculate overall timing
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

    logger.error('Error in Responses API request:', {
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
    logger.info('Preparing Azure OpenAI request', {
      model: request.model || 'azure/gpt-4o',
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.messages?.length,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      stream: !!request.stream,
    })

    // Extract Azure-specific configuration from request or environment
    // Priority: request parameters > environment variables
    const azureEndpoint = request.azureEndpoint || env.AZURE_OPENAI_ENDPOINT
    const azureApiVersion = request.azureApiVersion || env.AZURE_OPENAI_API_VERSION || '2024-10-21'

    if (!azureEndpoint) {
      throw new Error(
        'Azure OpenAI endpoint is required. Please provide it via azureEndpoint parameter or AZURE_OPENAI_ENDPOINT environment variable.'
      )
    }

    // API key is now handled server-side before this function is called
    const azureOpenAI = new AzureOpenAI({
      apiKey: request.apiKey,
      apiVersion: azureApiVersion,
      endpoint: azureEndpoint,
    })

    // Build deployment name - use deployment name instead of model name
    const deploymentName = (request.model || 'azure/gpt-4o').replace('azure/', '')

    // Start execution timer for the entire provider execution
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    // Check if we should use the Responses API (2025+ versions)
    if (useResponsesApi(azureApiVersion)) {
      logger.info('Using Responses API for Azure OpenAI request', {
        apiVersion: azureApiVersion,
        model: deploymentName,
      })
      return executeWithResponsesApi(
        azureOpenAI,
        request,
        deploymentName,
        providerStartTime,
        providerStartTimeISO
      )
    }

    // Continue with Chat Completions API for 2024 and earlier versions
    logger.info('Using Chat Completions API for Azure OpenAI request', {
      apiVersion: azureApiVersion,
      model: deploymentName,
    })

    // Start with an empty array for all messages
    const allMessages = []

    // Add system prompt if present
    if (request.systemPrompt) {
      allMessages.push({
        role: 'system',
        content: request.systemPrompt,
      })
    }

    // Add context if present
    if (request.context) {
      allMessages.push({
        role: 'user',
        content: request.context,
      })
    }

    // Add remaining messages
    if (request.messages) {
      allMessages.push(...request.messages)
    }

    // Transform tools to Azure OpenAI format if provided
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

    // Build the request payload
    const payload: any = {
      model: deploymentName, // Azure OpenAI uses deployment name
      messages: allMessages,
    }

    // Add optional parameters
    if (request.temperature !== undefined) payload.temperature = request.temperature
    if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

    // Add GPT-5 specific parameters
    if (request.reasoningEffort !== undefined) payload.reasoning_effort = request.reasoningEffort
    if (request.verbosity !== undefined) payload.verbosity = request.verbosity

    // Add response format for structured output if specified
    if (request.responseFormat) {
      // Use Azure OpenAI's JSON schema format
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

    // Handle tools and tool usage control
    let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null

    if (tools?.length) {
      preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'azure-openai')
      const { tools: filteredTools, toolChoice } = preparedTools

      if (filteredTools?.length && toolChoice) {
        payload.tools = filteredTools
        payload.tool_choice = toolChoice

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

    try {
      if (request.stream && (!tools || tools.length === 0)) {
        logger.info('Using streaming response for Azure OpenAI request')

        const streamResponse = await azureOpenAI.chat.completions.create({
          ...payload,
          stream: true,
          stream_options: { include_usage: true },
        })

        const tokenUsage = {
          prompt: 0,
          completion: 0,
          total: 0,
        }

        let _streamContent = ''

        const streamingResult = {
          stream: createReadableStreamFromChatCompletionsStream(
            streamResponse,
            (content, usage) => {
              _streamContent = content
              streamingResult.execution.output.content = content

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

              if (usage) {
                const newTokens = {
                  prompt: usage.prompt_tokens || tokenUsage.prompt,
                  completion: usage.completion_tokens || tokenUsage.completion,
                  total: usage.total_tokens || tokenUsage.total,
                }

                streamingResult.execution.output.tokens = newTokens
              }
            }
          ),
          execution: {
            success: true,
            output: {
              content: '',
              model: request.model,
              tokens: tokenUsage,
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
            'azure-openai',
            forcedTools,
            usedForcedTools
          )
          hasUsedForcedTool = result.hasUsedForcedTool
          usedForcedTools = result.usedForcedTools
        }
      }

      let currentResponse = await azureOpenAI.chat.completions.create(payload)
      const firstResponseTime = Date.now() - initialCallTime

      let content = currentResponse.choices[0]?.message?.content || ''
      const tokens = {
        prompt: currentResponse.usage?.prompt_tokens || 0,
        completion: currentResponse.usage?.completion_tokens || 0,
        total: currentResponse.usage?.total_tokens || 0,
      }
      const toolCalls = []
      const toolResults = []
      const currentMessages = [...allMessages]
      let iterationCount = 0
      const MAX_ITERATIONS = 10

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

      while (iterationCount < MAX_ITERATIONS) {
        const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls
        if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
          break
        }

        logger.info(
          `Processing ${toolCallsInResponse.length} tool calls (iteration ${iterationCount + 1}/${MAX_ITERATIONS})`
        )

        const toolsStartTime = Date.now()

        for (const toolCall of toolCallsInResponse) {
          try {
            const toolName = toolCall.function.name
            const toolArgs = JSON.parse(toolCall.function.arguments)

            const tool = request.tools?.find((t) => t.id === toolName)
            if (!tool) continue

            const toolCallStartTime = Date.now()

            const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)

            const result = await executeTool(toolName, executionParams, true)
            const toolCallEndTime = Date.now()
            const toolCallDuration = toolCallEndTime - toolCallStartTime

            timeSegments.push({
              type: 'tool',
              name: toolName,
              startTime: toolCallStartTime,
              endTime: toolCallEndTime,
              duration: toolCallDuration,
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
              startTime: new Date(toolCallStartTime).toISOString(),
              endTime: new Date(toolCallEndTime).toISOString(),
              duration: toolCallDuration,
              result: resultContent,
              success: result.success,
            })

            currentMessages.push({
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: toolCall.id,
                  type: 'function',
                  function: {
                    name: toolName,
                    arguments: toolCall.function.arguments,
                  },
                },
              ],
            })

            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(resultContent),
            })
          } catch (error) {
            logger.error('Error processing tool call:', {
              error,
              toolName: toolCall?.function?.name,
            })
          }
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

        currentResponse = await azureOpenAI.chat.completions.create(nextPayload)

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
        }

        if (currentResponse.usage) {
          tokens.prompt += currentResponse.usage.prompt_tokens || 0
          tokens.completion += currentResponse.usage.completion_tokens || 0
          tokens.total += currentResponse.usage.total_tokens || 0
        }

        iterationCount++
      }

      if (request.stream) {
        logger.info('Using streaming for final response after tool processing')

        const streamingPayload = {
          ...payload,
          messages: currentMessages,
          tool_choice: 'auto',
          stream: true,
          stream_options: { include_usage: true },
        }

        const streamResponse = await azureOpenAI.chat.completions.create(streamingPayload)

        let _streamContent = ''

        const streamingResult = {
          stream: createReadableStreamFromChatCompletionsStream(
            streamResponse,
            (content, usage) => {
              _streamContent = content
              streamingResult.execution.output.content = content

              if (usage) {
                const newTokens = {
                  prompt: usage.prompt_tokens || tokens.prompt,
                  completion: usage.completion_tokens || tokens.completion,
                  total: usage.total_tokens || tokens.total,
                }

                streamingResult.execution.output.tokens = newTokens
              }
            }
          ),
          execution: {
            success: true,
            output: {
              content: '',
              model: request.model,
              tokens: {
                prompt: tokens.prompt,
                completion: tokens.completion,
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
              // Cost will be calculated in logger
            },
            logs: [], // No block logs at provider level
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

      logger.error('Error in Azure OpenAI request:', {
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
  },
}
