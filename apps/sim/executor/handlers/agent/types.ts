import type { FileUploadValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/file-upload/file-upload'

export interface SkillInput {
  skillId: string
  name?: string
  description?: string
}

export interface AgentInputs {
  model?: string
  responseFormat?: string | object
  tools?: ToolInput[]
  skills?: SkillInput[]
  // Legacy inputs (backward compatible)
  systemPrompt?: string
  userPrompt?: string | object
  memories?: any // Legacy memory block output
  // New message array input (from messages-input subblock)
  messages?: Message[]
  // Memory configuration
  memoryType?: 'none' | 'conversation' | 'sliding_window' | 'sliding_window_tokens'
  conversationId?: string // Required for all non-none memory types
  slidingWindowSize?: string // For message-based sliding window
  slidingWindowTokens?: string // For token-based sliding window
  // Deep research multi-turn
  previousInteractionId?: string // Interactions API previous interaction reference
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
  thinkingLevel?: string
}

/**
 * Represents a tool input for the agent block.
 *
 * @remarks
 * Valid types include:
 * - Standard block types (e.g., 'api', 'search', 'function')
 * - 'custom-tool': User-defined tools with custom code
 * - 'mcp': Individual MCP tool from a connected server
 */
export interface ToolInput {
  /** Tool type identifier */
  type?: string
  schema?: any
  title?: string
  code?: string
  /** Tool parameters */
  params?: Record<string, any>
  timeout?: number
  usageControl?: 'auto' | 'force' | 'none'
  operation?: string
  /** Database ID for custom tools (new reference format) */
  customToolId?: string
}

export interface TextMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  executionId?: string
  function_call?: any
  tool_calls?: any[]
}

export interface FilesMessage {
  role: 'files'
  files?: FileUploadValue | null
}

export type Message = TextMessage | FilesMessage

export interface StreamingConfig {
  shouldUseStreaming: boolean
  isBlockSelectedForOutput: boolean
  hasOutgoingConnections: boolean
}
