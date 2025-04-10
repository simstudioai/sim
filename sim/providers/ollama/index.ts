import OpenAI from 'openai'
import { createLogger } from '@/lib/logs/console-logger'
import { useOllamaStore } from '@/stores/ollama/store'
import { executeTool } from '@/tools'
import { ProviderConfig, ProviderRequest, ProviderResponse, TimeSegment } from '../types'
import { ModelsObject } from './types'

const logger = createLogger('Ollama Provider')
const OLLAMA_HOST = 'http://localhost:11434'

export const ollamaProvider: ProviderConfig = {
  id: 'ollama',
  name: 'Ollama',
  description: 'Local Ollama server for LLM inference',
  version: '1.0.0',
  models: [], // Will be populated dynamically
  defaultModel: '',

  // Initialize the provider by fetching available models
  async initialize() {
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
    const timeSegments: TimeSegment[] = []

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

      const payload: any = {
        model: request.model,
        messages: allMessages,
      }

      // Add optional parameters
      if (request.temperature !== undefined) payload.temperature = request.temperature
      if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

      // Add tools if provided
      if (tools?.length) {
        payload.tools = tools
        payload.tool_choice = 'auto'
      }

      // Make the initial API request
      const initialCallTime = Date.now()
      let currentResponse = await ollama.chat.completions.create(payload)
      const firstResponseTime = Date.now() - initialCallTime

      let content = currentResponse.choices[0]?.message?.content || ''

      // Clean up the response content if it exists
      if (content) {
        content = content.replace(/```json\n?|\n?```/g, '')
        content = content.trim()
      }

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
