import type { V2KnowledgeBase, V2KnowledgeTaggedDocument } from '@/lib/api/contracts/v2/knowledge'
import { ALL_TAG_SLOTS, type AllTagSlot } from '@/lib/knowledge/constants'
import type { DocumentTagDefinition } from '@/lib/knowledge/tags/types'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import { getUserEmailsByIds, requireResolvedUserEmail } from '@/lib/users/queries'

/**
 * Projects a document's tag slots onto a map keyed by tag display name, the same
 * projection knowledge search applies to its result `metadata`. A slot holding a
 * value with no definition keeps its raw slot name rather than disappearing.
 */
export function toV2DocumentTags(
  document: Partial<Record<AllTagSlot, unknown>>,
  tagDefinitions: readonly DocumentTagDefinition[]
): Record<string, string | number | boolean | null> {
  const displayNameBySlot = new Map(
    tagDefinitions.map((definition) => [definition.tagSlot, definition.displayName])
  )
  const tags: Record<string, string | number | boolean | null> = {}
  for (const slot of ALL_TAG_SLOTS) {
    const value = document[slot]
    if (value === null || value === undefined) continue
    const key = displayNameBySlot.get(slot) ?? slot
    if (value instanceof Date) {
      tags[key] = value.toISOString()
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      tags[key] = value
    }
  }
  return tags
}

interface V2TaggedDocumentSource extends Partial<Record<AllTagSlot, unknown>> {
  id: string
  knowledgeBaseId: string
  filename: string
  fileSize: number
  mimeType: string
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  chunkCount: number
  tokenCount: number
  characterCount: number
  enabled: boolean
  uploadedAt: Date
}

/** Serializes a document summary with its tag values keyed by display name. */
export function toV2TaggedDocument(
  document: V2TaggedDocumentSource,
  tagDefinitions: readonly DocumentTagDefinition[]
): V2KnowledgeTaggedDocument {
  return {
    id: document.id,
    knowledgeBaseId: document.knowledgeBaseId,
    filename: document.filename,
    fileSize: document.fileSize,
    mimeType: document.mimeType,
    processingStatus: document.processingStatus,
    chunkCount: document.chunkCount,
    tokenCount: document.tokenCount,
    characterCount: document.characterCount,
    enabled: document.enabled,
    createdAt: document.uploadedAt.toISOString(),
    tags: toV2DocumentTags(document, tagDefinitions),
  }
}

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
