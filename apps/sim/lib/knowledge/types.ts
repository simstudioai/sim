/**
 * Configuration for document chunking in knowledge bases
 *
 * Units:
 * - maxSize: Maximum chunk size in TOKENS (1 token ≈ 4 characters)
 * - minSize: Minimum chunk size in CHARACTERS (floor to avoid tiny fragments)
 * - overlap: Overlap between chunks in TOKENS (1 token ≈ 4 characters)
 */
export interface ChunkingConfig {
  /** Maximum chunk size in tokens (default: 1024, range: 100-4000) */
  maxSize: number
  /** Minimum chunk size in characters (default: 100, range: 1-2000) */
  minSize: number
  /** Overlap between chunks in tokens (default: 200, range: 0-500) */
  overlap: number
}

export interface KnowledgeBaseWithCounts {
  id: string
  name: string
  description: string | null
  tokenCount: number
  embeddingModel: string
  embeddingDimension: number
  chunkingConfig: ChunkingConfig
  createdAt: Date
  updatedAt: Date
  workspaceId: string | null
  docCount: number
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

/** Tag filter for knowledge base search */
export interface StructuredFilter {
  tagName?: string // Human-readable name (input from frontend)
  tagSlot: string // Database column (resolved from tagName)
  fieldType: string
  operator: string
  value: string | number | boolean
  valueTo?: string | number
}

/** Processed document tags ready for database storage */
export interface ProcessedDocumentTags {
  // Text tags
  tag1: string | null
  tag2: string | null
  tag3: string | null
  tag4: string | null
  tag5: string | null
  tag6: string | null
  tag7: string | null
  // Number tags
  number1: number | null
  number2: number | null
  number3: number | null
  number4: number | null
  number5: number | null
  // Date tags
  date1: Date | null
  date2: Date | null
  // Boolean tags
  boolean1: boolean | null
  boolean2: boolean | null
  boolean3: boolean | null
  // Index signature for dynamic access
  [key: string]: string | number | Date | boolean | null
}

/**
 * Frontend/API Types
 * These types use string dates for JSON serialization
 */

/** Extended chunking config with optional fields */
export interface ExtendedChunkingConfig extends ChunkingConfig {
  chunkSize?: number
  minCharactersPerChunk?: number
  recipe?: string
  lang?: string
  strategy?: 'recursive' | 'semantic' | 'sentence' | 'paragraph'
  [key: string]: unknown
}

/** Knowledge base data for API responses */
export interface KnowledgeBaseData {
  id: string
  name: string
  description?: string
  tokenCount: number
  embeddingModel: string
  embeddingDimension: number
  chunkingConfig: ExtendedChunkingConfig
  createdAt: string
  updatedAt: string
  workspaceId?: string
}

/** Document data for API responses */
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
}

/** Chunk data for API responses */
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

/** Pagination info for chunks */
export interface ChunksPagination {
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

/** Pagination info for documents */
export interface DocumentsPagination {
  total: number
  limit: number
  offset: number
  hasMore: boolean
}
