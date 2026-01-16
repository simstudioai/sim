/**
 * Position interface for floating chat
 */
export interface ChatPosition {
  x: number
  y: number
}

/**
 * Chat attachment interface
 */
export interface ChatAttachment {
  id: string
  name: string
  type: string
  dataUrl: string
  size?: number
}

/**
 * Chat message interface
 */
export interface ChatMessage {
  id: string
  content: string | any
  workflowId: string
  type: 'user' | 'workflow'
  timestamp: string
  blockId?: string
  isStreaming?: boolean
  attachments?: ChatAttachment[]
}

/**
 * Output configuration for chat deployments
 */
export interface OutputConfig {
  blockId: string
  path: string
}

/**
 * Chat dimensions interface
 */
export interface ChatDimensions {
  width: number
  height: number
}

/**
 * Chat store state interface combining UI state and message data
 */
export interface ChatState {
  // UI State
  isChatOpen: boolean
  chatPosition: ChatPosition | null
  chatWidth: number
  chatHeight: number
  setIsChatOpen: (open: boolean) => void
  setChatPosition: (position: ChatPosition) => void
  setChatDimensions: (dimensions: ChatDimensions) => void
  resetChatPosition: () => void

  // Message State
  messages: ChatMessage[]
  selectedWorkflowOutputs: Record<string, string[]>
  conversationIds: Record<string, string>

  // Message Actions
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'> & { id?: string }) => void
  clearChat: (workflowId: string | null) => void
  exportChatCSV: (workflowId: string) => void
  setSelectedWorkflowOutput: (workflowId: string, outputIds: string[]) => void
  getSelectedWorkflowOutput: (workflowId: string) => string[]
  appendMessageContent: (messageId: string, content: string) => void
  finalizeMessageStream: (messageId: string) => void
  getConversationId: (workflowId: string) => string
  generateNewConversationId: (workflowId: string) => string
}
