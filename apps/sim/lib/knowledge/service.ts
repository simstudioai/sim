import { randomUUID } from 'crypto'
import { db } from '@sim/db'
import { document, knowledgeBase, knowledgeConnector, permissions, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import type {
  ChunkingConfig,
  CreateKnowledgeBaseData,
  KnowledgeBaseWithCounts,
} from '@/lib/knowledge/types'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('KnowledgeBaseService')

export type KnowledgeBaseScope = 'active' | 'archived' | 'all'

/**
 * Get knowledge bases that a user can access
 */
export async function getKnowledgeBases(
  userId: string,
  workspaceId?: string | null,
  scope: KnowledgeBaseScope = 'active'
): Promise<KnowledgeBaseWithCounts[]> {
  const scopeCondition =
    scope === 'all'
      ? undefined
      : scope === 'archived'
        ? sql`${knowledgeBase.deletedAt} IS NOT NULL`
        : isNull(knowledgeBase.deletedAt)

  const knowledgeBasesWithCounts = await db
    .select({
      id: knowledgeBase.id,
      userId: knowledgeBase.userId,
      name: knowledgeBase.name,
      description: knowledgeBase.description,
      tokenCount: sql<number>`COALESCE(SUM(${document.tokenCount}), 0)`.mapWith(Number),
      embeddingModel: knowledgeBase.embeddingModel,
      embeddingDimension: knowledgeBase.embeddingDimension,
      chunkingConfig: knowledgeBase.chunkingConfig,
      createdAt: knowledgeBase.createdAt,
      updatedAt: knowledgeBase.updatedAt,
      workspaceId: knowledgeBase.workspaceId,
      docCount: count(document.id),
    })
    .from(knowledgeBase)
    .leftJoin(
      document,
      and(eq(document.knowledgeBaseId, knowledgeBase.id), isNull(document.deletedAt))
    )
    .leftJoin(
      permissions,
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, knowledgeBase.workspaceId),
        eq(permissions.userId, userId)
      )
    )
    .leftJoin(workspace, eq(knowledgeBase.workspaceId, workspace.id))
    .where(
      and(
        scopeCondition,
        workspaceId
          ? // When filtering by workspace
            or(
              // Knowledge bases belonging to the specified workspace (user must have workspace permissions)
              and(
                eq(knowledgeBase.workspaceId, workspaceId),
                isNotNull(permissions.userId),
                isNull(workspace.archivedAt)
              ),
              // Fallback: User-owned knowledge bases without workspace (legacy)
              and(eq(knowledgeBase.userId, userId), isNull(knowledgeBase.workspaceId))
            )
          : // When not filtering by workspace, use original logic
            or(
              // User owns the knowledge base directly
              eq(knowledgeBase.userId, userId),
              // User has permissions on the knowledge base's workspace
              and(isNotNull(permissions.userId), isNull(workspace.archivedAt))
            )
      )
    )
    .groupBy(knowledgeBase.id)
    .orderBy(knowledgeBase.createdAt)

  const kbIds = knowledgeBasesWithCounts.map((kb) => kb.id)

  const connectorRows =
    kbIds.length > 0
      ? await db
          .select({
            knowledgeBaseId: knowledgeConnector.knowledgeBaseId,
            connectorType: knowledgeConnector.connectorType,
          })
          .from(knowledgeConnector)
          .where(
            and(
              inArray(knowledgeConnector.knowledgeBaseId, kbIds),
              isNull(knowledgeConnector.deletedAt)
            )
          )
      : []

  const connectorTypesByKb = new Map<string, string[]>()
  for (const row of connectorRows) {
    const types = connectorTypesByKb.get(row.knowledgeBaseId) ?? []
    if (!types.includes(row.connectorType)) {
      types.push(row.connectorType)
    }
    connectorTypesByKb.set(row.knowledgeBaseId, types)
  }

  return knowledgeBasesWithCounts.map((kb) => ({
    ...kb,
    chunkingConfig: kb.chunkingConfig as ChunkingConfig,
    docCount: Number(kb.docCount),
    connectorTypes: connectorTypesByKb.get(kb.id) ?? [],
  }))
}

/**
 * Create a new knowledge base
 */
export async function createKnowledgeBase(
  data: CreateKnowledgeBaseData,
  requestId: string
): Promise<KnowledgeBaseWithCounts> {
  const kbId = randomUUID()
  const now = new Date()

  const hasPermission = await getUserEntityPermissions(data.userId, 'workspace', data.workspaceId)
  if (hasPermission !== 'admin' && hasPermission !== 'write') {
    throw new Error('User does not have permission to create knowledge bases in this workspace')
  }

  const newKnowledgeBase = {
    id: kbId,
    name: data.name,
    description: data.description ?? null,
    workspaceId: data.workspaceId,
    userId: data.userId,
    tokenCount: 0,
    embeddingModel: data.embeddingModel,
    embeddingDimension: data.embeddingDimension,
    chunkingConfig: data.chunkingConfig,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }

  await db.insert(knowledgeBase).values(newKnowledgeBase)

  logger.info(`[${requestId}] Created knowledge base: ${data.name} (${kbId})`)

  return {
    id: kbId,
    userId: data.userId,
    name: data.name,
    description: data.description ?? null,
    tokenCount: 0,
    embeddingModel: data.embeddingModel,
    embeddingDimension: data.embeddingDimension,
    chunkingConfig: data.chunkingConfig,
    createdAt: now,
    updatedAt: now,
    workspaceId: data.workspaceId,
    docCount: 0,
    connectorTypes: [],
  }
}

/**
 * Update a knowledge base
 */
export async function updateKnowledgeBase(
  knowledgeBaseId: string,
  updates: {
    name?: string
    description?: string
    workspaceId?: string | null
    chunkingConfig?: {
      maxSize: number
      minSize: number
      overlap: number
    }
  },
  requestId: string
): Promise<KnowledgeBaseWithCounts> {
  const now = new Date()
  const updateData: {
    updatedAt: Date
    name?: string
    description?: string | null
    workspaceId?: string | null
    chunkingConfig?: {
      maxSize: number
      minSize: number
      overlap: number
    }
    embeddingModel?: string
    embeddingDimension?: number
  } = {
    updatedAt: now,
  }

  if (updates.name !== undefined) updateData.name = updates.name
  if (updates.description !== undefined) updateData.description = updates.description
  if (updates.workspaceId !== undefined) updateData.workspaceId = updates.workspaceId
  if (updates.chunkingConfig !== undefined) {
    updateData.chunkingConfig = updates.chunkingConfig
    updateData.embeddingModel = 'text-embedding-3-small'
    updateData.embeddingDimension = 1536
  }

  await db.update(knowledgeBase).set(updateData).where(eq(knowledgeBase.id, knowledgeBaseId))

  const updatedKb = await db
    .select({
      id: knowledgeBase.id,
      userId: knowledgeBase.userId,
      name: knowledgeBase.name,
      description: knowledgeBase.description,
      tokenCount: sql<number>`COALESCE(SUM(${document.tokenCount}), 0)`.mapWith(Number),
      embeddingModel: knowledgeBase.embeddingModel,
      embeddingDimension: knowledgeBase.embeddingDimension,
      chunkingConfig: knowledgeBase.chunkingConfig,
      createdAt: knowledgeBase.createdAt,
      updatedAt: knowledgeBase.updatedAt,
      workspaceId: knowledgeBase.workspaceId,
      docCount: count(document.id),
    })
    .from(knowledgeBase)
    .leftJoin(
      document,
      and(eq(document.knowledgeBaseId, knowledgeBase.id), isNull(document.deletedAt))
    )
    .where(eq(knowledgeBase.id, knowledgeBaseId))
    .groupBy(knowledgeBase.id)
    .limit(1)

  if (updatedKb.length === 0) {
    throw new Error(`Knowledge base ${knowledgeBaseId} not found`)
  }

  logger.info(`[${requestId}] Updated knowledge base: ${knowledgeBaseId}`)

  return {
    ...updatedKb[0],
    chunkingConfig: updatedKb[0].chunkingConfig as ChunkingConfig,
    docCount: Number(updatedKb[0].docCount),
    connectorTypes: [],
  }
}

/**
 * Get a single knowledge base by ID
 */
export async function getKnowledgeBaseById(
  knowledgeBaseId: string
): Promise<KnowledgeBaseWithCounts | null> {
  const result = await db
    .select({
      id: knowledgeBase.id,
      userId: knowledgeBase.userId,
      name: knowledgeBase.name,
      description: knowledgeBase.description,
      tokenCount: sql<number>`COALESCE(SUM(${document.tokenCount}), 0)`.mapWith(Number),
      embeddingModel: knowledgeBase.embeddingModel,
      embeddingDimension: knowledgeBase.embeddingDimension,
      chunkingConfig: knowledgeBase.chunkingConfig,
      createdAt: knowledgeBase.createdAt,
      updatedAt: knowledgeBase.updatedAt,
      workspaceId: knowledgeBase.workspaceId,
      docCount: count(document.id),
    })
    .from(knowledgeBase)
    .leftJoin(
      document,
      and(eq(document.knowledgeBaseId, knowledgeBase.id), isNull(document.deletedAt))
    )
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .groupBy(knowledgeBase.id)
    .limit(1)

  if (result.length === 0) {
    return null
  }

  return {
    ...result[0],
    chunkingConfig: result[0].chunkingConfig as ChunkingConfig,
    docCount: Number(result[0].docCount),
    connectorTypes: [],
  }
}

/**
 * Delete a knowledge base (soft delete)
 */
export async function deleteKnowledgeBase(
  knowledgeBaseId: string,
  requestId: string
): Promise<void> {
  const now = new Date()

  await db
    .update(knowledgeBase)
    .set({
      deletedAt: now,
      updatedAt: now,
    })
    .where(eq(knowledgeBase.id, knowledgeBaseId))

  logger.info(`[${requestId}] Soft deleted knowledge base: ${knowledgeBaseId}`)
}
