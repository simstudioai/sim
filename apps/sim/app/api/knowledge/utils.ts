import { db } from '@sim/db'
import { document, embedding, knowledgeBase } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { getUserEntityPermissions } from '@/lib/permissions/utils'

export interface KnowledgeBaseData {
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
  processingStatus: string
  processingStartedAt?: Date | null
  processingCompletedAt?: Date | null
  processingError?: string | null
  enabled: boolean
  deletedAt?: Date | null
  uploadedAt: Date
  // Document tags
  tag1?: string | null
  tag2?: string | null
  tag3?: string | null
  tag4?: string | null
  tag5?: string | null
  tag6?: string | null
  tag7?: string | null
}

export interface EmbeddingData {
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
  // Tag fields for filtering
  tag1?: string | null
  tag2?: string | null
  tag3?: string | null
  tag4?: string | null
  tag5?: string | null
  tag6?: string | null
  tag7?: string | null
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export interface KnowledgeBaseAccessResult {
  hasAccess: true
  knowledgeBase: Pick<KnowledgeBaseData, 'id' | 'userId'>
}

export interface KnowledgeBaseAccessDenied {
  hasAccess: false
  notFound?: boolean
  reason?: string
}

export type KnowledgeBaseAccessCheck = KnowledgeBaseAccessResult | KnowledgeBaseAccessDenied

export interface DocumentAccessResult {
  hasAccess: true
  document: DocumentData
  knowledgeBase: Pick<KnowledgeBaseData, 'id' | 'userId'>
}

export interface DocumentAccessDenied {
  hasAccess: false
  notFound?: boolean
  reason: string
}

export type DocumentAccessCheck = DocumentAccessResult | DocumentAccessDenied

export interface ChunkAccessResult {
  hasAccess: true
  chunk: EmbeddingData
  document: DocumentData
  knowledgeBase: Pick<KnowledgeBaseData, 'id' | 'userId'>
}

export interface ChunkAccessDenied {
  hasAccess: false
  notFound?: boolean
  reason: string
}

export type ChunkAccessCheck = ChunkAccessResult | ChunkAccessDenied

/**
 * Check if a user has access to a knowledge base
 */
export async function checkKnowledgeBaseAccess(
  knowledgeBaseId: string,
  userId: string
): Promise<KnowledgeBaseAccessCheck> {
  const kb = await db
    .select({
      id: knowledgeBase.id,
      userId: knowledgeBase.userId,
      workspaceId: knowledgeBase.workspaceId,
    })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  if (kb.length === 0) {
    return { hasAccess: false, notFound: true }
  }

  const kbData = kb[0]

  // Case 1: User owns the knowledge base directly
  if (kbData.userId === userId) {
    return { hasAccess: true, knowledgeBase: kbData }
  }

  // Case 2: Knowledge base belongs to a workspace the user has permissions for
  if (kbData.workspaceId) {
    const userPermission = await getUserEntityPermissions(userId, 'workspace', kbData.workspaceId)
    if (userPermission !== null) {
      return { hasAccess: true, knowledgeBase: kbData }
    }
  }

  return { hasAccess: false }
}

/**
 * Check if a user has write access to a knowledge base
 * Write access is granted if:
 * 1. User owns the knowledge base directly, OR
 * 2. User has write or admin permissions on the knowledge base's workspace
 */
export async function checkKnowledgeBaseWriteAccess(
  knowledgeBaseId: string,
  userId: string
): Promise<KnowledgeBaseAccessCheck> {
  const kb = await db
    .select({
      id: knowledgeBase.id,
      userId: knowledgeBase.userId,
      workspaceId: knowledgeBase.workspaceId,
    })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  if (kb.length === 0) {
    return { hasAccess: false, notFound: true }
  }

  const kbData = kb[0]

  // Case 1: User owns the knowledge base directly
  if (kbData.userId === userId) {
    return { hasAccess: true, knowledgeBase: kbData }
  }

  // Case 2: Knowledge base belongs to a workspace and user has write/admin permissions
  if (kbData.workspaceId) {
    const userPermission = await getUserEntityPermissions(userId, 'workspace', kbData.workspaceId)
    if (userPermission === 'write' || userPermission === 'admin') {
      return { hasAccess: true, knowledgeBase: kbData }
    }
  }

  return { hasAccess: false }
}

/**
 * Check if a user has write access to a specific document
 * Write access is granted if user has write access to the knowledge base
 */
export async function checkDocumentWriteAccess(
  knowledgeBaseId: string,
  documentId: string,
  userId: string
): Promise<DocumentAccessCheck> {
  // First check if user has write access to the knowledge base
  const kbAccess = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, userId)

  if (!kbAccess.hasAccess) {
    return {
      hasAccess: false,
      notFound: kbAccess.notFound,
      reason: kbAccess.notFound ? 'Knowledge base not found' : 'Unauthorized knowledge base access',
    }
  }

  // Check if document exists
  const doc = await db
    .select({
      id: document.id,
      filename: document.filename,
      fileUrl: document.fileUrl,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
      chunkCount: document.chunkCount,
      tokenCount: document.tokenCount,
      characterCount: document.characterCount,
      enabled: document.enabled,
      processingStatus: document.processingStatus,
      processingError: document.processingError,
      uploadedAt: document.uploadedAt,
      processingStartedAt: document.processingStartedAt,
      processingCompletedAt: document.processingCompletedAt,
      knowledgeBaseId: document.knowledgeBaseId,
    })
    .from(document)
    .where(and(eq(document.id, documentId), isNull(document.deletedAt)))
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
 * Check if a user has access to a document within a knowledge base
 */
export async function checkDocumentAccess(
  knowledgeBaseId: string,
  documentId: string,
  userId: string
): Promise<DocumentAccessCheck> {
  // First check if user has access to the knowledge base
  const kbAccess = await checkKnowledgeBaseAccess(knowledgeBaseId, userId)

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
 * Check if a user has access to a chunk within a document and knowledge base
 */
export async function checkChunkAccess(
  knowledgeBaseId: string,
  documentId: string,
  chunkId: string,
  userId: string
): Promise<ChunkAccessCheck> {
  // First check if user has access to the knowledge base
  const kbAccess = await checkKnowledgeBaseAccess(knowledgeBaseId, userId)

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
        isNull(document.deletedAt)
      )
    )
    .limit(1)

  if (doc.length === 0) {
    return { hasAccess: false, notFound: true, reason: 'Document not found' }
  }

  const docData = doc[0] as DocumentData

  // Check if document processing is completed
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
