import type { ToolResponse } from '@/tools/types'

export interface VoyageAIEmbeddingsParams {
  apiKey: string
  input: string | string[]
  model?: string
  inputType?: 'query' | 'document'
  truncation?: boolean
}

export interface VoyageAIRerankParams {
  apiKey: string
  query: string
  documents: string | string[]
  model?: string
  topK?: number
  truncation?: boolean
}

export interface VoyageAIEmbeddingsResponse extends ToolResponse {
  output: {
    embeddings: number[][]
    model: string
    usage: {
      total_tokens: number
    }
  }
}

export interface VoyageAIRerankResponse extends ToolResponse {
  output: {
    results: Array<{
      index: number
      relevance_score: number
      document: string
    }>
    model: string
    usage: {
      total_tokens: number
    }
  }
}
