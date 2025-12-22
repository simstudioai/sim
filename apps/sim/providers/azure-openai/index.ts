import { AzureOpenAI } from 'openai'
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions'
import { env } from '@/lib/core/config/env'
import { createLogger } from '@/lib/logs/console/logger'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import {
  checkForForcedToolUsage,
  createReadableStreamFromAzureOpenAIStream,
} from '@/providers/azure-openai/utils'
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
} from '@/providers/utils'
import { executeTool } from '@/tools'

const logger = createLogger('AzureOpenAIProvider')

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
    const azureApiVersion =
      request.azureApiVersion || env.AZURE_OPENAI_API_VERSION || '2024-07-01-preview'

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

    // Build the request payload - use deployment name instead of model name
    const deploymentName = (request.model || 'azure/gpt-4o').replace('azure/', '')
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

    // Start execution timer for the entire provider execution
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      // Check if we can stream directly (no tools required)
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
              prompt: usage.prompt_tokens,
              completion: usage.completion_tokens,
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
              tokens: { prompt: 0, completion: 0, total: 0 },
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

        // Return the streaming execution object with explicit casting
        return streamingResult as StreamingExecution
      }

      // Make the initial API request
      const initialCallTime = Date.now()

      // Track the original tool_choice for forced tool tracking
      const originalToolChoice = payload.tool_choice

      // Track forced tools and their usage
      const forcedTools = preparedTools?.forcedTools || []
      let usedForcedTools: string[] = []

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

      // Track time spent in model vs tools
      let modelTime = firstResponseTime
      let toolsTime = 0

      // Track if a forced tool has been used
      let hasUsedForcedTool = false

      // Track each model and tool call segment with timestamps
      const timeSegments: TimeSegment[] = [
        {
          type: 'model',
          name: 'Initial response',
          startTime: initialCallTime,
          endTime: initialCallTime + firstResponseTime,
          duration: firstResponseTime,
        },
      ]

      // Check if a forced tool was used in the first response
      const firstCheckResult = checkForForcedToolUsage(
        currentResponse,
        originalToolChoice,
        logger,
        forcedTools,
        usedForcedTools
      )
      hasUsedForcedTool = firstCheckResult.hasUsedForcedTool
      usedForcedTools = firstCheckResult.usedForcedTools

      while (iterationCount < MAX_TOOL_ITERATIONS) {
        // Check for tool calls
        const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls
        if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
          break
        }

        logger.info(
          `Processing ${toolCallsInResponse.length} tool calls (iteration ${iterationCount + 1}/${MAX_TOOL_ITERATIONS})`
        )

        // Track time for tool calls in this batch
        const toolsStartTime = Date.now()

        // Process each tool call
        for (const toolCall of toolCallsInResponse) {
          try {
            const toolName = toolCall.function.name
            const toolArgs = JSON.parse(toolCall.function.arguments)

            // Get the tool from the tools registry
            const tool = request.tools?.find((t) => t.id === toolName)
            if (!tool) continue

            // Execute the tool
            const toolCallStartTime = Date.now()

            const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)

            const result = await executeTool(toolName, executionParams, true)
            const toolCallEndTime = Date.now()
            const toolCallDuration = toolCallEndTime - toolCallStartTime

            // Add to time segments for both success and failure
            timeSegments.push({
              type: 'tool',
              name: toolName,
              startTime: toolCallStartTime,
              endTime: toolCallEndTime,
              duration: toolCallDuration,
            })

            // Prepare result content for the LLM
            let resultContent: any
            if (result.success) {
              toolResults.push(result.output)
              resultContent = result.output
            } else {
              // Include error information so LLM can respond appropriately
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

            // Add the tool call and result to messages (both success and failure)
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

        // Calculate tool call time for this iteration
        const thisToolsTime = Date.now() - toolsStartTime
        toolsTime += thisToolsTime

        // Make the next request with updated messages
        const nextPayload = {
          ...payload,
          messages: currentMessages,
        }

        // Update tool_choice based on which forced tools have been used
        if (typeof originalToolChoice === 'object' && hasUsedForcedTool && forcedTools.length > 0) {
          // If we have remaining forced tools, get the next one to force
          const remainingTools = forcedTools.filter((tool) => !usedForcedTools.includes(tool))

          if (remainingTools.length > 0) {
            // Force the next tool
            nextPayload.tool_choice = {
              type: 'function',
              function: { name: remainingTools[0] },
            }
            logger.info(`Forcing next tool: ${remainingTools[0]}`)
          } else {
            // All forced tools have been used, switch to auto
            nextPayload.tool_choice = 'auto'
            logger.info('All forced tools have been used, switching to auto tool_choice')
          }
        }

        // Time the next model call
        const nextModelStartTime = Date.now()

        // Make the next request
        currentResponse = await azureOpenAI.chat.completions.create(nextPayload)

        // Check if any forced tools were used in this response
        const nextCheckResult = checkForForcedToolUsage(
          currentResponse,
          nextPayload.tool_choice,
          logger,
          forcedTools,
          usedForcedTools
        )
        hasUsedForcedTool = nextCheckResult.hasUsedForcedTool
        usedForcedTools = nextCheckResult.usedForcedTools

        const nextModelEndTime = Date.now()
        const thisModelTime = nextModelEndTime - nextModelStartTime

        // Add to time segments
        timeSegments.push({
          type: 'model',
          name: `Model response (iteration ${iterationCount + 1})`,
          startTime: nextModelStartTime,
          endTime: nextModelEndTime,
          duration: thisModelTime,
        })

        // Add to model time
        modelTime += thisModelTime

        // Update content if we have a text response
        if (currentResponse.choices[0]?.message?.content) {
          content = currentResponse.choices[0].message.content
        }

        // Update token counts and cost
        if (currentResponse.usage) {
          tokens.prompt += currentResponse.usage.prompt_tokens || 0
          tokens.completion += currentResponse.usage.completion_tokens || 0
          tokens.total += currentResponse.usage.total_tokens || 0
        }

        iterationCount++
      }

      if (request.stream) {
        logger.info('Using streaming for final response after tool processing')

        const accumulatedCost = calculateCost(request.model, tokens.prompt, tokens.completion)

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
              prompt: tokens.prompt + usage.prompt_tokens,
              completion: tokens.completion + usage.completion_tokens,
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
        // We're not calculating cost here as it will be handled in logger.ts
      }
    } catch (error) {
      // Include timing information even for errors
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      logger.error('Error in Azure OpenAI request:', {
        error,
        duration: totalDuration,
      })

      // Create a new error with timing information
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
