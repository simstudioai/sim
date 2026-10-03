import type { EmbeddingTaskTypeName } from '@/lib/internal/embeddings/schema'
import type { ToolResponse } from '@/tools/types'

export interface EmbeddingsParams {
  apiKey?: string
  input: string | string[]
  model?: string
  taskType?: EmbeddingTaskTypeName
  dimensions?: number
}

export interface EmbeddingsResponse extends ToolResponse {
  output: {
    embeddings: number[][]
    model: string
    provider: string
    dimensions: number
    usage: {
      prompt_tokens: number
      total_tokens: number
    }
    /** Token count used by the hosted-key pricing hook. Internal. */
    __embeddingTokens?: number
  }
}
