import { knowledgeBase } from '@sim/db/schema'
import type { ChunkingConfig, KnowledgeBaseWithCounts } from '@/lib/knowledge/types'

/**
 * Canonical identity and configuration for application authorization and retrieval: what a
 * search or a document read needs to know about a base, and nothing it counts.
 */
export type ActiveKnowledgeBaseReference = Omit<
  KnowledgeBaseWithCounts,
  'tokenCount' | 'docCount' | 'connectorTypes' | 'hasPermissionScopedConnector'
>

/** The columns a reference carries, so every lookup that returns one reads the same shape. */
export const ACTIVE_KNOWLEDGE_BASE_REFERENCE_FIELDS = {
  id: knowledgeBase.id,
  userId: knowledgeBase.userId,
  name: knowledgeBase.name,
  isSearchIndex: knowledgeBase.isSearchIndex,
  description: knowledgeBase.description,
  embeddingModel: knowledgeBase.embeddingModel,
  embeddingDimension: knowledgeBase.embeddingDimension,
  chunkingConfig: knowledgeBase.chunkingConfig,
  createdAt: knowledgeBase.createdAt,
  updatedAt: knowledgeBase.updatedAt,
  deletedAt: knowledgeBase.deletedAt,
  workspaceId: knowledgeBase.workspaceId,
  organizationId: knowledgeBase.organizationId,
  folderId: knowledgeBase.folderId,
}

type ActiveKnowledgeBaseRow = Omit<ActiveKnowledgeBaseReference, 'chunkingConfig'> & {
  chunkingConfig: unknown
}

/** The stored row as a reference; the chunking configuration is JSON the schema does not type. */
export function toActiveKnowledgeBaseReference(
  row: ActiveKnowledgeBaseRow
): ActiveKnowledgeBaseReference {
  return { ...row, chunkingConfig: row.chunkingConfig as ChunkingConfig }
}
