import type { ToolResponse } from '@/tools/types'

export interface OVHcloudMessage {
  role: string
  content: string
}

export interface OVHcloudChatParams {
  systemPrompt?: string
  content: string
  model: string
  max_tokens?: number
  temperature?: number
  apiKey: string
}

export interface OVHcloudChatResponse extends ToolResponse {
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

export interface OVHcloudEmbeddingsParams {
  input: string
  model: string
  apiKey: string
}

export interface OVHcloudEmbeddingsResponse extends ToolResponse {
  output: {
    embedding: number[]
    model: string
    usage: {
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
    }
  }
}
