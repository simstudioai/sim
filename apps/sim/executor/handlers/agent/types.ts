export interface AgentInputs {
  model?: string
  responseFormat?: string | object
  tools?: ToolInput[]
  systemPrompt?: string
  userPrompt?: string | object
  memories?: any
  temperature?: number
  maxTokens?: number
  apiKey?: string
}

export interface ToolInput {
  type?: string
  schema?: any
  title?: string
  code?: string
  params?: Record<string, any>
  timeout?: number
  usageControl?: 'auto' | 'force' | 'none'
  operation?: string
}

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  function_call?: any
  tool_calls?: any[]
}

export interface StreamingConfig {
  shouldUseStreaming: boolean
  isBlockSelectedForOutput: boolean
  hasOutgoingConnections: boolean
}
