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
    totalResults: number
    cost?: {
      input: number
      output: number
      total: number
      tokens: {
        prompt: number
        completion: number
        total: number
      }
      model: string
      pricing: {
        input: number
        output: number
        updatedAt: string
      }
    }
  }
  error?: string
}

export interface KnowledgeSearchParams {
  knowledgeBaseIds: string | string[]
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
    cost?: {
      input: number
      output: number
      total: number
      tokens: {
        prompt: number
        completion: number
        total: number
      }
      model: string
      pricing: {
        input: number
        output: number
        updatedAt: string
      }
    }
  }
  error?: string
}

export interface KnowledgeUploadChunkParams {
  documentId: string
  content: string
  enabled?: boolean
}

export interface KnowledgeCreateDocumentResult {
  id: string
  name: string
  type: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface KnowledgeCreateDocumentResponse {
  success: boolean
  output: {
    data: KnowledgeCreateDocumentResult
    message: string
    documentId: string
  }
  error?: string
}
