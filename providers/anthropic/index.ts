import {
  FunctionCallResponse,
  Message,
  ProviderConfig,
  ProviderRequest,
  ProviderToolConfig,
} from '../types'

export const anthropicProvider: ProviderConfig = {
  id: 'anthropic',
  name: 'Anthropic',
  description: "Anthropic's Claude models",
  version: '1.0.0',
  models: ['claude-3-7-sonnet-20250219'],
  defaultModel: 'claude-3-7-sonnet-20250219',

  baseUrl: 'https://api.anthropic.com/v1/messages',
  headers: (apiKey: string) => ({
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }),

  transformToolsToFunctions: (tools: ProviderToolConfig[]) => {
    if (!tools || tools.length === 0) {
      return undefined
    }

    return tools.map((tool) => ({
      name: tool.id,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    }))
  },

  transformFunctionCallResponse: (
    response: any,
    tools?: ProviderToolConfig[]
  ): FunctionCallResponse => {
    const rawResponse = response?.output || response
    if (!rawResponse?.content) {
      throw new Error('No content found in response')
    }

    const toolUse = rawResponse.content.find((item: any) => item.type === 'tool_use')
    if (!toolUse) {
      throw new Error('No tool use found in response')
    }

    const tool = tools?.find((t) => t.id === toolUse.name)
    if (!tool) {
      throw new Error(`Tool not found: ${toolUse.name}`)
    }

    let input = toolUse.input
    if (typeof input === 'string') {
      try {
        input = JSON.parse(input)
      } catch (e) {
        console.error('Failed to parse tool input:', e)
        input = {}
      }
    }

    return {
      name: toolUse.name,
      arguments: {
        ...tool.params,
        ...input,
      },
    }
  },

  transformRequest: (request: ProviderRequest, functions?: any) => {
    // Transform messages to Anthropic format
    const messages =
      request.messages?.map((msg) => {
        if (msg.role === 'function') {
          return {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: msg.name,
                content: msg.content,
              },
            ],
          }
        }

        if (msg.function_call) {
          return {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: msg.function_call.name,
                name: msg.function_call.name,
                input: JSON.parse(msg.function_call.arguments),
              },
            ],
          }
        }

        return {
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content ? [{ type: 'text', text: msg.content }] : [],
        }
      }) || []

    // Add context if provided
    if (request.context) {
      messages.unshift({
        role: 'user',
        content: [{ type: 'text', text: request.context }],
      })
    }

    // Ensure there's at least one message by adding the system prompt as a user message if no messages exist
    if (messages.length === 0) {
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: request.systemPrompt || '' }],
      })
    }

    // Build the request payload
    const payload = {
      model: request.model || 'claude-3-7-sonnet-20250219',
      messages,
      system: request.systemPrompt || '',
      max_tokens: parseInt(String(request.maxTokens)) || 1024,
      temperature: parseFloat(String(request.temperature ?? 0.7)),
      ...(functions && { tools: functions }),
    }

    // If response format is specified, add strict formatting instructions
    if (request.responseFormat) {
      payload.system = `${payload.system}\n\nIMPORTANT RESPONSE FORMAT INSTRUCTIONS:
1. Your response must be EXACTLY in this format, with no additional fields:
{
${request.responseFormat.fields.map((field) => `  "${field.name}": ${field.type === 'string' ? '"value"' : field.type === 'array' ? '[]' : field.type === 'object' ? '{}' : field.type === 'number' ? '0' : 'true/false'}`).join(',\n')}
}

Field descriptions:
${request.responseFormat.fields.map((field) => `${field.name} (${field.type})${field.description ? `: ${field.description}` : ''}`).join('\n')}

2. DO NOT include any explanatory text before or after the JSON
3. DO NOT wrap the response in an array
4. DO NOT add any fields not specified in the schema
5. Your response MUST be valid JSON and include all the specified fields with their correct types`
    }

    return payload
  },

  transformResponse: (response: any) => {
    try {
      if (!response) {
        console.warn('Received undefined response from Anthropic API')
        return { content: '' }
      }

      // Get the actual response content
      const rawResponse = response.output || response

      // Extract text content from the message
      let content = ''
      const messageContent = rawResponse?.content || rawResponse?.message?.content

      if (Array.isArray(messageContent)) {
        content = messageContent
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('\n')
      } else if (typeof messageContent === 'string') {
        content = messageContent
      }

      // If the content looks like it contains JSON, extract just the JSON part
      if (content.includes('{') && content.includes('}')) {
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/m)
          if (jsonMatch) {
            content = jsonMatch[0]
          }
        } catch (e) {
          console.error('Error extracting JSON from response:', e)
        }
      }

      return {
        content,
        model: rawResponse?.model || response?.model || 'claude-3-7-sonnet-20250219',
        tokens: rawResponse?.usage && {
          prompt: rawResponse.usage.input_tokens,
          completion: rawResponse.usage.output_tokens,
          total: rawResponse.usage.input_tokens + rawResponse.usage.output_tokens,
        },
      }
    } catch (error) {
      console.error('Error in transformResponse:', error)
      return { content: '' }
    }
  },

  hasFunctionCall: (response: any) => {
    try {
      if (!response) return false
      const rawResponse = response.output || response
      return rawResponse?.content?.some((item: any) => item.type === 'tool_use') || false
    } catch (error) {
      console.error('Error in hasFunctionCall:', error)
      return false
    }
  },
}
