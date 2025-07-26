/**
 * Citation interface for documentation references
 */
export interface Citation {
  id: number
  title: string
  url: string
  similarity?: number
}

/**
 * Tool call interface for copilot
 */
export interface CopilotToolCall {
  id: string
  name: string
  displayName: string
  input: Record<string, any>
  state: 'executing' | 'completed' | 'error' | 'ready_for_review' | 'applied' | 'rejected'
  startTime?: number
  endTime?: number
  duration?: number
  result?: any
  error?: string
}

/**
 * Content block types for preserving chronological order
 */
export interface TextContentBlock {
  type: 'text'
  content: string
  timestamp: number
}

export interface ToolCallContentBlock {
  type: 'tool_call'
  toolCall: CopilotToolCall
  timestamp: number
}

export type ContentBlock = TextContentBlock | ToolCallContentBlock

/**
 * Copilot message interface
 */
export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  citations?: Citation[]
  toolCalls?: CopilotToolCall[]
  contentBlocks?: ContentBlock[] // New chronological content structure
}

/**
 * Copilot checkpoint structure
 */
export interface CopilotCheckpoint {
  id: string
  userId: string
  workflowId: string
  chatId: string
  yaml: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Chat mode types
 */
export type CopilotMode = 'ask' | 'agent'

/**
 * Chat interface for copilot conversations
 */
export interface CopilotChat {
  id: string
  title: string | null
  model: string
  messages: CopilotMessage[]
  messageCount: number
  previewYaml: string | null // YAML content for pending workflow preview
  createdAt: Date
  updatedAt: Date
}

/**
 * Options for creating a new chat
 */
export interface CreateChatOptions {
  title?: string
  initialMessage?: string
}

/**
 * Options for sending messages
 */
export interface SendMessageOptions {
  stream?: boolean
}

/**
 * Options for sending docs messages
 */
export interface SendDocsMessageOptions {
  stream?: boolean
  topK?: number
}

/**
 * Copilot store state
 */
export interface CopilotState {
  // Current mode
  mode: CopilotMode

  // Chat management
  currentChat: CopilotChat | null
  chats: CopilotChat[]
  messages: CopilotMessage[]
  workflowId: string | null

  // Checkpoint management
  checkpoints: CopilotCheckpoint[]

  // Loading states
  isLoading: boolean
  isLoadingChats: boolean
  isLoadingCheckpoints: boolean
  isSendingMessage: boolean
  isSaving: boolean
  isRevertingCheckpoint: boolean
  isAborting: boolean

  // Error states
  error: string | null
  saveError: string | null
  checkpointError: string | null

  // Abort controller for cancelling requests
  abortController: AbortController | null
}

/**
 * Copilot store actions
 */
export interface CopilotActions {
  // Mode management
  setMode: (mode: CopilotMode) => void

  // Chat management
  setWorkflowId: (workflowId: string | null) => Promise<void>
  validateCurrentChat: () => boolean
  loadChats: () => Promise<void>
  selectChat: (chat: CopilotChat) => Promise<void>
  createNewChat: (options?: CreateChatOptions) => Promise<void>
  deleteChat: (chatId: string) => Promise<void>

  // Message handling
  sendMessage: (message: string, options?: SendMessageOptions) => Promise<void>
  abortMessage: () => void
  sendImplicitFeedback: (
    implicitFeedback: string,
    toolCallState?: 'applied' | 'rejected'
  ) => Promise<void>
  updatePreviewToolCallState: (toolCallState: 'applied' | 'rejected') => void
  sendDocsMessage: (query: string, options?: SendDocsMessageOptions) => Promise<void>
  saveChatMessages: (chatId: string) => Promise<void>

  // Checkpoint management
  loadCheckpoints: (chatId: string) => Promise<void>
  revertToCheckpoint: (checkpointId: string) => Promise<void>

  // Preview management
  setPreviewYaml: (yamlContent: string) => Promise<void>
  clearPreviewYaml: () => Promise<void>

  // Utility actions
  clearMessages: () => void
  clearError: () => void
  clearSaveError: () => void
  clearCheckpointError: () => void
  retrySave: (chatId: string) => Promise<void>
  reset: () => void

  // Internal helpers (not exposed publicly)
  handleStreamingResponse: (
    stream: ReadableStream,
    messageId: string,
    isContinuation?: boolean
  ) => Promise<void>
  handleNewChatCreation: (newChatId: string) => Promise<void>
  updateDiffStore: (yamlContent: string) => Promise<void>
}

/**
 * Combined copilot store interface
 */
export type CopilotStore = CopilotState & CopilotActions
