export interface KnowledgeSearchResult {
  id: string
  content: string
  documentId: string
  chunkIndex: number
  metadata: Record<string, any>
  similarity: number
}

export interface KnowledgeSearchResponse {
  success: boolean
  output: {
    results: KnowledgeSearchResult[]
    query: string
    knowledgeBaseId: string
    topK: number
    totalResults: number
    message: string
  }
  error?: string
}

export interface KnowledgeSearchParams {
  knowledgeBaseId: string
  query: string
  topK?: number
}
