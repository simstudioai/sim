import { AgentIcon } from '@/components/icons'
import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import type { BlockConfig } from '@/blocks/types'
import {
  getAllModelProviders,
  getBaseModelProviders,
  getHostedModels,
  getProviderIcon,
  MODELS_TEMP_RANGE_0_1,
  MODELS_TEMP_RANGE_0_2,
  MODELS_WITH_TEMPERATURE_SUPPORT,
  providers,
} from '@/providers/utils'
import { useOllamaStore } from '@/stores/ollama/store'
import type { ToolResponse } from '@/tools/types'

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
    const block = blocks.find(
      (b: { type: string; tools?: { access?: string[] } }) => b.type === blockType
    )
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
  docsLink: 'https://docs.sim.ai/blocks/agent',
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
      wandConfig: {
        enabled: true,
        maintainHistory: true, // Enable conversation history for iterative improvements
        prompt: `You are an expert at writing system prompts for AI agents. Write a system prompt based exactly on what the user asks for.

Current context: {context}

IMPORTANT: Write the system prompt as if the user asked you directly to create it. Match their level of detail and complexity. If they ask for something "comprehensive" or "detailed", write a thorough, in-depth prompt. If they ask for something "simple", keep it concise.

Key guidelines:
- Always start with "You are..." to define the agent's role
- Include everything the user specifically requests
- If they mention specific tools (like "use Exa to search", "send emails via Gmail", "post to Slack"), explicitly include those tool usage instructions in the prompt
- If they want extensive capabilities, write extensively about them
- If they mention specific behaviors, tone, or constraints, include those
- Write naturally - don't worry about sentence counts or rigid structure
- Focus on being comprehensive when they ask for comprehensive

Tool Integration: Since this is an AI agent platform, users often want agents that use specific tools. If the user mentions:
- Web search → Include instructions about using search tools like Exa
- Email → Include instructions about Gmail integration
- Communication → Include Slack, Discord, Teams instructions
- Data → Include instructions about databases, APIs, spreadsheets
- Any other specific tools → Include explicit usage instructions

Examples:
SIMPLE REQUEST: "Write a basic customer service agent"
You are a helpful customer service representative. Assist customers with their questions about orders, returns, and products. Be polite and professional in all interactions.

COMPREHENSIVE REQUEST: "Create a detailed AI research assistant that can search the web and analyze information"
You are an advanced AI research assistant specializing in conducting thorough research and analysis across various topics. Your primary capabilities include web searching, information synthesis, critical analysis, and presenting findings in clear, actionable formats. When conducting research, use Exa or other web search tools to gather current, relevant information from authoritative sources. Always verify information from multiple sources when possible and clearly distinguish between established facts and emerging trends or opinions. For each research query, begin by understanding the specific research objectives, target audience, and desired depth of analysis. Structure your research process systematically: start with broad topic exploration, then narrow down to specific aspects, and finally synthesize findings into coherent insights. When presenting results, include source citations, highlight key findings, note any limitations or gaps in available information, and suggest areas for further investigation. Adapt your communication style to match the user's expertise level - provide detailed technical explanations for expert audiences and clear, accessible summaries for general audiences. Always maintain objectivity and acknowledge when information is uncertain or conflicting.

Write naturally and comprehensively based on what the user actually asks for.`,
        placeholder: 'Describe the AI agent you want to create...',
        generationType: 'system-prompt',
      },
    },
    {
      id: 'userPrompt',
      title: 'User Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter context or user message...',
      rows: 3,
    },
    {
      id: 'memories',
      title: 'Memories',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Connect memory block output...',
      mode: 'advanced',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'combobox',
      layout: 'half',
      placeholder: 'Type or select a model...',
      options: () => {
        const ollamaModels = useOllamaStore.getState().models
        const baseModels = Object.keys(getBaseModelProviders())
        const allModels = [...baseModels, ...ollamaModels]

        return allModels.map((model) => {
          const icon = getProviderIcon(model)
          return { label: model, id: model, ...(icon && { icon }) }
        })
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
      layout: 'full',
      min: 0,
      max: 2,
      condition: {
        field: 'model',
        value: [...MODELS_TEMP_RANGE_0_1, ...MODELS_TEMP_RANGE_0_2],
        not: true,
        and: {
          field: 'model',
          value: Object.keys(getBaseModelProviders()).filter(
            (model) => !MODELS_WITH_TEMPERATURE_SUPPORT.includes(model)
          ),
          not: true,
        },
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
      // Hide API key for all hosted models when running on hosted version
      condition: isHosted
        ? {
            field: 'model',
            value: getHostedModels(),
            not: true, // Show for all models EXCEPT those listed
          }
        : undefined, // Show for all models in non-hosted environments
    },
    {
      id: 'azureEndpoint',
      title: 'Azure OpenAI Endpoint',
      type: 'short-input',
      layout: 'full',
      password: true,
      placeholder: 'https://your-resource.openai.azure.com',
      connectionDroppable: false,
      condition: {
        field: 'model',
        value: providers['azure-openai'].models,
      },
    },
    {
      id: 'azureApiVersion',
      title: 'Azure API Version',
      type: 'short-input',
      layout: 'full',
      placeholder: '2024-07-01-preview',
      connectionDroppable: false,
      condition: {
        field: 'model',
        value: providers['azure-openai'].models,
      },
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
      placeholder: 'Enter JSON schema...',
      language: 'json',
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert programmer specializing in creating JSON schemas according to a specific format.
Generate ONLY the JSON schema based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.
The JSON object MUST have the following top-level properties: 'name' (string), 'description' (string), 'strict' (boolean, usually true), and 'schema' (object).
The 'schema' object must define the structure and MUST contain 'type': 'object', 'properties': {...}, 'additionalProperties': false, and 'required': [...].
Inside 'properties', use standard JSON Schema properties (type, description, enum, items for arrays, etc.).

Current schema: {context}

Do not include any explanations, markdown formatting, or other text outside the JSON object.

Valid Schema Examples:

Example 1:
{
    "name": "reddit_post",
    "description": "Fetches the reddit posts in the given subreddit",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "The title of the post"
            },
            "content": {
                "type": "string",
                "description": "The content of the post"
            }
        },
        "additionalProperties": false,
        "required": [ "title", "content" ]
    }
}

Example 2:
{
    "name": "get_weather",
    "description": "Fetches the current weather for a specific location.",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "location": {
                "type": "string",
                "description": "The city and state, e.g., San Francisco, CA"
            },
            "unit": {
                "type": "string",
                "description": "Temperature unit",
                "enum": ["celsius", "fahrenheit"]
            }
        },
        "additionalProperties": false,
        "required": ["location", "unit"]
    }
}

Example 3 (Array Input):
{
    "name": "process_items",
    "description": "Processes a list of items with specific IDs.",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "item_ids": {
                "type": "array",
                "description": "A list of unique item identifiers to process.",
                "items": {
                    "type": "string",
                    "description": "An item ID"
                }
            },
            "processing_mode": {
                "type": "string",
                "description": "The mode for processing",
                "enum": ["fast", "thorough"]
            }
        },
        "additionalProperties": false,
        "required": ["item_ids", "processing_mode"]
    }
}
`,
        placeholder: 'Describe the JSON schema structure you need...',
        generationType: 'json-schema',
      },
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
    userPrompt: { type: 'string', required: false },
    memories: { type: 'json', required: false },
    model: { type: 'string', required: true },
    apiKey: { type: 'string', required: true },
    azureEndpoint: { type: 'string', required: false },
    azureApiVersion: { type: 'string', required: false },
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
    content: 'string',
    model: 'string',
    tokens: 'any',
    toolCalls: 'any',
  },
}
