import { ToolResponse } from '../types'

export interface MemoryResponse extends ToolResponse {
  output: {
    memory?: any
    memories?: any[]
    id?: string
  }
}

export interface AgentMemoryData {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface RawMemoryData {
  [key: string]: any
}

export interface MemoryRecord {
  id: string
  key: string
  type: 'agent' | 'raw'
  data: AgentMemoryData | RawMemoryData
  createdAt: string
  updatedAt: string
  workflowId?: string
  workspaceId?: string
} 