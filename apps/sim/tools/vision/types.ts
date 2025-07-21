import type { ToolResponse } from '@/tools/types'

export interface VisionParams {
  apiKey: string
  imageUrl: string
  model?: string
  prompt?: string
}

export interface VisionResponse extends ToolResponse {
  output: {
    content: string
    model?: string
    tokens?: number
  }
}
