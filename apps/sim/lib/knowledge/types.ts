export interface ChunkingConfig {
  maxSize: number
  minSize: number
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
  workspaceId?: string
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
