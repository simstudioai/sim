export interface KnowledgeSearchResult {
  documentId: string
  documentName: string
  content: string
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
  chunkId: string
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
    documentName: string
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
  documentId: string
  documentName: string
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
  }
  error?: string
}

export interface KnowledgeTagDefinition {
  id: string
  tagSlot: string
  displayName: string
  fieldType: string
  createdAt: string | null
  updatedAt: string | null
}

export interface KnowledgeListTagsParams {
  knowledgeBaseId: string
}

export interface KnowledgeListTagsResponse {
  success: boolean
  output: {
    knowledgeBaseId: string
    tags: KnowledgeTagDefinition[]
    totalTags: number
  }
  error?: string
}

export interface KnowledgeDocumentSummary {
  id: string
  filename: string
  fileSize: number
  mimeType: string | null
  enabled: boolean
  processingStatus: string | null
  chunkCount: number
  tokenCount: number
  uploadedAt: string | null
  updatedAt: string | null
}

export interface KnowledgeListDocumentsResponse {
  success: boolean
  output: {
    knowledgeBaseId: string
    documents: KnowledgeDocumentSummary[]
    totalDocuments: number
    limit: number
    offset: number
  }
  error?: string
}

export interface KnowledgeDeleteDocumentResponse {
  success: boolean
  output: {
    documentId: string
    message: string
  }
  error?: string
}

export interface KnowledgeChunkSummary {
  id: string
  chunkIndex: number
  content: string
  contentLength: number
  tokenCount: number
  enabled: boolean
  createdAt: string | null
  updatedAt: string | null
}

export interface KnowledgeListChunksResponse {
  success: boolean
  output: {
    knowledgeBaseId: string
    documentId: string
    chunks: KnowledgeChunkSummary[]
    totalChunks: number
    limit: number
    offset: number
  }
  error?: string
}

export interface KnowledgeUpdateChunkResponse {
  success: boolean
  output: {
    documentId: string
    id: string
    chunkIndex: number
    content: string
    contentLength: number
    tokenCount: number
    enabled: boolean
    updatedAt: string | null
  }
  error?: string
}

export interface KnowledgeDeleteChunkResponse {
  success: boolean
  output: {
    chunkId: string
    documentId: string
    message: string
  }
  error?: string
}
