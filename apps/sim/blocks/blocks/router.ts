import { ConnectIcon } from '@/components/icons'
import { isHosted } from '@/lib/environment'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { ProviderId } from '@/providers/types'
import {
  getAllModelProviders,
  getHostedModels,
  getProviderIcon,
  providers,
} from '@/providers/utils'
import { useProvidersStore } from '@/stores/providers/store'
import type { ToolResponse } from '@/tools/types'

const getCurrentOllamaModels = () => {
  return useProvidersStore.getState().providers.ollama.models
}

interface RouterResponse extends ToolResponse {
  output: {
    prompt: string
    model: string
    tokens?: {
      prompt?: number
      completion?: number
      total?: number
    }
    cost?: {
      input: number
      output: number
      total: number
    }
    selectedPath: {
      blockId: string
      blockType: string
      blockTitle: string
    }
  }
}

interface TargetBlock {
  id: string
  type?: string
  title?: string
  description?: string
  category?: string
  subBlocks?: Record<string, any>
  currentState?: any
}

export const generateRouterPrompt = (prompt: string, targetBlocks?: TargetBlock[]): string => {
  const basePrompt = `You are an intelligent routing agent responsible for directing workflow requests to the most appropriate block. Your task is to analyze the input and determine the single most suitable destination based on the request.

Key Instructions:
1. You MUST choose exactly ONE destination from the IDs of the blocks in the workflow. The destination must be a valid block id.

2. Analysis Framework:
   - Carefully evaluate the intent and requirements of the request
   - Consider the primary action needed
   - Match the core functionality with the most appropriate destination`

  // If we have target blocks, add their information to the prompt
  const targetBlocksInfo = targetBlocks
    ? `

Available Target Blocks:
${targetBlocks
  .map(
    (block) => `
ID: ${block.id}
Type: ${block.type}
Title: ${block.title}
Description: ${block.description}
System Prompt: ${JSON.stringify(block.subBlocks?.systemPrompt || '')}
Configuration: ${JSON.stringify(block.subBlocks, null, 2)}
${block.currentState ? `Current State: ${JSON.stringify(block.currentState, null, 2)}` : ''}
---`
  )
  .join('\n')}

Routing Instructions:
1. Analyze the input request carefully against each block's:
   - Primary purpose (from title, description, and system prompt)
   - Look for keywords in the system prompt that match the user's request
   - Configuration settings
   - Current state (if available)
   - Processing capabilities

2. Selection Criteria:
   - Choose the block that best matches the input's requirements
   - Consider the block's specific functionality and constraints
   - Factor in any relevant current state or configuration
   - Prioritize blocks that can handle the input most effectively`
    : ''

  return `${basePrompt}${targetBlocksInfo}

Routing Request: ${prompt}

Response Format:
Return ONLY the destination id as a single word, lowercase, no punctuation or explanation.
Example: "2acd9007-27e8-4510-a487-73d3b825e7c1"

Remember: Your response must be ONLY the block ID - no additional text, formatting, or explanation.`
}

export const RouterBlock: BlockConfig<RouterResponse> = {
  type: 'router',
  name: 'Router',
  description: 'Route workflow',
  authMode: AuthMode.ApiKey,
  longDescription:
    'This is a core workflow block. Intelligently direct workflow execution to different paths based on input analysis. Use natural language to instruct the router to route to certain blocks based on the input.',
  bestPractices: `
  - For the prompt, make it almost programmatic. Use the system prompt to define the routing criteria. Should be very specific with no ambiguity.
  - Use the target block *names* to define the routing criteria.
  `,
  category: 'blocks',
  bgColor: '#28C43F',
  icon: ConnectIcon,
  subBlocks: [
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      placeholder: 'Route to the correct block based on the input...',
      required: true,
    },
    {
      id: 'model',
      title: 'Model',
      type: 'combobox',
      placeholder: 'Type or select a model...',
      required: true,
      options: () => {
        const providersState = useProvidersStore.getState()
        const baseModels = providersState.providers.base.models
        const ollamaModels = providersState.providers.ollama.models
        const openrouterModels = providersState.providers.openrouter.models
        const allModels = Array.from(new Set([...baseModels, ...ollamaModels, ...openrouterModels]))

        return allModels.map((model) => {
          const icon = getProviderIcon(model)
          return { label: model, id: model, ...(icon && { icon }) }
        })
      },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your API key',
      password: true,
      connectionDroppable: false,
      required: true,
      // Hide API key for hosted models and Ollama models
      condition: isHosted
        ? {
            field: 'model',
            value: getHostedModels(),
            not: true, // Show for all models EXCEPT those listed
          }
        : () => ({
            field: 'model',
            value: getCurrentOllamaModels(),
            not: true, // Show for all models EXCEPT Ollama models
          }),
    },
    {
      id: 'azureEndpoint',
      title: 'Azure OpenAI Endpoint',
      type: 'short-input',
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
      placeholder: '2024-07-01-preview',
      connectionDroppable: false,
      condition: {
        field: 'model',
        value: providers['azure-openai'].models,
      },
    },
    {
      id: 'temperature',
      title: 'Temperature',
      type: 'slider',
      hidden: true,
      min: 0,
      max: 2,
    },
    {
      id: 'systemPrompt',
      title: 'System Prompt',
      type: 'code',
      hidden: true,
      value: (params: Record<string, any>) => {
        return generateRouterPrompt(params.prompt || '')
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
        const tool = getAllModelProviders()[model as ProviderId]
        if (!tool) {
          throw new Error(`Invalid model selected: ${model}`)
        }
        return tool
      },
    },
  },
  inputs: {
    prompt: { type: 'string', description: 'Routing prompt content' },
    model: { type: 'string', description: 'AI model to use' },
    apiKey: { type: 'string', description: 'Provider API key' },
    azureEndpoint: { type: 'string', description: 'Azure OpenAI endpoint URL' },
    azureApiVersion: { type: 'string', description: 'Azure API version' },
    temperature: {
      type: 'number',
      description: 'Response randomness level (low for consistent routing)',
    },
  },
  outputs: {
    prompt: { type: 'string', description: 'Routing prompt used' },
    model: { type: 'string', description: 'Model used' },
    tokens: { type: 'json', description: 'Token usage' },
    cost: { type: 'json', description: 'Cost information' },
    selectedPath: { type: 'json', description: 'Selected routing path' },
  },
}
