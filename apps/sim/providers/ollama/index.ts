import OpenAI from 'openai'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import { useOllamaStore } from '@/stores/ollama/store'
import { executeTool } from '@/tools'
import type { ProviderConfig, ProviderRequest, ProviderResponse, TimeSegment } from '../types'
import type { ModelsObject } from './types'

const logger = createLogger('OllamaProvider')
const OLLAMA_HOST = env.OLLAMA_URL || 'http://localhost:11434'

export const ollamaProvider: ProviderConfig = {
  id: 'ollama',
  name: 'Ollama',
  description: 'Local Ollama server for LLM inference',
  version: '1.0.0',
  models: [], // Will be populated dynamically
  defaultModel: '',

  // Initialize the provider by fetching available models
  async initialize() {
    if (typeof window !== 'undefined') {
      logger.info('Skipping Ollama initialization on client side to avoid CORS issues')
      return
    }

    try {
      const response = await fetch(`${OLLAMA_HOST}/api/tags`)
      if (!response.ok) {
        useOllamaStore.getState().setModels([])
        logger.warn('Ollama service is not available. The provider will be disabled.')
        return
      }
      const data = (await response.json()) as ModelsObject
      this.models = data.models.map((model) => model.name)
      useOllamaStore.getState().setModels(this.models)
    } catch (error) {
      logger.warn('Ollama model instantiation failed. The provider will be disabled.', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  },

  executeRequest: async (request: ProviderRequest): Promise<ProviderResponse> => {
    console.log(request)
    logger.info('Preparing Ollama request', {
      model: request.model,
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.context,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
    })

    const startTime = Date.now()

    try {
      // Prepare messages array
      const ollama = new OpenAI({
        apiKey: 'empty',
        baseURL: `${OLLAMA_HOST}/v1`,
      })

      // Start with an empty array for all messages
      const allMessages = []

      // Add system prompt if present
      if (request.systemPrompt) {
        allMessages.push({ role: 'system', content: request.systemPrompt })
      }

      // Add context if present
      if (request.context) {
        allMessages.push({ role: 'user', content: request.context })
      }

      // Add remaining messages
      if (request.messages) {
        allMessages.push(...request.messages)
      }

      // Build the basic payload
      const payload: any = {
        model: request.model,
        messages: allMessages,
        stream: false,
      }

      // Add optional parameters
      if (request.temperature !== undefined) payload.temperature = request.temperature
      if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

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

      // Handle tools and tool usage control
      if (tools?.length) {
        // Filter out any tools with usageControl='none', but ignore 'force' since Ollama doesn't support it
        const filteredTools = tools.filter((tool) => {
          const toolId = tool.function?.name
          const toolConfig = request.tools?.find((t) => t.id === toolId)
          // Only filter out 'none', treat 'force' as 'auto'
          return toolConfig?.usageControl !== 'none'
        })

        if (filteredTools?.length) {
          payload.tools = filteredTools
          // Always use 'auto' for Ollama, regardless of the tool_choice setting
          payload.tool_choice = 'auto'

          logger.info('Ollama request configuration:', {
            toolCount: filteredTools.length,
            toolChoice: 'auto', // Ollama always uses auto
            model: request.model,
          })
        }
      }

      let currentResponse = await ollama.chat.completions.create(payload)
      const firstResponseTime = Date.now() - startTime

      let content = currentResponse.choices[0]?.message?.content || ''

      // Clean up the response content if it exists
      if (content) {
        content = content.replace(/```json\n?|\n?```/g, '')
        content = content.trim()
      }

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
          startTime: startTime,
          endTime: startTime + firstResponseTime,
          duration: firstResponseTime,
        },
      ]

      try {
        while (iterationCount < MAX_ITERATIONS) {
          // Check for tool calls
          const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls
          if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
            break
          }

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

          // Make the next request with updated messages
          const nextPayload = {
            ...payload,
            messages: currentMessages,
          }

          // Time the next model call
          const nextModelStartTime = Date.now()

          // Make the next request
          currentResponse = await ollama.chat.completions.create(nextPayload)

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
            // Clean up the response content
            content = content.replace(/```json\n?|\n?```/g, '')
            content = content.trim()
          }

          // Update token counts
          if (currentResponse.usage) {
            tokens.prompt += currentResponse.usage.prompt_tokens || 0
            tokens.completion += currentResponse.usage.completion_tokens || 0
            tokens.total += currentResponse.usage.total_tokens || 0
          }

          iterationCount++
        }
      } catch (error) {
        logger.error('Error in Ollama request:', { error })
      }

      const endTime = Date.now()

      return {
        content: content,
        model: request.model,
        tokens,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
        timing: {
          startTime: new Date(startTime).toISOString(),
          endTime: new Date(endTime).toISOString(),
          duration: endTime - startTime,
          modelTime: modelTime,
          toolsTime: toolsTime,
          firstResponseTime: firstResponseTime,
          iterations: iterationCount + 1,
          timeSegments,
        },
      }
    } catch (error) {
      logger.error('Error in Ollama request', {
        error: error instanceof Error ? error.message : 'Unknown error',
        model: request.model,
      })
      throw error
    }
  },
}
