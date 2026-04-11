import type { ChunkingStrategy, StrategyOptions } from '@/lib/chunkers/types'

/**
 * Units:
 * - maxSize/overlap: TOKENS (1 token ≈ 4 characters)
 * - minSize: CHARACTERS
 */
export interface ChunkingConfig {
  maxSize: number
  minSize: number
  overlap: number
  strategy?: ChunkingStrategy
  strategyOptions?: StrategyOptions
}

export interface KnowledgeBaseWithCounts {
  id: string
  userId: string
  name: string
  description: string | null
  tokenCount: number
  embeddingModel: string
  embeddingDimension: number
  chunkingConfig: ChunkingConfig
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  workspaceId: string | null
  docCount: number
  connectorTypes: string[]
}

export interface CreateKnowledgeBaseData {
  name: string
  description?: string
  workspaceId: string
  embeddingModel: 'text-embedding-3-small'
  embeddingDimension: 1536
  chunkingConfig: ChunkingConfig
  userId: string
}

export interface TagDefinition {
  id: string
  tagSlot: string
  displayName: string
  fieldType: string
  createdAt: Date
  updatedAt: Date
}

export interface CreateTagDefinitionData {
  knowledgeBaseId: string
  tagSlot: string
  displayName: string
  fieldType: string
}

export interface UpdateTagDefinitionData {
  displayName?: string
  fieldType?: string
}

export interface StructuredFilter {
  tagName?: string
  tagSlot: string
  fieldType: string
  operator: string
  value: string | number | boolean
  valueTo?: string | number
}

export interface ProcessedDocumentTags {
  tag1: string | null
  tag2: string | null
  tag3: string | null
  tag4: string | null
  tag5: string | null
  tag6: string | null
  tag7: string | null
  number1: number | null
  number2: number | null
  number3: number | null
  number4: number | null
  number5: number | null
  date1: Date | null
  date2: Date | null
  boolean1: boolean | null
  boolean2: boolean | null
  boolean3: boolean | null
  [key: string]: string | number | Date | boolean | null
}

/** These types use string dates for JSON serialization */

export interface ExtendedChunkingConfig extends ChunkingConfig {
  chunkSize?: number
  minCharactersPerChunk?: number
  recipe?: string
  lang?: string
  [key: string]: unknown
}

export interface KnowledgeBaseData {
  id: string
  userId: string
  name: string
  description?: string
  tokenCount: number
  embeddingModel: string
  embeddingDimension: number
  chunkingConfig: ExtendedChunkingConfig
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  workspaceId?: string
  connectorTypes?: string[]
}

export interface DocumentData {
  id: string
  knowledgeBaseId: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  chunkCount: number
  tokenCount: number
  characterCount: number
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  processingStartedAt?: string | null
  processingCompletedAt?: string | null
  processingError?: string | null
  enabled: boolean
  uploadedAt: string
  tag1?: string | null
  tag2?: string | null
  tag3?: string | null
  tag4?: string | null
  tag5?: string | null
  tag6?: string | null
  tag7?: string | null
  number1?: number | null
  number2?: number | null
  number3?: number | null
  number4?: number | null
  number5?: number | null
  date1?: string | null
  date2?: string | null
  boolean1?: boolean | null
  boolean2?: boolean | null
  boolean3?: boolean | null
  connectorId?: string | null
  connectorType?: string | null
  sourceUrl?: string | null
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
  number1?: number | null
  number2?: number | null
  number3?: number | null
  number4?: number | null
  number5?: number | null
  date1?: string | null
  date2?: string | null
  boolean1?: boolean | null
  boolean2?: boolean | null
  boolean3?: boolean | null
  createdAt: string
  updatedAt: string
}

export interface ChunksPagination {
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export interface DocumentsPagination {
  total: number
  limit: number
  offset: number
  hasMore: boolean
}
