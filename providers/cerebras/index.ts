import { Cerebras } from '@cerebras/cerebras_cloud_sdk'
import { executeTool } from '@/tools'
import { ProviderConfig, ProviderRequest, ProviderResponse } from '../types'

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
        payload.response_format = { type: 'json_object' }
      }

      // Add tools if provided
      if (tools?.length) {
        payload.tools = tools
        payload.tool_choice = 'auto'
      }

      // Make the initial API request
      let currentResponse = (await client.chat.completions.create(payload)) as CerebrasResponse

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
              const mergedArgs = { ...tool.params, ...toolArgs }
              const result = await executeTool(toolName, mergedArgs)

              if (!result.success) continue

              toolResults.push(result.output)
              toolCalls.push({
                name: toolName,
                arguments: toolArgs,
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
              console.error('Error processing tool call:', error)
            }
          }

          // After processing tool calls, get a final response
          if (processedAnyToolCall || hasRepeatedToolCalls) {
            // Make the final request
            const finalPayload = {
              ...payload,
              messages: currentMessages,
              tool_choice: 'none',
            }

            const finalResponse = (await client.chat.completions.create(
              finalPayload
            )) as CerebrasResponse

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

            // Make the next request
            currentResponse = (await client.chat.completions.create(
              nextPayload
            )) as CerebrasResponse

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
        console.error('Error in Cerebras tool processing:', error)
        // Don't throw here, return what we have so far
      }

      return {
        content,
        model: request.model,
        tokens,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
      }
    } catch (error) {
      console.error('Error in Cerebras request:', error)
      throw error
    }
  },
}
