import { AgentIcon } from '@/components/icons'
import { createLogger } from '@/lib/logs/console-logger'
import { isHosted } from '@/lib/environment'
import { useOllamaStore } from '@/stores/ollama/store'
import { MODELS_TEMP_RANGE_0_1, MODELS_TEMP_RANGE_0_2 } from '@/providers/model-capabilities'
import { getAllModelProviders, getBaseModelProviders } from '@/providers/utils'
import { ToolResponse } from '@/tools/types'
import { BlockConfig } from '../types'

const logger = createLogger('AgentBlock')

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

// Helper function to get the tool ID from a block type
const getToolIdFromBlock = (blockType: string): string | undefined => {
  try {
    const { getAllBlocks } = require('@/blocks/registry')
    const blocks = getAllBlocks()
    const block = blocks.find((b: { type: string; tools?: { access?: string[] } }) => b.type === blockType)
    return block?.tools?.access?.[0]
  } catch (error) {
    logger.error('Error getting tool ID from block', { error })
    return undefined
  }
}

export const AgentBlock: BlockConfig<AgentResponse> = {
  type: 'agent',
  name: 'Agent',
  description: 'Build an agent',
  longDescription:
    'Create powerful AI agents using any LLM provider with customizable system prompts and tool integrations.',
  category: 'blocks',
  bgColor: '#802FFF',
  icon: AgentIcon,
  subBlocks: [
    {
      id: 'systemPrompt',
      title: 'System Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter system prompt...',
      rows: 5,
    },
    {
      id: 'context',
      title: 'User Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter context or user message...',
      rows: 3,
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      layout: 'half',
      options: () => {
        const ollamaModels = useOllamaStore.getState().models
        const baseModels = Object.keys(getBaseModelProviders())
        return [...baseModels, ...ollamaModels]
      },
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
      // Hide API key for all OpenAI and Claude models when running on hosted version
      condition: isHosted
        ? {
            field: 'model',
            // Include all OpenAI models and Claude models for which we don't show the API key field
            value: [
              // OpenAI models
              'gpt-4o',
              'o1', 'o1-mini', 'o1-preview', 
              'o3', 'o3-preview',
              'o4-mini',
              // Claude models
              'claude-3-5-sonnet-20240620', 
              'claude-3-7-sonnet-20250219'
            ],
            not: true, // Show for all models EXCEPT those listed
          }
        : undefined, // Show for all models in non-hosted environments
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
      language: 'json',
      generationType: 'json-schema',
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
        const tool = getAllModelProviders()[model]
        if (!tool) {
          throw new Error(`Invalid model selected: ${model}`)
        }
        return tool
      },
      params: (params: Record<string, any>) => {
        // If tools array is provided, handle tool usage control
        if (params.tools && Array.isArray(params.tools)) {
          // Transform tools to include usageControl
          const transformedTools = params.tools
            // Filter out tools set to 'none' - they should never be passed to the provider
            .filter((tool: any) => {
              const usageControl = tool.usageControl || 'auto'
              return usageControl !== 'none'
            })
            .map((tool: any) => {
              // Get the base tool configuration
              const toolConfig = {
                id:
                  tool.type === 'custom-tool'
                    ? tool.schema?.function?.name
                    : tool.operation || getToolIdFromBlock(tool.type),
                name: tool.title,
                description: tool.type === 'custom-tool' ? tool.schema?.function?.description : '',
                params: tool.params || {},
                parameters: tool.type === 'custom-tool' ? tool.schema?.function?.parameters : {}, // We'd need to get actual parameters for non-custom tools
                usageControl: tool.usageControl || 'auto',
              }
              return toolConfig
            })

          // Log which tools are being passed and which are filtered out
          const filteredOutTools = params.tools
            .filter((tool: any) => (tool.usageControl || 'auto') === 'none')
            .map((tool: any) => tool.title)

          if (filteredOutTools.length > 0) {
            logger.info('Filtered out tools set to none', { tools: filteredOutTools.join(', ') })
          }

          logger.info('Transformed tools', { tools: transformedTools })
          if (transformedTools.length === 0) {
            logger.info('No tools will be passed to the provider after filtering')
          } else {
            logger.info('Tools passed to provider', { count: transformedTools.length })
          }

          return { ...params, tools: transformedTools }
        }
        return params
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
