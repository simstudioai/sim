import type { ToolResponse } from '../types'

export interface PerplexityMessage {
  role: string
  content: string
}

export interface PerplexityChatParams {
  apiKey: string
  model: string
  messages?: PerplexityMessage[]
  max_tokens?: number
  temperature?: number

  prompt?: string
  system?: string
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
