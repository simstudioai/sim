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
