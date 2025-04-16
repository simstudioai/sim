export interface ChatMessage {
  id: string
  content: any
  workflowId: string | null
  type: 'user' | 'workflow'
  timestamp: string
  blockId?: string
}

export interface ChatStore {
  messages: ChatMessage[]
  selectedWorkflowOutputs: Record<string, string>
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  clearChat: (workflowId: string | null) => void
  getWorkflowMessages: (workflowId: string) => ChatMessage[]
  setSelectedWorkflowOutput: (workflowId: string, outputId: string) => void
  getSelectedWorkflowOutput: (workflowId: string) => string | null
} 