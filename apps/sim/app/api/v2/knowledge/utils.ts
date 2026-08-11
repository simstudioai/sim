import type { V2KnowledgeBase } from '@/lib/api/contracts/v2/knowledge'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import { getUserEmailsByIds, requireResolvedUserEmail } from '@/lib/users/queries'

interface KnowledgeBaseWithFolder {
  knowledgeBase: KnowledgeBaseWithCounts
  folderPath: string
}

function serializeV2KnowledgeBase(
  knowledgeBase: KnowledgeBaseWithCounts,
  folderPath: string,
  ownerEmail: string
): V2KnowledgeBase {
  return {
    id: knowledgeBase.id,
    name: knowledgeBase.name,
    description: knowledgeBase.description,
    ownerEmail,
    tokenCount: knowledgeBase.tokenCount,
    embeddingModel: knowledgeBase.embeddingModel,
    embeddingDimension: knowledgeBase.embeddingDimension,
    chunkingConfig: {
      maxSize: knowledgeBase.chunkingConfig.maxSize,
      minSize: knowledgeBase.chunkingConfig.minSize,
      overlap: knowledgeBase.chunkingConfig.overlap,
      strategy: knowledgeBase.chunkingConfig.strategy,
      strategyOptions: knowledgeBase.chunkingConfig.strategyOptions
        ? {
            pattern: knowledgeBase.chunkingConfig.strategyOptions.pattern,
            separators: knowledgeBase.chunkingConfig.strategyOptions.separators,
            recipe: knowledgeBase.chunkingConfig.strategyOptions.recipe,
            strictBoundaries: knowledgeBase.chunkingConfig.strategyOptions.strictBoundaries,
          }
        : undefined,
    },
    docCount: knowledgeBase.docCount,
    connectorTypes: knowledgeBase.connectorTypes,
    createdAt: knowledgeBase.createdAt.toISOString(),
    updatedAt: knowledgeBase.updatedAt.toISOString(),
    folderPath,
  }
}

/** Resolves and serializes one knowledge base with public owner attribution. */
export async function toV2KnowledgeBase(
  knowledgeBase: KnowledgeBaseWithCounts,
  folderPath: string
): Promise<V2KnowledgeBase> {
  const emailByUserId = await getUserEmailsByIds([knowledgeBase.userId])
  return serializeV2KnowledgeBase(
    knowledgeBase,
    folderPath,
    requireResolvedUserEmail(emailByUserId, knowledgeBase.userId)
  )
}

/** Batch-resolves owner emails before serializing a knowledge-base list. */
export async function toV2KnowledgeBases(
  entries: readonly KnowledgeBaseWithFolder[]
): Promise<V2KnowledgeBase[]> {
  const emailByUserId = await getUserEmailsByIds(
    entries.map(({ knowledgeBase }) => knowledgeBase.userId)
  )
  return entries.map(({ knowledgeBase, folderPath }) =>
    serializeV2KnowledgeBase(
      knowledgeBase,
      folderPath,
      requireResolvedUserEmail(emailByUserId, knowledgeBase.userId)
    )
  )
}
