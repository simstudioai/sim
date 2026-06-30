import type { ProviderToolConfig } from '@/providers/types'

/**
 * OpenAI Chat Completions-style tool definition, shared by every
 * OpenAI-compatible provider (groq, mistral, together, etc.).
 */
export interface OpenAIChatToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: ProviderToolConfig['parameters']
  }
}

/**
 * Anthropic Messages API tool definition.
 */
export interface AnthropicToolSchema {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: ProviderToolConfig['parameters']['properties']
    required: ProviderToolConfig['parameters']['required']
  }
}

/**
 * Adapts a tool config to the OpenAI Chat Completions function-wrapped shape.
 */
export function adaptOpenAIChatToolSchema(tool: ProviderToolConfig): OpenAIChatToolSchema {
  return {
    type: 'function',
    function: {
      name: tool.id,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}

/**
 * Adapts a tool config to the Anthropic Messages `input_schema` shape.
 */
export function adaptAnthropicToolSchema(tool: ProviderToolConfig): AnthropicToolSchema {
  return {
    name: tool.id,
    description: tool.description,
    input_schema: {
      type: 'object',
      properties: tool.parameters.properties,
      required: tool.parameters.required,
    },
  }
}
