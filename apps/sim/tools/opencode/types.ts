import type { ToolResponse, WorkflowToolExecutionContext } from '@/tools/types'

export interface OpenCodePromptParams {
  repository: string
  prompt: string
  providerId: string
  modelId: string
  systemPrompt?: string
  agent?: string
  newThread?: boolean | string
  _context?: WorkflowToolExecutionContext
}

export interface OpenCodeRepositoryItem {
  id: string
  label: string
  directory: string
  projectId: string
}

export interface OpenCodeListReposResponse extends ToolResponse {
  output: {
    repositories: OpenCodeRepositoryItem[]
    count: number
  }
}

export interface OpenCodePromptResponse extends ToolResponse {
  output: {
    content: string
    threadId: string
    cost?: number
    error?: string
  }
}

export interface OpenCodeGetMessagesParams {
  repository: string
  threadId: string
}

export interface OpenCodeMessage {
  messageId: string
  role: 'user' | 'assistant'
  content: string
  cost?: number
  providerId?: string
  modelId?: string
  createdAt: number
}

export interface OpenCodeGetMessagesResponse extends ToolResponse {
  output: {
    threadId: string
    messages: OpenCodeMessage[]
    count: number
  }
}
