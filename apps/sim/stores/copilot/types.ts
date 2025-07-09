/**
 * Message interface for copilot conversations
 */
export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  citations?: Array<{
    id: number
    title: string
    url: string
    similarity?: number
  }>
}

/**
 * Chat interface for copilot conversations
 */
export interface CopilotChat {
  id: string
  title: string | null
  model: string
  messages: CopilotMessage[]
  messageCount: number
  createdAt: Date
  updatedAt: Date
}

/**
 * Copilot store state
 */
export interface CopilotState {
  // Current active chat
  currentChat: CopilotChat | null

  // List of available chats for current workflow
  chats: CopilotChat[]

  // Current messages (from active chat)
  messages: CopilotMessage[]

  // Loading states
  isLoading: boolean
  isLoadingChats: boolean
  isSendingMessage: boolean

  // Error state
  error: string | null

  // Current workflow ID (for chat context)
  workflowId: string | null
}

/**
 * Copilot store actions
 */
export interface CopilotActions {
  // Chat management
  setWorkflowId: (workflowId: string | null) => void
  loadChats: () => Promise<void>
  selectChat: (chat: CopilotChat) => Promise<void>
  createNewChat: (options?: { title?: string; initialMessage?: string }) => Promise<void>
  deleteChat: (chatId: string) => Promise<void>

  // Message handling
  sendMessage: (message: string, options?: { stream?: boolean }) => Promise<void>
  sendDocsMessage: (query: string, options?: { stream?: boolean; topK?: number }) => Promise<void>
  saveChatMessages: (chatId: string) => Promise<void>

  // Utility actions
  clearMessages: () => void
  clearError: () => void
  reset: () => void

  // Internal helper (not exposed publicly)
  handleStreamingResponse: (stream: ReadableStream, messageId: string) => Promise<void>
}

/**
 * Combined copilot store interface
 */
export type CopilotStore = CopilotState & CopilotActions
