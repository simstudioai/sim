import type { ToolResponse } from '../types'

export interface HuggingFaceMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface HuggingFaceChatParams {
  apiKey: string
  provider: string
  model: string
  content: string
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
  stream?: boolean
}

export interface HuggingFaceChatResponse extends ToolResponse {
  output: {
    content: string
    model: string
    usage?: {
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
    }
  }
}
