import type { ToolResponse } from '@/tools/types'

export interface ImageGenerationParams {
  provider: 'openai' | 'gemini' | 'falai'
  apiKey: string
  model?: string
  prompt: string
  size?: string
  aspectRatio?: string
  resolution?: string
  quality?: string
  background?: string
  outputFormat?: string
  moderation?: string
  safetyTolerance?: string
  numImages?: number
  seed?: number
  enableSafetyChecker?: boolean
  enableWebSearch?: boolean
  thinkingLevel?: string
}

export interface ImageGenerationResponse extends ToolResponse {
  output: {
    content: string
    image: unknown
    imageUrl: string
    provider: string
    model: string
    metadata: {
      provider: string
      model: string
      description?: string
      revisedPrompt?: string
      seed?: number
      jobId?: string
      contentType?: string
    }
  }
}
