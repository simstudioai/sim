import { AgentIcon } from '@/components/icons'
import { MODELS_TEMP_RANGE_0_1, MODELS_TEMP_RANGE_0_2 } from '@/providers/model-capabilities'
import { MODEL_PROVIDERS } from '@/providers/utils'
import { ToolResponse } from '@/tools/types'
import { BlockConfig } from '../types'

interface AgentResponse extends ToolResponse {
  output: {
    content: string
    model: string
    tokens?: {
      prompt?: number
      completion?: number
      total?: number
    }
    toolCalls?: {
      list: Array<{
        name: string
        arguments: Record<string, any>
      }>
      count: number
    }
  }
}

export const AgentBlock: BlockConfig<AgentResponse> = {
  type: 'agent',
  name: 'Agent',
  description: 'Build an agent',
  longDescription:
    'Create powerful AI agents using any LLM provider with customizable system prompts and tool integrations.',
  category: 'blocks',
  bgColor: '#7F2FFF',
  icon: AgentIcon,
  subBlocks: [
    {
      id: 'systemPrompt',
      title: 'System Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter system prompt...',
    },
    {
      id: 'context',
      title: 'User Prompt',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter context or user message...',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      layout: 'half',
      options: Object.keys(MODEL_PROVIDERS),
    },
    {
      id: 'temperature',
      title: 'Temperature',
      type: 'slider',
      layout: 'half',
      min: 0,
      max: 2,
      condition: {
        field: 'model',
        value: MODELS_TEMP_RANGE_0_2,
      },
    },
    {
      id: 'temperature',
      title: 'Temperature',
      type: 'slider',
      layout: 'half',
      min: 0,
      max: 1,
      condition: {
        field: 'model',
        value: MODELS_TEMP_RANGE_0_1,
      },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your API key',
      password: true,
      connectionDroppable: false,
    },
    {
      id: 'tools',
      title: 'Tools',
      type: 'tool-input',
      layout: 'full',
    },
    {
      id: 'responseFormat',
      title: 'Response Format',
      type: 'code',
      layout: 'full',
      placeholder: `Enter JSON schema...`,
    },
  ],
  tools: {
    access: [
      'openai_chat',
      'anthropic_chat',
      'google_chat',
      'xai_chat',
      'deepseek_chat',
      'deepseek_reasoner',
    ],
    config: {
      tool: (params: Record<string, any>) => {
        const model = params.model || 'gpt-4o'
        if (!model) {
          throw new Error('No model selected')
        }
        const tool = MODEL_PROVIDERS[model]
        if (!tool) {
          throw new Error(`Invalid model selected: ${model}`)
        }
        return tool
      },
    },
  },
  inputs: {
    systemPrompt: { type: 'string', required: false },
    context: { type: 'string', required: false },
    model: { type: 'string', required: true },
    apiKey: { type: 'string', required: true },
    responseFormat: {
      type: 'json',
      required: false,
      description:
        'Define the expected response format using JSON Schema. If not provided, returns plain text content.',
      schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'A name for your schema (optional)',
          },
          schema: {
            type: 'object',
            description: 'The JSON Schema definition',
            properties: {
              type: {
                type: 'string',
                enum: ['object'],
                description: 'Must be "object" for a valid JSON Schema',
              },
              properties: {
                type: 'object',
                description: 'Object containing property definitions',
              },
              required: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of required property names',
              },
              additionalProperties: {
                type: 'boolean',
                description: 'Whether additional properties are allowed',
              },
            },
            required: ['type', 'properties'],
          },
          strict: {
            type: 'boolean',
            description: 'Whether to enforce strict schema validation',
            default: true,
          },
        },
        required: ['schema'],
      },
    },
    temperature: { type: 'number', required: false },
    tools: { type: 'json', required: false },
  },
  outputs: {
    response: {
      type: {
        content: 'string',
        model: 'string',
        tokens: 'any',
        toolCalls: 'any',
      },
      dependsOn: {
        subBlockId: 'responseFormat',
        condition: {
          whenEmpty: {
            content: 'string',
            model: 'string',
            tokens: 'any',
            toolCalls: 'any',
          },
          whenFilled: 'json',
        },
      },
    },
  },
}
