export interface ChunkFilters {
  search?: string
  enabled?: 'true' | 'false' | 'all'
  limit?: number
  offset?: number
}

export interface ChunkData {
  id: string
  chunkIndex: number
  content: string
  contentLength: number
  tokenCount: number
  enabled: boolean
  startOffset: number
  endOffset: number
  tag1?: string | null
  tag2?: string | null
  tag3?: string | null
  tag4?: string | null
  tag5?: string | null
  tag6?: string | null
  tag7?: string | null
  createdAt: Date
  updatedAt: Date
}

export interface ChunkQueryResult {
  chunks: ChunkData[]
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}

export interface CreateChunkData {
  content: string
  enabled?: boolean
}

export interface BatchOperationResult {
  success: boolean
  processed: number
  errors: string[]
}
