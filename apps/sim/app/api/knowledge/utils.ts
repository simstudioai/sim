import { db } from '@sim/db'
import { knowledgeBase } from '@sim/db/schema'
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
