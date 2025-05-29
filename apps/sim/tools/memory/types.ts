import type { ToolResponse } from '../types'

export interface MemoryResponse extends ToolResponse {
  output: {
    memories?: any[]
    message?: string
  }
}

export interface AgentMemoryData {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface MemoryRecord {
  id: string
  key: string
  type: 'agent'
  data: AgentMemoryData[]
  createdAt: string
  updatedAt: string
  workflowId?: string
  workspaceId?: string
}

export interface MemoryError {
  code: string
  message: string
  details?: Record<string, any>
}
