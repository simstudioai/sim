import { ToolConfig } from '@/tools/types'
import { FunctionCallResponse, ProviderConfig, ProviderRequest, ProviderToolConfig } from '../types'

export const openaiProvider: ProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  description: "OpenAI's GPT models",
  version: '1.0.0',
  models: ['gpt-4o', 'o1', 'o3-mini'],
  defaultModel: 'gpt-4o',

  baseUrl: 'https://api.openai.com/v1/chat/completions',
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
    const isO1Model = request.model?.startsWith('o1')
    const isO1Mini = request.model === 'o1-mini'

    // Helper function to transform message role
    const transformMessageRole = (message: any) => {
      if (isO1Mini && message.role === 'system') {
        return { ...message, role: 'user' }
      }
      return message
    }

    // Start with an empty array for all messages
    const allMessages = []

    // Add system prompt if present
    if (request.systemPrompt) {
      allMessages.push(
        transformMessageRole({
          role: 'system',
          content: request.systemPrompt,
        })
      )
    }

    // Add context if present
    if (request.context) {
      allMessages.push({
        role: 'user',
        content: request.context,
      })
    }

    // Add remaining messages, transforming roles as needed
    if (request.messages) {
      allMessages.push(...request.messages.map(transformMessageRole))
    }

    // Build the request payload
    const payload: any = {
      model: request.model || 'gpt-4o',
      messages: allMessages,
    }

    // Only add parameters supported by the model type
    if (!isO1Model) {
      // gpt-4o supports standard parameters
      if (request.temperature !== undefined) payload.temperature = request.temperature
      if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

      // Add response format for structured output if specified
      if (request.responseFormat) {
        // Use OpenAI's simpler response format
        payload.response_format = { type: 'json_object' }

        // If we have both function calls and response format, we need to guide the model
        if (functions) {
          payload.messages[0].content = `${payload.messages[0].content}\n\nProcess:\n1. First, use the provided functions to gather the necessary data\n2. Then, format your final response as a SINGLE JSON object with these exact fields and types:\n${request.responseFormat.fields
            .map(
              (field) =>
                `- "${field.name}" (${field.type})${field.description ? `: ${field.description}` : ''}`
            )
            .join(
              '\n'
            )}\n\nYour final response after function calls must be a SINGLE valid JSON object with all required fields and correct types. Do not return multiple objects or include any text outside the JSON.`
        } else {
          // If no functions, just format as JSON directly
          payload.messages[0].content = `${payload.messages[0].content}\n\nYou MUST return a SINGLE JSON object with exactly these fields and types:\n${request.responseFormat.fields
            .map(
              (field) =>
                `- "${field.name}" (${field.type})${field.description ? `: ${field.description}` : ''}`
            )
            .join(
              '\n'
            )}\n\nThe response must:\n1. Be a single valid JSON object\n2. Include all the specified fields\n3. Use the correct type for each field\n4. Not include any additional fields\n5. Not include any explanatory text outside the JSON\n6. Not return multiple objects`
        }
      }
    } else {
      // o1 models use max_completion_tokens
      if (request.maxTokens !== undefined) {
        payload.max_completion_tokens = request.maxTokens
      }
    }

    // Add function calling support (supported by all models)
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

      // Add reasoning_tokens for o1 models if available
      if (response.usage.completion_tokens_details?.reasoning_tokens) {
        output.tokens.reasoning = response.usage.completion_tokens_details.reasoning_tokens
      }
    }

    return output
  },

  hasFunctionCall: (response: any) => {
    return !!response.choices?.[0]?.message?.function_call
  },
}
