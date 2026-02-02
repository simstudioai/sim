import { ConnectIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import { getProviderCredentialSubBlocks, PROVIDER_CREDENTIAL_INPUTS } from '@/blocks/utils'
import type { ProviderId } from '@/providers/types'
import { getBaseModelProviders, getProviderIcon } from '@/providers/utils'
import { useProvidersStore } from '@/stores/providers'
import type { ToolResponse } from '@/tools/types'

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

/**
 * Generates the system prompt for the legacy router (block-based).
 */
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

/**
 * Generates the system prompt for the port-based router (v2).
 * Instead of selecting a block by ID, it selects a route by evaluating all route descriptions.
 */
export const generateRouterV2Prompt = (
  context: string,
  routes: Array<{ id: string; title: string; value: string }>
): string => {
  const routesInfo = routes
    .map(
      (route, index) => `
Route ${index + 1}:
ID: ${route.id}
Description: ${route.value || 'No description provided'}
---`
    )
    .join('\n')

  return `You are a DETERMINISTIC routing agent. You MUST select exactly ONE option.

Available Routes:
${routesInfo}

Context to route:
${context}

ROUTING RULES:
1. ALWAYS prefer selecting a route over NO_MATCH
2. Pick the route whose description BEST matches the context, even if it's not a perfect match
3. If the context is even partially related to a route's description, select that route
4. ONLY output NO_MATCH if the context is completely unrelated to ALL route descriptions

Respond with a JSON object containing:
- route: EXACTLY one route ID (copied exactly as shown above) OR "NO_MATCH"
- reasoning: A brief explanation (1-2 sentences) of why you chose this route`
}

/**
 * Helper to get model options for both router versions.
 */
const getModelOptions = () => {
  const providersState = useProvidersStore.getState()
  const baseModels = providersState.providers.base.models
  const ollamaModels = providersState.providers.ollama.models
  const vllmModels = providersState.providers.vllm.models
  const openrouterModels = providersState.providers.openrouter.models
  const allModels = Array.from(
    new Set([...baseModels, ...ollamaModels, ...vllmModels, ...openrouterModels])
  )

  return allModels.map((model) => {
    const icon = getProviderIcon(model)
    return { label: model, id: model, ...(icon && { icon }) }
  })
}

/**
 * Legacy Router Block (block-based routing).
 * Hidden from toolbar but still supported for existing workflows.
 */
export const RouterBlock: BlockConfig<RouterResponse> = {
  type: 'router',
  name: 'Router (Legacy)',
  description: 'Route workflow',
  authMode: AuthMode.ApiKey,
  docsLink: 'https://docs.sim.ai/blocks/router',
  longDescription:
    'This is a core workflow block. Intelligently direct workflow execution to different paths based on input analysis. Use natural language to instruct the router to route to certain blocks based on the input.',
  bestPractices: `
  - For the prompt, make it almost programmatic. Use the system prompt to define the routing criteria. Should be very specific with no ambiguity.
  - Use the target block *names* to define the routing criteria.
  `,
  category: 'blocks',
  bgColor: '#28C43F',
  icon: ConnectIcon,
  hideFromToolbar: true, // Hide legacy version from toolbar
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
      defaultValue: 'claude-sonnet-4-5',
      options: getModelOptions,
    },
    ...getProviderCredentialSubBlocks(),
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
        const tool = getBaseModelProviders()[model as ProviderId]
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
    ...PROVIDER_CREDENTIAL_INPUTS,
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
    selectedRoute: { type: 'string', description: 'Selected route ID' },
  },
}

/**
 * Router V2 Block (port-based routing).
 * Uses route definitions with descriptions instead of downstream block names.
 */
interface RouterV2Response extends ToolResponse {
  output: {
    context: string
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
    selectedRoute: string
    reasoning: string
    selectedPath: {
      blockId: string
      blockType: string
      blockTitle: string
    }
  }
}

export const RouterV2Block: BlockConfig<RouterV2Response> = {
  type: 'router_v2',
  name: 'Router',
  description: 'Route workflow based on context',
  authMode: AuthMode.ApiKey,
  docsLink: 'https://docs.sim.ai/blocks/router',
  longDescription:
    'Intelligently route workflow execution to different paths based on context analysis. Define multiple routes with descriptions, and an LLM will determine which route to take based on the provided context.',
  bestPractices: `
  - Write clear, specific descriptions for each route
  - The context field should contain all relevant information for routing decisions
  - Route descriptions should be mutually exclusive when possible
  - Use descriptive route names to make the workflow readable
  `,
  category: 'blocks',
  bgColor: '#28C43F',
  icon: ConnectIcon,
  subBlocks: [
    {
      id: 'context',
      title: 'Context',
      type: 'long-input',
      placeholder: 'Enter the context to analyze for routing...',
      required: true,
    },
    {
      id: 'routes',
      type: 'router-input',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'combobox',
      placeholder: 'Type or select a model...',
      required: true,
      defaultValue: 'claude-sonnet-4-5',
      options: getModelOptions,
    },
    ...getProviderCredentialSubBlocks(),
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
        const tool = getBaseModelProviders()[model as ProviderId]
        if (!tool) {
          throw new Error(`Invalid model selected: ${model}`)
        }
        return tool
      },
    },
  },
  inputs: {
    context: { type: 'string', description: 'Context for routing decision' },
    routes: { type: 'json', description: 'Route definitions with descriptions' },
    model: { type: 'string', description: 'AI model to use' },
    ...PROVIDER_CREDENTIAL_INPUTS,
  },
  outputs: {
    context: { type: 'string', description: 'Context used for routing' },
    model: { type: 'string', description: 'Model used' },
    tokens: { type: 'json', description: 'Token usage' },
    cost: { type: 'json', description: 'Cost information' },
    selectedRoute: { type: 'string', description: 'Selected route ID' },
    reasoning: { type: 'string', description: 'Explanation of why this route was chosen' },
    selectedPath: { type: 'json', description: 'Selected routing path' },
  },
}
