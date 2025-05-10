export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export interface CopilotState {
  messages: CopilotMessage[]
  isProcessing: boolean
  error: string | null
}

export interface CopilotActions {
  sendMessage: (content: string) => Promise<void>
  clearCopilot: () => void
  setError: (error: string | null) => void
}

export type CopilotStore = CopilotState & CopilotActions
