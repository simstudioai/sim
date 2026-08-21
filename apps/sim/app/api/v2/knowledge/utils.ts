import type {
  V2KnowledgeBase,
  V2KnowledgeDocumentSummary,
  V2KnowledgeTaggedDocument,
} from '@/lib/api/contracts/v2/knowledge'
import { ALL_TAG_SLOTS, type AllTagSlot } from '@/lib/knowledge/constants'
import {
  DOCUMENT_PROCESSING_STATUSES,
  type DocumentProcessingStatus,
} from '@/lib/knowledge/documents/types'
import type { DocumentTagDefinition } from '@/lib/knowledge/tags/types'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import { getUserEmailsByIds, requireResolvedUserEmail } from '@/lib/users/queries'
import { serializeDate } from '@/app/api/v1/knowledge/utils'

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

type V2DocumentProcessingStatus = DocumentProcessingStatus

/**
 * Narrows a stored processing status onto the published enum. An absent value
 * reads as `pending`, matching the column default; an unrecognised one is a
 * producer bug rather than a caller-reachable failure, so it throws.
 */
function toProcessingStatus(status: string | null | undefined): V2DocumentProcessingStatus {
  if (status === null || status === undefined) return 'pending'
  const known = DOCUMENT_PROCESSING_STATUSES.find((candidate) => candidate === status)
  if (!known) throw new Error(`Unexpected knowledge document processing status: ${status}`)
  return known
}

/**
 * The document columns every v2 document projection reads. `uploadedAt` is
 * accepted as nullable because the column is nullable in storage.
 */
interface V2DocumentSummarySource {
  id: string
  knowledgeBaseId: string
  filename: string
  fileSize: number
  mimeType: string
  processingStatus?: string | null
  chunkCount: number
  tokenCount: number
  characterCount: number
  enabled: boolean
  uploadedAt: Date | string | null | undefined
}

/**
 * The single v2 document summary projection. Every v2 document response — list
 * item, upload acknowledgement, detail — is this shape plus its own extras, so
 * the shared field set is serialized in exactly one place.
 */
export function toV2DocumentSummary(document: V2DocumentSummarySource): V2KnowledgeDocumentSummary {
  return {
    id: document.id,
    knowledgeBaseId: document.knowledgeBaseId,
    filename: document.filename,
    fileSize: document.fileSize,
    mimeType: document.mimeType,
    processingStatus: toProcessingStatus(document.processingStatus),
    chunkCount: document.chunkCount,
    tokenCount: document.tokenCount,
    characterCount: document.characterCount,
    enabled: document.enabled,
    createdAt: serializeDate(document.uploadedAt),
  }
}

interface V2TaggedDocumentSource
  extends V2DocumentSummarySource,
    Partial<Record<AllTagSlot, unknown>> {}

/** Serializes a document summary with its tag values keyed by display name. */
export function toV2TaggedDocument(
  document: V2TaggedDocumentSource,
  tagDefinitions: readonly DocumentTagDefinition[]
): V2KnowledgeTaggedDocument {
  return {
    ...toV2DocumentSummary(document),
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
