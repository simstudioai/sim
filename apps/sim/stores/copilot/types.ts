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
 * Tool states that a tool can be in
 */
export type ToolState =
  | 'pending' // Waiting for user confirmation (shows Run/Skip buttons)
  | 'executing' // Currently executing
  | 'completed' // Successfully completed (legacy)
  | 'success' // Successfully completed
  | 'accepted' // User accepted but not yet executed
  | 'applied' // Applied/executed successfully
  | 'rejected' // User rejected/skipped
  | 'errored' // Failed with error
  | 'background' // Moved to background execution
  | 'ready_for_review' // Ready for review (workflow tools)
  | 'aborted' // Operation aborted (e.g., due to page refresh during diff view)

/**
 * Tool call interface for copilot
 * Consolidated type that handles both client and server tools
 */
export interface CopilotToolCall {
  id: string
  name: string
  displayName?: string
  input?: Record<string, any>
  parameters?: Record<string, any> // Alias for input
  state: ToolState
  startTime?: number
  endTime?: number
  duration?: number
  result?: any
  error?: string | { message: string }
  timestamp?: string
  hidden?: boolean // Hide tool from UI rendering (e.g., checkoff_todo)
}

/**
 * Content block types for preserving chronological order
 */
export interface TextContentBlock {
  type: 'text'
  content: string
  timestamp: number
}

export interface ThinkingContentBlock {
  type: 'thinking'
  content: string
  timestamp: number
  duration?: number // Duration in milliseconds for display
  startTime?: number // Start time for calculating duration
}

export interface ToolCallContentBlock {
  type: 'tool_call'
  toolCall: CopilotToolCall
  timestamp: number
}

export type ContentBlock = TextContentBlock | ThinkingContentBlock | ToolCallContentBlock

/**
 * File attachment interface for copilot messages
 */
export interface MessageFileAttachment {
  id: string
  s3_key: string
  filename: string
  media_type: string
  size: number
}

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
  fileAttachments?: MessageFileAttachment[] // File attachments
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
 * Workflow checkpoint structure for storing workflow state snapshots
 */
export interface WorkflowCheckpoint {
  id: string
  userId: string
  workflowId: string
  chatId: string
  messageId?: string // ID of the user message that triggered this checkpoint
  workflowState: any // JSON workflow state object
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
  fileAttachments?: MessageFileAttachment[]
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
  // Depth for agent mode (0-3)
  agentDepth: 0 | 1 | 2 | 3

  // Chat management
  currentChat: CopilotChat | null
  chats: CopilotChat[]
  messages: CopilotMessage[]
  workflowId: string | null

  // Checkpoint management
  checkpoints: CopilotCheckpoint[]
  messageCheckpoints: Record<string, WorkflowCheckpoint[]> // messageId -> checkpoints

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

  // Cache management
  chatsLastLoadedAt: Date | null // When chats were last loaded
  chatsLoadedForWorkflow: string | null // Which workflow the chats were loaded for

  // Revert state management
  revertState: { messageId: string; messageContent: string } | null // Track which message we reverted from
  inputValue: string // Control the input field

  // Todo list state (from plan tool)
  planTodos: Array<{ id: string; content: string; completed?: boolean; executing?: boolean }>
  showPlanTodos: boolean
}

/**
 * Copilot store actions
 */
export interface CopilotActions {
  // Mode management
  setMode: (mode: CopilotMode) => void
  setAgentDepth: (depth: 0 | 1 | 2 | 3) => void

  // Chat management
  setWorkflowId: (workflowId: string | null) => Promise<void>
  validateCurrentChat: () => boolean
  loadChats: (forceRefresh?: boolean) => Promise<void>
  areChatsFresh: (workflowId: string) => boolean // Check if chats are fresh for a workflow
  selectChat: (chat: CopilotChat) => Promise<void>
  createNewChat: (options?: CreateChatOptions) => Promise<void>
  deleteChat: (chatId: string) => Promise<void>

  // Message handling
  sendMessage: (message: string, options?: SendMessageOptions) => Promise<void>
  abortMessage: () => void
  sendImplicitFeedback: (
    implicitFeedback: string,
    toolCallState?: 'accepted' | 'rejected' | 'errored'
  ) => Promise<void>
  updatePreviewToolCallState: (
    toolCallState: 'accepted' | 'rejected' | 'errored',
    toolCallId?: string
  ) => void
  setToolCallState: (toolCall: any, newState: string, options?: any) => void
  sendDocsMessage: (query: string, options?: SendDocsMessageOptions) => Promise<void>
  saveChatMessages: (chatId: string) => Promise<void>

  // Checkpoint management
  loadCheckpoints: (chatId: string) => Promise<void>
  loadMessageCheckpoints: (chatId: string) => Promise<void>
  revertToCheckpoint: (checkpointId: string) => Promise<void>
  getCheckpointsForMessage: (messageId: string) => WorkflowCheckpoint[]

  // Preview management
  setPreviewYaml: (yamlContent: string) => Promise<void>
  clearPreviewYaml: () => Promise<void>

  // Utility actions
  clearMessages: () => void
  clearError: () => void
  clearSaveError: () => void
  clearCheckpointError: () => void
  retrySave: (chatId: string) => Promise<void>
  cleanup: () => void
  reset: () => void

  // Input control actions
  setInputValue: (value: string) => void
  clearRevertState: () => void

  // Todo list actions
  setPlanTodos: (
    todos: Array<{ id: string; content: string; completed?: boolean; executing?: boolean }>
  ) => void
  updatePlanTodoStatus: (id: string, status: 'executing' | 'completed') => void
  closePlanTodos: () => void

  // Internal helpers (not exposed publicly)
  handleStreamingResponse: (
    stream: ReadableStream,
    messageId: string,
    isContinuation?: boolean
  ) => Promise<void>
  handleNewChatCreation: (newChatId: string) => Promise<void>
  updateDiffStore: (yamlContent: string, toolName?: string) => Promise<void>
  updateDiffStoreWithWorkflowState: (workflowState: any, toolName?: string) => Promise<void>
}

/**
 * Combined copilot store interface
 */
export type CopilotStore = CopilotState & CopilotActions
