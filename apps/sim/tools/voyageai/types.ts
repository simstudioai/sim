import type { ToolResponse } from '@/tools/types'

type VoyageAIInputType = 'query' | 'document'

export interface VoyageAIContextualizedEmbeddingsParams {
  apiKey: string
  /** The full text of each document, or each search query, or the same as a JSON string. */
  input: string[] | string[][] | string
  model?: string
  inputType: VoyageAIInputType
  dimensions?: number | string
}

export interface VoyageAIContextualizedEmbeddingsResponse extends ToolResponse {
  output: {
    embeddings: number[][][]
    chunks?: string[][]
    model: string
    dimensions: number
    totalTokens?: number
  }
}

export interface VoyageAIRerankParams {
  apiKey: string
  query: string
  /** Texts to rank, or the same value as a JSON string. */
  documents: string[] | string
  model?: string
  topK?: number | string
}

export interface VoyageAIRerankResponse extends ToolResponse {
  output: {
    results: Array<{ index: number; relevanceScore: number; document: string }>
    model: string
    totalTokens?: number
  }
}
