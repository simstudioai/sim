import type { ToolResponse } from '@/tools/types'

export interface MemoryResponse extends ToolResponse {
  output: {
    memories?: any[]
    message?: string
  }
}

interface AgentMemoryData {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface MemoryRecord {
  id: string
  key: string
  conversationId: string
  data: AgentMemoryData[]
  createdAt: string
  updatedAt: string
  workflowId?: string
  workspaceId?: string
}

interface MemoryError {
  code: string
  message: string
  details?: Record<string, any>
}
