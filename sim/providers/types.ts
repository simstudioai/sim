export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'xai'
  | 'cerebras'
  | 'groq'
  | 'ollama'

/**
 * Model pricing information per million tokens
 */
export interface ModelPricing {
  input: number // Cost per million tokens for input
  cachedInput?: number // Cost per million tokens for cached input (optional)
  output: number // Cost per million tokens for output
  updatedAt: string // ISO timestamp when pricing was last updated
}

/**
 * Map of model IDs to their pricing information
 */
export type ModelPricingMap = Record<string, ModelPricing>

export interface TokenInfo {
  prompt?: number
  completion?: number
  total?: number
}

export interface TransformedResponse {
  content: string
  tokens?: TokenInfo
}

export interface ProviderConfig {
  id: string
  name: string
  description: string
  version: string
  models: string[]
  defaultModel: string
  initialize?: () => Promise<void>
  executeRequest?: (request: ProviderRequest) => Promise<ProviderResponse>
}

export interface FunctionCallResponse {
  name: string
  arguments: Record<string, any>
  startTime?: string
  endTime?: string
  duration?: number
  result?: Record<string, any>
  output?: Record<string, any>
  input?: Record<string, any>
}

export interface TimeSegment {
  type: 'model' | 'tool'
  name: string
  startTime: number
  endTime: number
  duration: number
}

export interface ProviderResponse {
  content: string
  model: string
  tokens?: {
    prompt?: number
    completion?: number
    total?: number
  }
  toolCalls?: FunctionCallResponse[]
  toolResults?: any[]
  timing?: {
    startTime: string // ISO timestamp when provider execution started
    endTime: string // ISO timestamp when provider execution completed
    duration: number // Total duration in milliseconds
    modelTime?: number // Time spent in model generation (excluding tool calls)
    toolsTime?: number // Time spent in tool calls
    firstResponseTime?: number // Time to first token/response
    iterations?: number // Number of model calls for tool use
    timeSegments?: TimeSegment[] // Detailed timeline of all operations
  }
  cost?: {
    input: number // Cost in USD for input tokens
    output: number // Cost in USD for output tokens
    total: number // Total cost in USD
    pricing: ModelPricing // The pricing used for calculation
  }
}

export type ToolUsageControl = 'auto' | 'force' | 'none'

export interface ProviderToolConfig {
  id: string
  name: string
  description: string
  params: Record<string, any>
  parameters: {
    type: string
    properties: Record<string, any>
    required: string[]
  }
  usageControl?: ToolUsageControl
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'function' | 'tool'
  content: string | null
  name?: string
  function_call?: {
    name: string
    arguments: string
  }
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
  tool_call_id?: string
}

export interface ProviderRequest {
  model: string
  systemPrompt: string
  context?: string
  tools?: ProviderToolConfig[]
  temperature?: number
  maxTokens?: number
  apiKey: string
  messages?: Message[]
  responseFormat?: {
    name: string
    schema: any
    strict?: boolean
  }
  local_execution?: boolean
  workflowId?: string // Optional workflow ID for authentication context
}

// Map of provider IDs to their configurations
export const providers: Record<string, ProviderConfig> = {}
