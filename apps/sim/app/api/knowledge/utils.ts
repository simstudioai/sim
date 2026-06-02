import { db } from '@sim/db'
import { document, embedding, knowledgeBase } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

interface KnowledgeBaseData {
  id: string
  userId: string
  workspaceId?: string | null
  name: string
  description?: string | null
  tokenCount: number
  embeddingModel: string
  embeddingDimension: number
  chunkingConfig: unknown
  deletedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

interface DocumentData {
  id: string
  knowledgeBaseId: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  chunkCount: number
  tokenCount: number
  characterCount: number
  processingStatus: string
  processingStartedAt?: Date | null
  processingCompletedAt?: Date | null
  processingError?: string | null
  enabled: boolean
  deletedAt?: Date | null
  uploadedAt: Date
  // Text tags
  tag1?: string | null
  tag2?: string | null
  tag3?: string | null
  tag4?: string | null
  tag5?: string | null
  tag6?: string | null
  tag7?: string | null
  // Number tags (5 slots)
  number1?: number | null
  number2?: number | null
  number3?: number | null
  number4?: number | null
  number5?: number | null
  // Date tags (2 slots)
  date1?: Date | null
  date2?: Date | null
  // Boolean tags (3 slots)
  boolean1?: boolean | null
  boolean2?: boolean | null
  boolean3?: boolean | null
  // Connector fields
  connectorId?: string | null
  sourceUrl?: string | null
  externalId?: string | null
}

interface EmbeddingData {
  id: string
  knowledgeBaseId: string
  documentId: string
  chunkIndex: number
  chunkHash: string
  content: string
  contentLength: number
  tokenCount: number
  embedding?: number[] | null
  embeddingModel: string
  startOffset: number
  endOffset: number
  // Text tags
  tag1?: string | null
  tag2?: string | null
  tag3?: string | null
  tag4?: string | null
  tag5?: string | null
  tag6?: string | null
  tag7?: string | null
  // Number tags (5 slots)
  number1?: number | null
  number2?: number | null
  number3?: number | null
  number4?: number | null
  number5?: number | null
  // Date tags (2 slots)
  date1?: Date | null
  date2?: Date | null
  // Boolean tags (3 slots)
  boolean1?: boolean | null
  boolean2?: boolean | null
  boolean3?: boolean | null
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export interface KnowledgeBaseAccessResult {
  hasAccess: true
  knowledgeBase: Pick<
    KnowledgeBaseData,
    'id' | 'userId' | 'workspaceId' | 'name' | 'embeddingModel'
  >
}

interface KnowledgeBaseAccessDenied {
  hasAccess: false
  notFound?: boolean
  reason?: string
}

export type KnowledgeBaseAccessCheck = KnowledgeBaseAccessResult | KnowledgeBaseAccessDenied

interface DocumentAccessResult {
  hasAccess: true
  document: DocumentData
  knowledgeBase: Pick<
    KnowledgeBaseData,
    'id' | 'userId' | 'workspaceId' | 'name' | 'embeddingModel'
  >
}

interface DocumentAccessDenied {
  hasAccess: false
  notFound?: boolean
  reason: string
}

export type DocumentAccessCheck = DocumentAccessResult | DocumentAccessDenied

interface ChunkAccessResult {
  hasAccess: true
  chunk: EmbeddingData
  document: DocumentData
  knowledgeBase: Pick<
    KnowledgeBaseData,
    'id' | 'userId' | 'workspaceId' | 'name' | 'embeddingModel'
  >
}

interface ChunkAccessDenied {
  hasAccess: false
  notFound?: boolean
  reason: string
}

export type ChunkAccessCheck = ChunkAccessResult | ChunkAccessDenied

/**
 * Resolve knowledge-base access for a user, gated by read or write permission.
 *
 * Read (`requireWrite: false`) grants on any workspace permission; write
 * (`requireWrite: true`) requires `write`/`admin`. Legacy non-workspace KBs grant
 * to the owning user in both modes.
 */
async function resolveKnowledgeBaseAccess(
  knowledgeBaseId: string,
  userId: string,
  requireWrite: boolean
): Promise<KnowledgeBaseAccessCheck> {
  const kb = await db
    .select({
      id: knowledgeBase.id,
      userId: knowledgeBase.userId,
      workspaceId: knowledgeBase.workspaceId,
      name: knowledgeBase.name,
      embeddingModel: knowledgeBase.embeddingModel,
    })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  if (kb.length === 0) {
    return { hasAccess: false, notFound: true }
  }

  const kbData = kb[0]

  if (kbData.workspaceId) {
    // Workspace KB: use workspace permissions only
    const userPermission = await getUserEntityPermissions(userId, 'workspace', kbData.workspaceId)
    const permitted = requireWrite
      ? userPermission === 'write' || userPermission === 'admin'
      : userPermission !== null
    return permitted ? { hasAccess: true, knowledgeBase: kbData } : { hasAccess: false }
  }

  // Legacy non-workspace KB: allow owner access
  if (kbData.userId === userId) {
    return { hasAccess: true, knowledgeBase: kbData }
  }

  return { hasAccess: false }
}

/**
 * Check if a user has read access to a knowledge base.
 */
export async function checkKnowledgeBaseAccess(
  knowledgeBaseId: string,
  userId: string
): Promise<KnowledgeBaseAccessCheck> {
  return resolveKnowledgeBaseAccess(knowledgeBaseId, userId, false)
}

/**
 * Check if a user has write access to a knowledge base.
 *
 * Write access is granted if:
 * 1. KB has a workspace: user has write or admin permissions on that workspace
 * 2. KB has no workspace (legacy): user owns the KB directly
 */
export async function checkKnowledgeBaseWriteAccess(
  knowledgeBaseId: string,
  userId: string
): Promise<KnowledgeBaseAccessCheck> {
  return resolveKnowledgeBaseAccess(knowledgeBaseId, userId, true)
}

/**
 * Resolve document access within a knowledge base, gated by read or write
 * permission on the KB (see {@link resolveKnowledgeBaseAccess}).
 */
async function resolveDocumentAccess(
  knowledgeBaseId: string,
  documentId: string,
  userId: string,
  requireWrite: boolean
): Promise<DocumentAccessCheck> {
  const kbAccess = await resolveKnowledgeBaseAccess(knowledgeBaseId, userId, requireWrite)

  if (!kbAccess.hasAccess) {
    return {
      hasAccess: false,
      notFound: kbAccess.notFound,
      reason: kbAccess.notFound ? 'Knowledge base not found' : 'Unauthorized knowledge base access',
    }
  }

  const doc = await db
    .select()
    .from(document)
    .where(
      and(
        eq(document.id, documentId),
        eq(document.knowledgeBaseId, knowledgeBaseId),
        eq(document.userExcluded, false),
        isNull(document.archivedAt),
        isNull(document.deletedAt)
      )
    )
    .limit(1)

  if (doc.length === 0) {
    return { hasAccess: false, notFound: true, reason: 'Document not found' }
  }

  return {
    hasAccess: true,
    document: doc[0] as DocumentData,
    knowledgeBase: kbAccess.knowledgeBase!,
  }
}

/**
 * Check if a user has read access to a document within a knowledge base.
 */
export async function checkDocumentAccess(
  knowledgeBaseId: string,
  documentId: string,
  userId: string
): Promise<DocumentAccessCheck> {
  return resolveDocumentAccess(knowledgeBaseId, documentId, userId, false)
}

/**
 * Check if a user has write access to a specific document.
 * Write access is granted if user has write access to the knowledge base.
 */
export async function checkDocumentWriteAccess(
  knowledgeBaseId: string,
  documentId: string,
  userId: string
): Promise<DocumentAccessCheck> {
  return resolveDocumentAccess(knowledgeBaseId, documentId, userId, true)
}

/**
 * Resolve chunk access within a document/knowledge base, gated by read or write
 * permission on the KB. The document must exist and be fully processed
 * (`processingStatus === 'completed'`) before its chunks are accessible.
 */
async function resolveChunkAccess(
  knowledgeBaseId: string,
  documentId: string,
  chunkId: string,
  userId: string,
  requireWrite: boolean
): Promise<ChunkAccessCheck> {
  const kbAccess = await resolveKnowledgeBaseAccess(knowledgeBaseId, userId, requireWrite)

  if (!kbAccess.hasAccess) {
    return {
      hasAccess: false,
      notFound: kbAccess.notFound,
      reason: kbAccess.notFound ? 'Knowledge base not found' : 'Unauthorized knowledge base access',
    }
  }

  const doc = await db
    .select()
    .from(document)
    .where(
      and(
        eq(document.id, documentId),
        eq(document.knowledgeBaseId, knowledgeBaseId),
        eq(document.userExcluded, false),
        isNull(document.archivedAt),
        isNull(document.deletedAt)
      )
    )
    .limit(1)

  if (doc.length === 0) {
    return { hasAccess: false, notFound: true, reason: 'Document not found' }
  }

  const docData = doc[0] as DocumentData

  // Chunks are only accessible once the document has finished processing.
  if (docData.processingStatus !== 'completed') {
    return {
      hasAccess: false,
      reason: `Document is not ready for access (status: ${docData.processingStatus})`,
    }
  }

  const chunk = await db
    .select()
    .from(embedding)
    .where(and(eq(embedding.id, chunkId), eq(embedding.documentId, documentId)))
    .limit(1)

  if (chunk.length === 0) {
    return { hasAccess: false, notFound: true, reason: 'Chunk not found' }
  }

  return {
    hasAccess: true,
    chunk: chunk[0] as EmbeddingData,
    document: docData,
    knowledgeBase: kbAccess.knowledgeBase!,
  }
}

/**
 * Check if a user has read access to a chunk within a document and knowledge base.
 */
export async function checkChunkAccess(
  knowledgeBaseId: string,
  documentId: string,
  chunkId: string,
  userId: string
): Promise<ChunkAccessCheck> {
  return resolveChunkAccess(knowledgeBaseId, documentId, chunkId, userId, false)
}

/**
 * Check if a user has write access to a chunk.
 *
 * Mirrors {@link checkChunkAccess} but requires write/admin on the knowledge
 * base's workspace (or KB ownership for legacy KBs), matching the permission
 * needed to create chunks. Used for chunk mutation (update and delete) so those
 * operations require the same permission as creation rather than read.
 */
export async function checkChunkWriteAccess(
  knowledgeBaseId: string,
  documentId: string,
  chunkId: string,
  userId: string
): Promise<ChunkAccessCheck> {
  return resolveChunkAccess(knowledgeBaseId, documentId, chunkId, userId, true)
}
