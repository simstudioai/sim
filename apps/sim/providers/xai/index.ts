import OpenAI from 'openai'
import { createLogger } from '@/lib/logs/console-logger'
import type { StreamingExecution } from '@/executor/types'
import { executeTool } from '@/tools'
import { getProviderDefaultModel, getProviderModels } from '../models'
import type { ProviderConfig, ProviderRequest, ProviderResponse, TimeSegment } from '../types'
import { prepareToolsWithUsageControl, trackForcedToolUsage } from '../utils'

const logger = createLogger('XAIProvider')

/**
 * Helper to wrap XAI (OpenAI-compatible) streaming into a browser-friendly
 * ReadableStream of raw assistant text chunks.
 */
function createReadableStreamFromXAIStream(xaiStream: any): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of xaiStream) {
          const content = chunk.choices[0]?.delta?.content || ''
          if (content) {
            controller.enqueue(new TextEncoder().encode(content))
          }
        }
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })
}

export const xAIProvider: ProviderConfig = {
  id: 'xai',
  name: 'xAI',
  description: "xAI's Grok models",
  version: '1.0.0',
  models: getProviderModels('xai'),
  defaultModel: getProviderDefaultModel('xai'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for xAI')
    }

    const xai = new OpenAI({
      apiKey: request.apiKey,
      baseURL: 'https://api.x.ai/v1',
    })

    logger.info('XAI Provider - Initial request configuration:', {
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      model: request.model || 'grok-3-latest',
      streaming: !!request.stream,
    })

    const allMessages: any[] = []

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

    // Set up tools
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

    // Log tools and response format conflict detection
    if (tools?.length && request.responseFormat) {
      logger.warn(
        'XAI Provider - Detected both tools and response format. Using tools first, then response format for final response.'
      )
    }

    // Build the base request payload
    const basePayload: any = {
      model: request.model || 'grok-3-latest',
      messages: allMessages,
    }

    if (request.temperature !== undefined) basePayload.temperature = request.temperature
    if (request.maxTokens !== undefined) basePayload.max_tokens = request.maxTokens

    // Function to create response format configuration
    const createResponseFormatPayload = (messages: any[] = allMessages) => {
      const payload = {
        ...basePayload,
        messages,
      }

      if (request.responseFormat) {
        payload.response_format = {
          type: 'json_schema',
          json_schema: {
            name: request.responseFormat.name || 'structured_response',
            schema: request.responseFormat.schema || request.responseFormat,
            strict: request.responseFormat.strict !== false,
          },
        }
      }

      return payload
    }

    // Handle tools and tool usage control
    let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null

    if (tools?.length) {
      preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'xai')
    }

    // EARLY STREAMING: if caller requested streaming and there are no tools to execute,
    // we can directly stream the completion with response format if needed
    if (request.stream && (!tools || tools.length === 0)) {
      logger.info('XAI Provider - Using direct streaming (no tools)')

      // Start execution timer for the entire provider execution
      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()

      // Use response format payload if needed, otherwise use base payload
      const streamingPayload = request.responseFormat
        ? createResponseFormatPayload()
        : { ...basePayload, stream: true }

      if (!request.responseFormat) {
        streamingPayload.stream = true
      } else {
        streamingPayload.stream = true
      }

      const streamResponse = await xai.chat.completions.create(streamingPayload)

      // Start collecting token usage
      const tokenUsage = {
        prompt: 0,
        completion: 0,
        total: 0,
      }

      // Create a StreamingExecution response with a readable stream
      const streamingResult = {
        stream: createReadableStreamFromXAIStream(streamResponse),
        execution: {
          success: true,
          output: {
            content: '', // Will be filled by streaming content in chat component
            model: request.model || 'grok-3-latest',
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
            // Estimate token cost
            cost: {
              total: 0.0,
              input: 0.0,
              output: 0.0,
            },
          },
          logs: [], // No block logs for direct streaming
          metadata: {
            startTime: providerStartTimeISO,
            endTime: new Date().toISOString(),
            duration: Date.now() - providerStartTime,
          },
          isStreaming: true,
        },
      }

      // Return the streaming execution object
      return streamingResult as StreamingExecution
    }

    // Start execution timer for the entire provider execution
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      // Make the initial API request
      const initialCallTime = Date.now()

      // For the initial request with tools, we NEVER include response_format
      // This is the key fix: tools and response_format cannot be used together with xAI
      const initialPayload = { ...basePayload }

      // Track the original tool_choice for forced tool tracking
      let originalToolChoice: any

      // Track forced tools and their usage
      const forcedTools = preparedTools?.forcedTools || []
      let usedForcedTools: string[] = []

      if (preparedTools?.tools?.length && preparedTools.toolChoice) {
        const { tools: filteredTools, toolChoice } = preparedTools
        initialPayload.tools = filteredTools
        initialPayload.tool_choice = toolChoice
        originalToolChoice = toolChoice
      } else if (request.responseFormat) {
        // Only add response format if there are no tools
        const responseFormatPayload = createResponseFormatPayload()
        Object.assign(initialPayload, responseFormatPayload)
      }

      let currentResponse = await xai.chat.completions.create(initialPayload)
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

      // Track if a forced tool has been used
      let hasUsedForcedTool = false

      // Track time spent in model vs tools
      let modelTime = firstResponseTime
      let toolsTime = 0

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

      // Helper function to check for forced tool usage in responses
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
            'xai',
            forcedTools,
            usedForcedTools
          )
          hasUsedForcedTool = result.hasUsedForcedTool
          usedForcedTools = result.usedForcedTools
        }
      }

      // Check if a forced tool was used in the first response
      if (originalToolChoice) {
        checkForForcedToolUsage(currentResponse, originalToolChoice)
      }

      try {
        while (iterationCount < MAX_ITERATIONS) {
          // Check for tool calls
          const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls
          if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
            break
          }

          // Track time for tool calls in this batch
          const toolsStartTime = Date.now()

          for (const toolCall of toolCallsInResponse) {
            try {
              const toolName = toolCall.function.name
              const toolArgs = JSON.parse(toolCall.function.arguments)

              const tool = request.tools?.find((t) => t.id === toolName)
              if (!tool) {
                logger.warn('XAI Provider - Tool not found:', { toolName })
                continue
              }

              const toolCallStartTime = Date.now()

              // Only merge actual tool parameters for logging
              const toolParams = {
                ...tool.params,
                ...toolArgs,
              }

              // Add system parameters for execution
              const executionParams = {
                ...toolParams,
                ...(request.workflowId ? { _context: { workflowId: request.workflowId } } : {}),
                ...(request.environmentVariables ? { envVars: request.environmentVariables } : {}),
              }

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

                logger.warn('XAI Provider - Tool execution failed:', {
                  toolName,
                  error: result.error,
                })
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
              logger.error('XAI Provider - Error processing tool call:', {
                error: error instanceof Error ? error.message : String(error),
                toolCall: toolCall.function.name,
              })
            }
          }

          // Calculate tool call time for this iteration
          const thisToolsTime = Date.now() - toolsStartTime
          toolsTime += thisToolsTime

          // After tool calls, create next payload based on whether we need more tools or final response
          let nextPayload: any

          // Update tool_choice based on which forced tools have been used
          if (
            typeof originalToolChoice === 'object' &&
            hasUsedForcedTool &&
            forcedTools.length > 0
          ) {
            // If we have remaining forced tools, get the next one to force
            const remainingTools = forcedTools.filter((tool) => !usedForcedTools.includes(tool))

            if (remainingTools.length > 0) {
              // Force the next tool - continue with tools, no response format
              nextPayload = {
                ...basePayload,
                messages: currentMessages,
                tools: preparedTools?.tools,
                tool_choice: {
                  type: 'function',
                  function: { name: remainingTools[0] },
                },
              }
            } else {
              // All forced tools have been used, check if we need response format for final response
              if (request.responseFormat) {
                nextPayload = createResponseFormatPayload(currentMessages)
              } else {
                nextPayload = {
                  ...basePayload,
                  messages: currentMessages,
                  tool_choice: 'auto',
                  tools: preparedTools?.tools,
                }
              }
            }
          } else {
            // Normal tool processing - check if this might be the final response
            if (request.responseFormat) {
              // Use response format for what might be the final response
              nextPayload = createResponseFormatPayload(currentMessages)
            } else {
              nextPayload = {
                ...basePayload,
                messages: currentMessages,
                tools: preparedTools?.tools,
                tool_choice: 'auto',
              }
            }
          }

          // Time the next model call
          const nextModelStartTime = Date.now()

          currentResponse = await xai.chat.completions.create(nextPayload)

          // Check if any forced tools were used in this response
          if (nextPayload.tool_choice && typeof nextPayload.tool_choice === 'object') {
            checkForForcedToolUsage(currentResponse, nextPayload.tool_choice)
          }

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
      } catch (error) {
        logger.error('XAI Provider - Error in tool processing loop:', {
          error: error instanceof Error ? error.message : String(error),
          iterationCount,
        })
      }

      // After all tool processing complete, if streaming was requested and we have messages, use streaming for the final response
      if (request.stream && iterationCount > 0) {
        // For final streaming response, choose between tools (auto) or response_format (never both)
        let finalStreamingPayload: any

        if (request.responseFormat) {
          // Use response format, no tools
          finalStreamingPayload = {
            ...createResponseFormatPayload(currentMessages),
            stream: true,
          }
        } else {
          // Use tools with auto choice
          finalStreamingPayload = {
            ...basePayload,
            messages: currentMessages,
            tool_choice: 'auto',
            tools: preparedTools?.tools,
            stream: true,
          }
        }

        const streamResponse = await xai.chat.completions.create(finalStreamingPayload)

        // Create a StreamingExecution response with all collected data
        const streamingResult = {
          stream: createReadableStreamFromXAIStream(streamResponse),
          execution: {
            success: true,
            output: {
              content: '', // Will be filled by the callback
              model: request.model || 'grok-3-latest',
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
                total: (tokens.total || 0) * 0.0001,
                input: (tokens.prompt || 0) * 0.0001,
                output: (tokens.completion || 0) * 0.0001,
              },
            },
            logs: [], // No block logs at provider level
            metadata: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: Date.now() - providerStartTime,
            },
            isStreaming: true,
          },
        }

        // Return the streaming execution object
        return streamingResult as StreamingExecution
      }

      // Calculate overall timing
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      logger.info('XAI Provider - Request completed:', {
        totalDuration,
        iterationCount: iterationCount + 1,
        toolCallCount: toolCalls.length,
        hasContent: !!content,
        contentLength: content?.length || 0,
      })

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
      // Include timing information even for errors
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      logger.error('XAI Provider - Request failed:', {
        error: error instanceof Error ? error.message : String(error),
        duration: totalDuration,
        hasTools: !!tools?.length,
        hasResponseFormat: !!request.responseFormat,
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
