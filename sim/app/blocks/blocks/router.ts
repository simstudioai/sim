import { ConnectIcon } from '@/components/icons'
import { ProviderId } from '@/providers/types'
import { MODEL_PROVIDERS } from '@/providers/utils'
import { ToolResponse } from '@/tools/types'
import { BlockConfig } from '../types'

interface RouterResponse extends ToolResponse {
  output: {
    content: string
    model: string
    tokens?: {
      prompt?: number
      completion?: number
      total?: number
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
Category: ${block.category}
Configuration: ${JSON.stringify(block.subBlocks, null, 2)}
${block.currentState ? `Current State: ${JSON.stringify(block.currentState, null, 2)}` : ''}
---`
  )
  .join('\n')}

Routing Instructions:
1. Analyze the input request carefully against each block's:
   - Primary purpose (from description)
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
  longDescription:
    'Intelligently direct workflow execution to different paths based on input analysis. Use AI to determine the most appropriate next step in your workflow based on content, intent, or specific criteria.',
  category: 'blocks',
  bgColor: '#28C43F',
  icon: ConnectIcon,
  subBlocks: [
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Route to the correct block based on the input...',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      layout: 'half',
      options: Object.keys(MODEL_PROVIDERS),
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
      id: 'systemPrompt',
      title: 'System Prompt',
      type: 'code',
      layout: 'full',
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
        const tool = MODEL_PROVIDERS[model as ProviderId]
        if (!tool) {
          throw new Error(`Invalid model selected: ${model}`)
        }
        return tool
      },
    },
  },
  inputs: {
    prompt: { type: 'string', required: true },
    model: { type: 'string', required: true },
    apiKey: { type: 'string', required: true },
  },
  outputs: {
    response: {
      type: {
        content: 'string',
        model: 'string',
        tokens: 'any',
        selectedPath: 'json',
      },
    },
  },
}
