import type { CursorKey } from '@/lib/api/list-query'
import type { WorkspaceSearchFilters } from '@/lib/knowledge/search/filters'

export const CHUNK_SORT_FIELDS = ['chunkIndex', 'tokenCount', 'enabled'] as const

export type ChunkSortBy = (typeof CHUNK_SORT_FIELDS)[number]

export interface ChunkFilters {
  /** Search reads must also respect the document's enabled state. */
  requireEnabledDocument?: boolean
  documentFilters?: WorkspaceSearchFilters
  search?: string
  enabled?: 'true' | 'false' | 'all'
  limit?: number
  offset?: number
  sortBy?: ChunkSortBy
  sortOrder?: 'asc' | 'desc'
  /** Keyset position from a previous page. Never combined with `offset`. */
  cursorKeys?: CursorKey[]
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
  /** Keys resuming the next page, or `null` on the last one. */
  nextCursorKeys: CursorKey[] | null
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
