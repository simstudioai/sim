import type { ToolResponse, WorkflowToolExecutionContext } from '@/tools/types'

export interface MemoryIdentifierParams {
  conversationId?: string
  id?: string
  _context?: WorkflowToolExecutionContext
}

export interface MemoryAddParams extends MemoryIdentifierParams {
  role: string
  content: string
}

export interface MemoryGetAllParams {
  _context?: WorkflowToolExecutionContext
}

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
