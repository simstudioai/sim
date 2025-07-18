import type { ToolResponse } from '../types'

export interface PerplexityMessage {
  role: string
  content: string
}

export interface PerplexityChatParams {
  systemPrompt?: string
  content: string
  model: string
  max_tokens?: number
  temperature?: number
  apiKey: string
}

export interface PerplexityChatResponse extends ToolResponse {
  output: {
    content: string
    model: string
    usage: {
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
    }
  }
}
