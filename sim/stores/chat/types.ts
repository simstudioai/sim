export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export interface ChatState {
  messages: ChatMessage[]
  isProcessing: boolean
  error: string | null
}

export interface ChatActions {
  sendMessage: (content: string) => Promise<void>
  clearChat: () => void
  setError: (error: string | null) => void
}

export type ChatStore = ChatState & ChatActions
