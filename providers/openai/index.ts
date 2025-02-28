import OpenAI from 'openai'
import { executeTool } from '@/tools'
import { ProviderConfig, ProviderRequest, ProviderResponse } from '../types'

export const openaiProvider: ProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  description: "OpenAI's GPT models",
  version: '1.0.0',
  models: ['gpt-4o', 'o1', 'o3-mini'],
  defaultModel: 'gpt-4o',

  executeRequest: async (request: ProviderRequest): Promise<ProviderResponse> => {
    if (!request.apiKey) {
      throw new Error('API key is required for OpenAI')
    }

    const openai = new OpenAI({
      apiKey: request.apiKey,
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
      payload.response_format = { type: 'json_object' }
    }

    // Add tools if provided
    if (tools?.length) {
      payload.tools = tools
      payload.tool_choice = 'auto'
    }

    // Make the initial API request
    let currentResponse = await openai.chat.completions.create(payload)
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

    try {
      while (iterationCount < MAX_ITERATIONS) {
        // Check for tool calls
        const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls
        if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
          break
        }

        // Process each tool call
        for (const toolCall of toolCallsInResponse) {
          try {
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

        // Make the next request with updated messages
        const nextPayload = {
          ...payload,
          messages: currentMessages,
        }

        // Make the next request
        currentResponse = await openai.chat.completions.create(nextPayload)

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
    } catch (error) {
      console.error('Error in OpenAI request:', error)
      throw error
    }

    return {
      content,
      model: request.model,
      tokens,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      toolResults: toolResults.length > 0 ? toolResults : undefined,
    }
  },
}
