import OpenAI from 'openai'
import { createLogger } from '@/lib/logs/console-logger'
import { getRotatingApiKey } from '@/lib/utils'
import { executeTool } from '@/tools'
import { ProviderConfig, ProviderRequest, ProviderResponse, TimeSegment } from '../types'

const logger = createLogger('OpenAI Provider')

/**
 * Helper function to handle API key rotation for GPT-4o
 * @param apiKey - The original API key from the request
 * @param model - The model being used
 * @returns The API key to use (original or rotating)
 */
async function getApiKey(apiKey: string | undefined, model: string): Promise<string> {
  // Check if we should use a rotating key
  const isHostedVersion = process.env.NEXT_PUBLIC_BASE_URL === 'https://www.simstudio.ai'
  const isGPT4o = model === 'gpt-4o'
  
  // On hosted version, always use rotating key for GPT-4o models
  // This handles both null/undefined API keys and user-provided API keys
  if (isHostedVersion && isGPT4o) {
    try {
      // Use the rotating key mechanism
      return getRotatingApiKey('openai')
    } catch (error) {
      logger.warn('Failed to get rotating API key', {
        error: error instanceof Error ? error.message : String(error)
      })
      
      // If we couldn't get a rotating key and have a user key, use it as fallback
      // This should only happen if rotation system is misconfigured
      if (apiKey) {
        logger.info('Falling back to user-provided API key')
        return apiKey
      }
      
      // No rotating key and no user key - throw specific error
      throw new Error('No API key available for OpenAI. Please configure API key rotation or provide a valid API key.')
    }
  }
  
  // For non-hosted versions or non-GPT4o models, require the provided key
  if (!apiKey) {
    throw new Error('API key is required for OpenAI')
  }
  
  return apiKey
}

/**
 * OpenAI provider configuration
 */
export const openaiProvider: ProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  description: "OpenAI's GPT models",
  version: '1.0.0',
  models: ['gpt-4o', 'o1', 'o3-mini'],
  defaultModel: 'gpt-4o',

  executeRequest: async (request: ProviderRequest): Promise<ProviderResponse> => {
    logger.info('Preparing OpenAI request', {
      model: request.model || 'gpt-4o',
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.messages?.length,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
    })

    // Get the appropriate API key based on our rotation logic
    const apiKey = await getApiKey(request.apiKey, request.model || 'gpt-4o')

    const openai = new OpenAI({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true,
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

    // Transform tools to OpenAI format if provided
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
      model: request.model || 'gpt-4o',
      messages: allMessages,
    }

    // Add optional parameters
    if (request.temperature !== undefined) payload.temperature = request.temperature
    if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

    // Add response format for structured output if specified
    if (request.responseFormat) {
      // Use OpenAI's JSON schema format
      payload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: request.responseFormat.name || 'response_schema',
          schema: request.responseFormat.schema || request.responseFormat,
          strict: request.responseFormat.strict !== false,
        },
      }

      logger.info('Added JSON schema response format to request')
    }

    // Add tools if provided
    if (tools?.length) {
      payload.tools = tools
      payload.tool_choice = 'auto'
      logger.info(`Configured ${tools.length} tools for OpenAI request`)
    }

    // Start execution timer for the entire provider execution
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      // Make the initial API request
      const initialCallTime = Date.now()
      let currentResponse = await openai.chat.completions.create(payload)
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

      while (iterationCount < MAX_ITERATIONS) {
        // Check for tool calls
        const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls
        if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
          break
        }

        logger.info(
          `Processing ${toolCallsInResponse.length} tool calls (iteration ${iterationCount + 1}/${MAX_ITERATIONS})`
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
            const mergedArgs = { ...tool.params, ...toolArgs }
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

        // Time the next model call
        const nextModelStartTime = Date.now()

        // Make the next request
        currentResponse = await openai.chat.completions.create(nextPayload)

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

        // Update token counts
        if (currentResponse.usage) {
          tokens.prompt += currentResponse.usage.prompt_tokens || 0
          tokens.completion += currentResponse.usage.completion_tokens || 0
          tokens.total += currentResponse.usage.total_tokens || 0
        }

        iterationCount++
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

      logger.error('Error in OpenAI request:', {
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
