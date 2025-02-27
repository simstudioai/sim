import { AgentIcon } from '@/components/icons'
import { MODEL_PROVIDERS } from '@/providers/consts'
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
      max: 1,
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
    systemPrompt: { type: 'string', required: true },
    context: { type: 'string', required: false },
    model: { type: 'string', required: true },
    apiKey: { type: 'string', required: true },
    responseFormat: {
      type: 'json',
      required: false,
      description:
        'Define the expected response format. If not provided, returns plain text content.',
      schema: {
        type: 'object',
        properties: {
          fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Name of the field',
                },
                type: {
                  type: 'string',
                  enum: ['string', 'number', 'boolean', 'array', 'object'],
                  description: 'Type of the field',
                },
                isArray: {
                  type: 'boolean',
                  description: 'Whether this field contains multiple values',
                },
                items: {
                  type: 'object',
                  description: 'Schema for array items (required when isArray is true)',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['string', 'number', 'boolean', 'object'],
                    },
                    properties: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          type: {
                            type: 'string',
                            enum: ['string', 'number', 'boolean'],
                          },
                        },
                        required: ['name', 'type'],
                      },
                    },
                  },
                },
                description: {
                  type: 'string',
                  description: 'Description of what this field represents',
                },
              },
              required: ['name', 'type'],
              additionalProperties: false,
            },
          },
        },
        required: ['fields'],
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
