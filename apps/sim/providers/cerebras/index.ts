import { Cerebras } from '@cerebras/cerebras_cloud_sdk'
import { createLogger } from '@/lib/logs/console-logger'
import type { StreamingExecution } from '@/executor/types'
import { executeTool } from '@/tools'
import { getProviderDefaultModel, getProviderModels } from '../models'
import type { ProviderConfig, ProviderRequest, ProviderResponse, TimeSegment } from '../types'

const logger = createLogger('CerebrasProvider')

/**
 * Helper to convert a Cerebras streaming response (async iterable) into a ReadableStream.
 * Enqueues only the model's text delta chunks as UTF-8 encoded bytes.
 */
function createReadableStreamFromCerebrasStream(
  cerebrasStream: AsyncIterable<any>
): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of cerebrasStream) {
          // Expecting delta content similar to OpenAI: chunk.choices[0]?.delta?.content
          const content = chunk.choices?.[0]?.delta?.content || ''
          if (content) {
            controller.enqueue(new TextEncoder().encode(content))
          }
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

export const cerebrasProvider: ProviderConfig = {
  id: 'cerebras',
  name: 'Cerebras',
  description: 'Cerebras Cloud LLMs',
  version: '1.0.0',
  models: getProviderModels('cerebras'),
  defaultModel: getProviderDefaultModel('cerebras'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Cerebras')
    }

    // Start execution timer for the entire provider execution
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      const client = new Cerebras({
        apiKey: request.apiKey,
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

      // Transform tools to Cerebras format if provided
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
        model: (request.model || 'cerebras/llama-3.3-70b').replace('cerebras/', ''),
        messages: allMessages,
      }

      // Add optional parameters
      if (request.temperature !== undefined) payload.temperature = request.temperature
      if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

      // Add response format for structured output if specified
      if (request.responseFormat) {
        payload.response_format = {
          type: 'json_schema',
          schema: request.responseFormat.schema || request.responseFormat,
        }
      }

      // Add tools if provided
      if (tools?.length) {
        // Filter out any tools with usageControl='none', treat 'force' as 'auto' since Cerebras only supports 'auto'
        const filteredTools = tools.filter((tool) => {
          const toolId = tool.function?.name
          const toolConfig = request.tools?.find((t) => t.id === toolId)
          // Only filter out tools with usageControl='none'
          return toolConfig?.usageControl !== 'none'
        })

        if (filteredTools?.length) {
          payload.tools = filteredTools
          // Always use 'auto' for Cerebras, explicitly converting any 'force' usageControl to 'auto'
          payload.tool_choice = 'auto'

          logger.info('Cerebras request configuration:', {
            toolCount: filteredTools.length,
            toolChoice: 'auto', // Cerebras always uses auto, 'force' is treated as 'auto'
            model: request.model,
          })
        } else if (tools.length > 0 && filteredTools.length === 0) {
          // Handle case where all tools are filtered out
          logger.info(`All tools have usageControl='none', removing tools from request`)
        }
      }

      // EARLY STREAMING: if streaming requested and no tools to execute, stream directly
      if (request.stream && (!tools || tools.length === 0)) {
        logger.info('Using streaming response for Cerebras request (no tools)')
        const streamResponse: any = await client.chat.completions.create({
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
          stream: createReadableStreamFromCerebrasStream(streamResponse),
          execution: {
            success: true,
            output: {
              content: '', // Will be filled by streaming content in chat component
              model: request.model || 'cerebras/llama-3.3-70b',
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

      // Make the initial API request
      const initialCallTime = Date.now()

      let currentResponse = (await client.chat.completions.create(payload)) as CerebrasResponse
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
      const MAX_ITERATIONS = 10 // Prevent infinite loops

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

      // Keep track of processed tool calls to avoid duplicates
      const processedToolCallIds = new Set()
      // Keep track of tool call signatures to detect repeats
      const toolCallSignatures = new Set()

      try {
        while (iterationCount < MAX_ITERATIONS) {
          // Check for tool calls
          const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls

          // Break if no tool calls
          if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
            if (currentResponse.choices[0]?.message?.content) {
              content = currentResponse.choices[0].message.content
            }
            break
          }

          // Track time for tool calls in this batch
          const toolsStartTime = Date.now()

          // Process each tool call
          let processedAnyToolCall = false
          let hasRepeatedToolCalls = false

          for (const toolCall of toolCallsInResponse) {
            // Skip if we've already processed this tool call
            if (processedToolCallIds.has(toolCall.id)) {
              continue
            }

            // Create a signature for this tool call to detect repeats
            const toolCallSignature = `${toolCall.function.name}-${toolCall.function.arguments}`
            if (toolCallSignatures.has(toolCallSignature)) {
              hasRepeatedToolCalls = true
              continue
            }

            try {
              processedToolCallIds.add(toolCall.id)
              toolCallSignatures.add(toolCallSignature)
              processedAnyToolCall = true

              const toolName = toolCall.function.name
              const toolArgs = JSON.parse(toolCall.function.arguments)

              // Get the tool from the tools registry
              const tool = request.tools?.find((t) => t.id === toolName)
              if (!tool) continue

              // Execute the tool
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
              logger.error('Error processing tool call:', { error })
            }
          }

          // Calculate tool call time for this iteration
          const thisToolsTime = Date.now() - toolsStartTime
          toolsTime += thisToolsTime

          // After processing tool calls, get a final response
          if (processedAnyToolCall || hasRepeatedToolCalls) {
            // Time the next model call
            const nextModelStartTime = Date.now()

            // Make the final request
            const finalPayload = {
              ...payload,
              messages: currentMessages,
            }

            // Use tool_choice: 'none' for the final response to avoid an infinite loop
            finalPayload.tool_choice = 'none'

            const finalResponse = (await client.chat.completions.create(
              finalPayload
            )) as CerebrasResponse

            const nextModelEndTime = Date.now()
            const thisModelTime = nextModelEndTime - nextModelStartTime

            // Add to time segments
            timeSegments.push({
              type: 'model',
              name: 'Final response',
              startTime: nextModelStartTime,
              endTime: nextModelEndTime,
              duration: thisModelTime,
            })

            // Add to model time
            modelTime += thisModelTime

            if (finalResponse.choices[0]?.message?.content) {
              content = finalResponse.choices[0].message.content
            }

            // Update final token counts
            if (finalResponse.usage) {
              tokens.prompt += finalResponse.usage.prompt_tokens || 0
              tokens.completion += finalResponse.usage.completion_tokens || 0
              tokens.total += finalResponse.usage.total_tokens || 0
            }

            break
          }

          // Only continue if we haven't processed any tool calls and haven't seen repeats
          if (!processedAnyToolCall && !hasRepeatedToolCalls) {
            // Make the next request with updated messages
            const nextPayload = {
              ...payload,
              messages: currentMessages,
            }

            // Time the next model call
            const nextModelStartTime = Date.now()

            // Make the next request
            currentResponse = (await client.chat.completions.create(
              nextPayload
            )) as CerebrasResponse

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

            // Update token counts
            if (currentResponse.usage) {
              tokens.prompt += currentResponse.usage.prompt_tokens || 0
              tokens.completion += currentResponse.usage.completion_tokens || 0
              tokens.total += currentResponse.usage.total_tokens || 0
            }

            iterationCount++
          }
        }
      } catch (error) {
        logger.error('Error in Cerebras tool processing:', { error })
      }

      // Calculate overall timing
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      // POST-TOOL-STREAMING: stream after tool calls if requested
      if (request.stream && iterationCount > 0) {
        logger.info('Using streaming for final Cerebras response after tool calls')

        // When streaming after tool calls with forced tools, make sure tool_choice is set to 'auto'
        // This prevents the API from trying to force tool usage again in the final streaming response
        const streamingPayload = {
          ...payload,
          messages: currentMessages,
          tool_choice: 'auto', // Always use 'auto' for the streaming response after tool calls
          stream: true,
        }

        const streamResponse: any = await client.chat.completions.create(streamingPayload)

        // Create a StreamingExecution response with all collected data
        const streamingResult = {
          stream: createReadableStreamFromCerebrasStream(streamResponse),
          execution: {
            success: true,
            output: {
              content: '', // Will be filled by the callback
              model: request.model || 'cerebras/llama-3.3-70b',
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

      logger.error('Error in Cerebras request:', {
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
