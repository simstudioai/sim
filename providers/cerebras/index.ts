import { ToolConfig } from '@/tools/types'
import { FunctionCallResponse, ProviderConfig, ProviderRequest, ProviderToolConfig } from '../types'

export const cerebrasProvider: ProviderConfig = {
  id: 'cerebras',
  name: 'Cerebras',
  description: "Cerebras' Llama models",
  version: '1.0.0',
  models: ['llama-3.3-70b'],
  defaultModel: 'llama-3.3-70b',

  // Since we're using the SDK directly, we'll set these to empty values
  // They won't be used since we'll handle the execution locally
  baseUrl: '',
  headers: (apiKey: string) => ({}),

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
      local_execution: true, // Enable local execution with the SDK
    }

    // Add standard parameters
    if (request.temperature !== undefined) payload.temperature = request.temperature
    if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

    // Add function calling support
    if (functions) {
      payload.functions = functions
      payload.function_call = 'auto'
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
