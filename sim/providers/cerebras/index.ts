import { Cerebras } from '@cerebras/cerebras_cloud_sdk'
import { createLogger } from '@/lib/logs/console-logger'
import { executeTool } from '@/tools'
import { ProviderConfig, ProviderRequest, ProviderResponse, TimeSegment } from '../types'

const logger = createLogger('Cerebras Provider')

export const cerebrasProvider: ProviderConfig = {
  id: 'cerebras',
  name: 'Cerebras',
  description: 'Cerebras Cloud LLMs',
  version: '1.0.0',
  models: ['cerebras/llama-3.3-70b'],
  defaultModel: 'cerebras/llama-3.3-70b',
  executeRequest: async (request: ProviderRequest): Promise<ProviderResponse> => {
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

          logger.info(`Cerebras request configuration:`, {
            toolCount: filteredTools.length,
            toolChoice: 'auto', // Cerebras always uses auto, 'force' is treated as 'auto'
            model: request.model,
          })
        } else if (tools.length > 0 && filteredTools.length === 0) {
          // Handle case where all tools are filtered out
          logger.info(`All tools have usageControl='none', removing tools from request`)
        }
      }

      // Make the initial API request
      const initialCallTime = Date.now()

      let currentResponse = (await client.chat.completions.create(payload)) as CerebrasResponse
      const firstResponseTime = Date.now() - initialCallTime

      let content = currentResponse.choices[0]?.message?.content || ''
      let tokens = {
        prompt: currentResponse.usage?.prompt_tokens || 0,
        completion: currentResponse.usage?.completion_tokens || 0,
        total: currentResponse.usage?.total_tokens || 0,
      }
      let toolCalls = []
      let toolResults = []
      let currentMessages = [...allMessages]
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
              const mergedArgs = {
                ...tool.params,
                ...toolArgs,
                ...(request.workflowId ? { _context: { workflowId: request.workflowId } } : {}),
              }
              const result = await executeTool(toolName, mergedArgs)
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

              // Add the tool call and result to messages
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
              name: `Final response`,
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
