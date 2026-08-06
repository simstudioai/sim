import type { EmbeddingProvider, EmbeddingTaskTypeName } from '@/lib/api/contracts/tools/embeddings'
import type { ToolResponse } from '@/tools/types'

export interface EmbeddingsParams {
  apiKey: string
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

export interface EmbeddingToolDefinition {
  id: string
  name: string
  provider: EmbeddingProvider
  /** Env var prefix for the hosted key pool. */
  envKeyPrefix: string
  /** Human-readable model list for the tool description. */
  description: string
}
