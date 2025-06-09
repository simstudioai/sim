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

export interface KnowledgeUploadChunkResult {
  id: string
  chunkIndex: number
  content: string
  contentLength: number
  tokenCount: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface KnowledgeUploadChunkResponse {
  success: boolean
  output: {
    data: KnowledgeUploadChunkResult
    message: string
    documentId: string
  }
  error?: string
}

export interface KnowledgeUploadChunkParams {
  documentId: string
  content: string
  enabled?: boolean
  searchRank?: number
  qualityScore?: number
}
