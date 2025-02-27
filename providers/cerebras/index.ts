import { Cerebras } from '@cerebras/cerebras_cloud_sdk'
import {
  FunctionCallResponse,
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  ProviderToolConfig,
} from '../types'

export const cerebrasProvider: ProviderConfig = {
  id: 'cerebras',
  name: 'Cerebras',
  description: 'Cerebras Cloud LLMs',
  version: '1.0.0',
  models: ['llama-3.3-70b'],
  defaultModel: 'llama-3.3-70b',
  implementationType: 'sdk',

  // SDK-based implementation
  executeRequest: async (request: ProviderRequest): Promise<ProviderResponse> => {
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
      const functions = request.tools?.length
        ? request.tools.map((tool) => ({
            name: tool.id,
            description: tool.description,
            parameters: tool.parameters,
          }))
        : undefined

      // Build the request payload
      const payload: any = {
        model: request.model || 'llama-3.3-70b',
        messages: allMessages,
      }

      // Add optional parameters
      if (request.temperature !== undefined) payload.temperature = request.temperature
      if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

      // Add functions if provided
      if (functions?.length) {
        payload.functions = functions
        payload.function_call = 'auto'
      }

      // Add local execution flag if specified
      if (request.local_execution) {
        payload.local_execution = true
      }

      // Execute the request using the SDK
      const response = (await client.chat.completions.create(payload)) as any

      // Extract content and token info
      const content = response.choices?.[0]?.message?.content || ''
      const tokens = {
        prompt: response.usage?.prompt_tokens || 0,
        completion: response.usage?.completion_tokens || 0,
        total: response.usage?.total_tokens || 0,
      }

      // Check for function calls
      const functionCall = response.choices?.[0]?.message?.function_call
      let toolCalls = undefined

      if (functionCall) {
        const tool = request.tools?.find((t) => t.id === functionCall.name)
        const toolParams = tool?.params || {}

        toolCalls = [
          {
            name: functionCall.name,
            arguments: {
              ...toolParams,
              ...JSON.parse(functionCall.arguments),
            },
          },
        ]
      }

      // Return the response in the expected format
      return {
        content,
        model: request.model,
        tokens,
        toolCalls,
      }
    } catch (error: any) {
      console.error('Error executing Cerebras request:', error)
      throw new Error(`Cerebras API error: ${error.message}`)
    }
  },

  // These are still needed for backward compatibility
  baseUrl: 'https://api.cerebras.cloud/v1/chat/completions',
  headers: (apiKey: string) => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }),

  transformToolsToFunctions: (tools: ProviderToolConfig[]) => {
    if (!tools || tools.length === 0) {
      return undefined
    }

    return tools.map((tool) => ({
      name: tool.id,
      description: tool.description,
      parameters: tool.parameters,
    }))
  },

  transformFunctionCallResponse: (
    response: any,
    tools?: ProviderToolConfig[]
  ): FunctionCallResponse => {
    const functionCall = response.choices?.[0]?.message?.function_call
    if (!functionCall) {
      throw new Error('No function call found in response')
    }

    const tool = tools?.find((t) => t.id === functionCall.name)
    const toolParams = tool?.params || {}

    return {
      name: functionCall.name,
      arguments: {
        ...toolParams,
        ...JSON.parse(functionCall.arguments),
      },
    }
  },

  transformRequest: (request: ProviderRequest, functions?: any) => {
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

    // Build the request payload
    const payload: any = {
      model: request.model || 'llama-3.3-70b',
      messages: allMessages,
    }

    // Add optional parameters
    if (request.temperature !== undefined) payload.temperature = request.temperature
    if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

    // Add function calling support
    if (functions) {
      payload.functions = functions
      payload.function_call = 'auto'
    }

    // Add local execution flag if specified
    if (request.local_execution) {
      payload.local_execution = true
    }

    return payload
  },

  transformResponse: (response: any) => {
    const output = {
      content: response.choices?.[0]?.message?.content || '',
      tokens: undefined as any,
    }

    if (response.usage) {
      output.tokens = {
        prompt: response.usage.prompt_tokens,
        completion: response.usage.completion_tokens,
        total: response.usage.total_tokens,
      }
    }

    return output
  },

  hasFunctionCall: (response: any) => {
    return !!response.choices?.[0]?.message?.function_call
  },
}
