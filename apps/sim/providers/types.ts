import type { StreamingExecution } from '@/executor/types'

export type ProviderId =
  | 'openai'
  | 'azure-openai'
  | 'anthropic'
  | 'azure-anthropic'
  | 'google'
  | 'vertex'
  | 'deepseek'
  | 'xai'
  | 'cerebras'
  | 'groq'
  | 'mistral'
  | 'ollama'
  | 'openrouter'
  | 'vllm'
  | 'bedrock'

export interface ModelPricing {
  input: number // Per 1M tokens
  cachedInput?: number // Per 1M tokens (if supported)
  output: number // Per 1M tokens
  updatedAt: string // Last updated date
}

export type ModelPricingMap = Record<string, ModelPricing>

export interface TokenInfo {
  input?: number
  output?: number
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
  executeRequest: (
    request: ProviderRequest
  ) => Promise<ProviderResponse | ReadableStream<any> | StreamingExecution>
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
    input?: number
    output?: number
    total?: number
  }
  toolCalls?: FunctionCallResponse[]
  toolResults?: any[]
  timing?: {
    startTime: string
    endTime: string
    duration: number
    modelTime?: number
    toolsTime?: number
    firstResponseTime?: number
    iterations?: number
    timeSegments?: TimeSegment[]
  }
  cost?: {
    input: number
    output: number
    total: number
    pricing: ModelPricing
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
  systemPrompt?: string
  context?: string
  tools?: ProviderToolConfig[]
  temperature?: number
  maxTokens?: number
  apiKey?: string
  messages?: Message[]
  responseFormat?: {
    name: string
    schema: any
    strict?: boolean
  }
  local_execution?: boolean
  workflowId?: string
  workspaceId?: string
  chatId?: string
  userId?: string
  stream?: boolean
  streamToolCalls?: boolean
  environmentVariables?: Record<string, string>
  workflowVariables?: Record<string, any>
  blockData?: Record<string, any>
  blockNameMapping?: Record<string, string>
  isCopilotRequest?: boolean
  isBYOK?: boolean
  azureEndpoint?: string
  azureApiVersion?: string
  vertexProject?: string
  vertexLocation?: string
  bedrockAccessKeyId?: string
  bedrockSecretKey?: string
  bedrockRegion?: string
  reasoningEffort?: string
  verbosity?: string
  thinkingLevel?: string
  isDeployedContext?: boolean
}

export const providers: Record<string, ProviderConfig> = {}
