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
  >
  fileAttachments?: MessageFileAttachment[]
}

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
  agentDepth: 0 | 1 | 2 | 3
  agentPrefetch: boolean

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
}

export interface CopilotActions {
  setMode: (mode: CopilotMode) => void
  setAgentDepth: (depth: 0 | 1 | 2 | 3) => void
  setAgentPrefetch: (prefetch: boolean) => void

  setWorkflowId: (workflowId: string | null) => Promise<void>
  validateCurrentChat: () => boolean
  loadChats: (forceRefresh?: boolean) => Promise<void>
  areChatsFresh: (workflowId: string) => boolean
  selectChat: (chat: CopilotChat) => Promise<void>
  createNewChat: () => Promise<void>
  deleteChat: (chatId: string) => Promise<void>

  sendMessage: (
    message: string,
    options?: { stream?: boolean; fileAttachments?: MessageFileAttachment[] }
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
    isContinuation?: boolean
  ) => Promise<void>
  handleNewChatCreation: (newChatId: string) => Promise<void>
  updateDiffStore: (yamlContent: string, toolName?: string) => Promise<void>
  updateDiffStoreWithWorkflowState: (workflowState: any, toolName?: string) => Promise<void>
}

export type CopilotStore = CopilotState & CopilotActions
