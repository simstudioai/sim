import type { ToolResponse } from '@/tools/types'

export interface HuggingFaceUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface HuggingFaceMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface HuggingFaceRequestBody {
  model: string
  messages: HuggingFaceMessage[]
  stream: boolean
  temperature?: number
  max_tokens?: number
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
    usage: HuggingFaceUsage
  }
}
