export interface AgentInputs {
  model?: string
  responseFormat?: string | object
  tools?: ToolInput[]
  // Legacy inputs (backward compatible)
  systemPrompt?: string
  userPrompt?: string | object
  memories?: any // Legacy memory block output
  // New message array input (from messages-input subblock or raw JSON from advanced mode)
  messages?: Message[] | string
  // Memory configuration
  memoryType?: 'none' | 'conversation' | 'sliding_window' | 'sliding_window_tokens'
  conversationId?: string // Required for all non-none memory types
  slidingWindowSize?: string // For message-based sliding window
  slidingWindowTokens?: string // For token-based sliding window
  // LLM parameters
  temperature?: string
  maxTokens?: string
  apiKey?: string
  azureEndpoint?: string
  azureApiVersion?: string
  vertexProject?: string
  vertexLocation?: string
  vertexCredential?: string
  bedrockAccessKeyId?: string
  bedrockSecretKey?: string
  bedrockRegion?: string
  reasoningEffort?: string
  verbosity?: string
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
  /** Database ID for custom tools (new reference format) */
  customToolId?: string
}

/**
 * Attachment content (files, images, documents)
 */
export interface AttachmentContent {
  /** Source type: how the data was provided */
  sourceType: 'url' | 'base64' | 'file'
  /** The URL or base64 data */
  data: string
  /** MIME type (e.g., 'image/png', 'application/pdf', 'audio/mp3') */
  mimeType?: string
  /** Optional filename for file uploads */
  fileName?: string
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'attachment'
  content: string
  /** Attachment content for 'attachment' role messages */
  attachment?: AttachmentContent
  executionId?: string
  function_call?: any
  tool_calls?: any[]
}

export interface StreamingConfig {
  shouldUseStreaming: boolean
  isBlockSelectedForOutput: boolean
  hasOutgoingConnections: boolean
}
