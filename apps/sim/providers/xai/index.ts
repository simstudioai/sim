import OpenAI from 'openai'
import { createLogger } from '@/lib/logs/console-logger'
import type { StreamingExecution } from '@/executor/types'
import { executeTool } from '@/tools'
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
  models: ['grok-3-latest', 'grok-3-fast-latest'],
  defaultModel: 'grok-3-latest',

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for xAI')
    }

    // Initialize OpenAI client for xAI
    const xai = new OpenAI({
      apiKey: request.apiKey,
      baseURL: 'https://api.x.ai/v1',
    })

    // Prepare messages
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

    // Build the request payload
    const payload: any = {
      model: request.model || 'grok-3-latest',
      messages: allMessages,
    }

    if (request.temperature !== undefined) payload.temperature = request.temperature
    if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

    if (request.responseFormat) {
      payload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: request.responseFormat.name || 'structured_response',
          schema: request.responseFormat.schema || request.responseFormat,
          strict: request.responseFormat.strict !== false,
        },
      }

      if (allMessages.length > 0 && allMessages[0].role === 'system') {
        allMessages[0].content = `${allMessages[0].content}\n\nYou MUST respond with a valid JSON object. DO NOT include any other text, explanations, or markdown formatting in your response - ONLY the JSON object.`
      } else {
        allMessages.unshift({
          role: 'system',
          content:
            'You MUST respond with a valid JSON object. DO NOT include any other text, explanations, or markdown formatting in your response - ONLY the JSON object.',
        })
      }
    }

    // Handle tools and tool usage control
    let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null

    if (tools?.length) {
      preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'xai')
      const { tools: filteredTools, toolChoice } = preparedTools

      if (filteredTools?.length && toolChoice) {
        payload.tools = filteredTools
        payload.tool_choice = toolChoice

        logger.info('XAI request configuration:', {
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
          model: request.model || 'grok-3-latest',
        })
      }
    }

    // EARLY STREAMING: if caller requested streaming and there are no tools to execute,
    // we can directly stream the completion.
    if (request.stream && (!tools || tools.length === 0)) {
      logger.info('Using streaming response for XAI request (no tools)')

      // Start execution timer for the entire provider execution
      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()

      const streamResponse = await xai.chat.completions.create({
        ...payload,
        stream: true,
      })

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
            response: {
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

      // Track the original tool_choice for forced tool tracking
      const originalToolChoice = payload.tool_choice

      // Track forced tools and their usage
      const forcedTools = preparedTools?.forcedTools || []
      let usedForcedTools: string[] = []

      let currentResponse = await xai.chat.completions.create(payload)
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
      checkForForcedToolUsage(currentResponse, originalToolChoice)

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
              if (!tool) continue

              const toolCallStartTime = Date.now()
              const mergedArgs = {
                ...tool.params,
                ...toolArgs,
                ...(request.workflowId ? { _context: { workflowId: request.workflowId } } : {}),
              }
              const result = await executeTool(toolName, mergedArgs, true)
              const toolCallEndTime = Date.now()
              const toolCallDuration = toolCallEndTime - toolCallStartTime

              if (!result.success) continue

              // Add to time segments
              timeSegments.push({
                type: 'tool',
                name: toolName,
                startTime: toolCallStartTime,
                endTime: toolCallEndTime,
                duration: toolCallDuration,
              })

              toolResults.push(result.output)
              toolCalls.push({
                name: toolName,
                arguments: toolArgs,
                startTime: new Date(toolCallStartTime).toISOString(),
                endTime: new Date(toolCallEndTime).toISOString(),
                duration: toolCallDuration,
                result: result.output,
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
                content: JSON.stringify(result.output),
              })
            } catch (error) {
              logger.error('Error processing tool call:', { error })
            }
          }

          // Calculate tool call time for this iteration
          const thisToolsTime = Date.now() - toolsStartTime
          toolsTime += thisToolsTime

          const nextPayload = {
            ...payload,
            messages: currentMessages,
          }

          // Update tool_choice based on which forced tools have been used
          if (
            typeof originalToolChoice === 'object' &&
            hasUsedForcedTool &&
            forcedTools.length > 0
          ) {
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

          currentResponse = await xai.chat.completions.create(nextPayload)

          // Check if any forced tools were used in this response
          checkForForcedToolUsage(currentResponse, nextPayload.tool_choice)

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
        logger.error('Error in xAI request:', { error })
      }

      // After all tool processing complete, if streaming was requested and we have messages, use streaming for the final response
      if (request.stream && iterationCount > 0) {
        logger.info('Using streaming for final XAI response after tool calls')

        // When streaming after tool calls with forced tools, make sure tool_choice is set to 'auto'
        // This prevents the API from trying to force tool usage again in the final streaming response
        const streamingPayload = {
          ...payload,
          messages: currentMessages,
          tool_choice: 'auto', // Always use 'auto' for the streaming response after tool calls
          stream: true,
        }

        const streamResponse = await xai.chat.completions.create(streamingPayload)

        // Create a StreamingExecution response with all collected data
        const streamingResult = {
          stream: createReadableStreamFromXAIStream(streamResponse),
          execution: {
            success: true,
            output: {
              response: {
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

      logger.error('Error in xAI request:', { error, duration: totalDuration })

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
