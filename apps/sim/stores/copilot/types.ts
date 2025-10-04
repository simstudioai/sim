import type { ClientToolCallState, ClientToolDisplay } from '@/lib/copilot/tools/client/base-tool'

export type ToolState = ClientToolCallState

export interface CopilotToolCall {
  id: string
  name: string
  state: ClientToolCallState
  params?: Record<string, any>
  display?: ClientToolDisplay
}

export interface MessageFileAttachment {
  id: string
  key: string
  filename: string
  media_type: string
  size: number
}

export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  citations?: { id: number; title: string; url: string; similarity?: number }[]
  toolCalls?: CopilotToolCall[]
  contentBlocks?: Array<
    | { type: 'text'; content: string; timestamp: number }
    | {
        type: 'thinking'
        content: string
        timestamp: number
        duration?: number
        startTime?: number
      }
    | { type: 'tool_call'; toolCall: CopilotToolCall; timestamp: number }
    | { type: 'contexts'; contexts: ChatContext[]; timestamp: number }
  >
  fileAttachments?: MessageFileAttachment[]
  contexts?: ChatContext[]
}

// Contexts attached to a user message
export type ChatContext =
  | { kind: 'past_chat'; chatId: string; label: string }
  | { kind: 'workflow'; workflowId: string; label: string }
  | { kind: 'current_workflow'; workflowId: string; label: string }
  | { kind: 'blocks'; blockIds: string[]; label: string }
  | { kind: 'logs'; executionId?: string; label: string }
  | { kind: 'workflow_block'; workflowId: string; blockId: string; label: string }
  | { kind: 'knowledge'; knowledgeId?: string; label: string }
  | { kind: 'templates'; templateId?: string; label: string }
  | { kind: 'docs'; label: string }

export interface CopilotChat {
  id: string
  title: string | null
  model: string
  messages: CopilotMessage[]
  messageCount: number
  previewYaml: string | null
  createdAt: Date
  updatedAt: Date
}

export type CopilotMode = 'ask' | 'agent'

export interface CopilotState {
  mode: CopilotMode
  selectedModel:
    | 'gpt-5-fast'
    | 'gpt-5'
    | 'gpt-5-medium'
    | 'gpt-5-high'
    | 'gpt-4o'
    | 'gpt-4.1'
    | 'o3'
    | 'claude-4-sonnet'
    | 'claude-4.5-sonnet'
    | 'claude-4.1-opus'
  agentPrefetch: boolean
  enabledModels: string[] | null // Null means not loaded yet, array of model IDs when loaded
  isCollapsed: boolean

  currentChat: CopilotChat | null
  chats: CopilotChat[]
  messages: CopilotMessage[]
  workflowId: string | null

  checkpoints: any[]
  messageCheckpoints: Record<string, any[]>

  isLoading: boolean
  isLoadingChats: boolean
  isLoadingCheckpoints: boolean
  isSendingMessage: boolean
  isSaving: boolean
  isRevertingCheckpoint: boolean
  isAborting: boolean

  error: string | null
  saveError: string | null
  checkpointError: string | null

  abortController: AbortController | null

  chatsLastLoadedAt: Date | null
  chatsLoadedForWorkflow: string | null

  revertState: { messageId: string; messageContent: string } | null
  inputValue: string

  planTodos: Array<{ id: string; content: string; completed?: boolean; executing?: boolean }>
  showPlanTodos: boolean

  // Map of toolCallId -> CopilotToolCall for quick access during streaming
  toolCallsById: Record<string, CopilotToolCall>

  // Transient flag to prevent auto-selecting a chat during new-chat UX
  suppressAutoSelect?: boolean

  // Explicitly track the current user message id for this in-flight query (for stats/diff correlation)
  currentUserMessageId?: string | null

  // Per-message metadata captured at send-time for reliable stats
}

export interface CopilotActions {
  setMode: (mode: CopilotMode) => void
  setSelectedModel: (model: CopilotStore['selectedModel']) => void
  setAgentPrefetch: (prefetch: boolean) => void
  setEnabledModels: (models: string[] | null) => void

  setWorkflowId: (workflowId: string | null) => Promise<void>
  validateCurrentChat: () => boolean
  loadChats: (forceRefresh?: boolean) => Promise<void>
  areChatsFresh: (workflowId: string) => boolean
  selectChat: (chat: CopilotChat) => Promise<void>
  createNewChat: () => Promise<void>
  deleteChat: (chatId: string) => Promise<void>

  sendMessage: (
    message: string,
    options?: {
      stream?: boolean
      fileAttachments?: MessageFileAttachment[]
      contexts?: ChatContext[]
    }
  ) => Promise<void>
  abortMessage: () => void
  sendImplicitFeedback: (
    implicitFeedback: string,
    toolCallState?: 'accepted' | 'rejected' | 'error'
  ) => Promise<void>
  updatePreviewToolCallState: (
    toolCallState: 'accepted' | 'rejected' | 'error',
    toolCallId?: string
  ) => void
  setToolCallState: (toolCall: any, newState: ClientToolCallState, options?: any) => void
  sendDocsMessage: (query: string, options?: { stream?: boolean; topK?: number }) => Promise<void>
  saveChatMessages: (chatId: string) => Promise<void>

  loadCheckpoints: (chatId: string) => Promise<void>
  loadMessageCheckpoints: (chatId: string) => Promise<void>
  revertToCheckpoint: (checkpointId: string) => Promise<void>
  getCheckpointsForMessage: (messageId: string) => any[]

  setPreviewYaml: (yamlContent: string) => Promise<void>
  clearPreviewYaml: () => Promise<void>

  clearMessages: () => void
  clearError: () => void
  clearSaveError: () => void
  clearCheckpointError: () => void
  retrySave: (chatId: string) => Promise<void>
  cleanup: () => void
  reset: () => void

  setInputValue: (value: string) => void
  clearRevertState: () => void

  setPlanTodos: (
    todos: Array<{ id: string; content: string; completed?: boolean; executing?: boolean }>
  ) => void
  updatePlanTodoStatus: (id: string, status: 'executing' | 'completed') => void
  closePlanTodos: () => void

  handleStreamingResponse: (
    stream: ReadableStream,
    messageId: string,
    isContinuation?: boolean,
    triggerUserMessageId?: string
  ) => Promise<void>
  handleNewChatCreation: (newChatId: string) => Promise<void>
  updateDiffStore: (yamlContent: string, toolName?: string) => Promise<void>
  updateDiffStoreWithWorkflowState: (workflowState: any, toolName?: string) => Promise<void>
}

export type CopilotStore = CopilotState & CopilotActions
