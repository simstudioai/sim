import { db } from '@sim/db'
import { document, knowledgeBase, knowledgeConnector, permissions, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, count, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { generateRestoreName } from '@/lib/core/utils/restore-name'
import type {
  ChunkingConfig,
  CreateKnowledgeBaseData,
  KnowledgeBaseWithCounts,
} from '@/lib/knowledge/types'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('KnowledgeBaseService')

export class KnowledgeBaseConflictError extends Error {
  readonly code = 'KNOWLEDGE_BASE_EXISTS' as const
  constructor(name: string) {
    super(`A knowledge base named "${name}" already exists in this workspace`)
  }
}

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
      deletedAt: knowledgeBase.deletedAt,
      workspaceId: knowledgeBase.workspaceId,
      docCount: count(document.id),
    })
    .from(knowledgeBase)
    .leftJoin(
      document,
      and(
        eq(document.knowledgeBaseId, knowledgeBase.id),
        eq(document.userExcluded, false),
        isNull(document.archivedAt),
        isNull(document.deletedAt)
      )
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
              isNull(knowledgeConnector.archivedAt),
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
  const kbId = generateId()
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

  const duplicate = await db
    .select({ id: knowledgeBase.id })
    .from(knowledgeBase)
    .where(
      and(
        eq(knowledgeBase.workspaceId, data.workspaceId),
        eq(knowledgeBase.name, data.name),
        isNull(knowledgeBase.deletedAt)
      )
    )
    .limit(1)

  if (duplicate.length > 0) {
    throw new KnowledgeBaseConflictError(data.name)
  }

  try {
    await db.insert(knowledgeBase).values(newKnowledgeBase)
  } catch (error: unknown) {
    if (getPostgresErrorCode(error) === '23505') {
      throw new KnowledgeBaseConflictError(data.name)
    }
    throw error
  }

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
    deletedAt: null,
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

  if (updates.name !== undefined) {
    const existing = await db
      .select({ id: knowledgeBase.id, workspaceId: knowledgeBase.workspaceId })
      .from(knowledgeBase)
      .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
      .limit(1)

    if (existing.length > 0 && existing[0].workspaceId) {
      const duplicate = await db
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(
          and(
            eq(knowledgeBase.workspaceId, existing[0].workspaceId),
            eq(knowledgeBase.name, updates.name),
            isNull(knowledgeBase.deletedAt),
            ne(knowledgeBase.id, knowledgeBaseId)
          )
        )
        .limit(1)

      if (duplicate.length > 0) {
        throw new KnowledgeBaseConflictError(updates.name)
      }
    }
  }

  try {
    await db
      .update(knowledgeBase)
      .set(updateData)
      .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
  } catch (error: unknown) {
    if (getPostgresErrorCode(error) === '23505' && updates.name !== undefined) {
      throw new KnowledgeBaseConflictError(updates.name)
    }
    throw error
  }

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
      deletedAt: knowledgeBase.deletedAt,
      workspaceId: knowledgeBase.workspaceId,
      docCount: count(document.id),
    })
    .from(knowledgeBase)
    .leftJoin(
      document,
      and(
        eq(document.knowledgeBaseId, knowledgeBase.id),
        eq(document.userExcluded, false),
        isNull(document.archivedAt),
        isNull(document.deletedAt)
      )
    )
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
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
      deletedAt: knowledgeBase.deletedAt,
      workspaceId: knowledgeBase.workspaceId,
      docCount: count(document.id),
    })
    .from(knowledgeBase)
    .leftJoin(
      document,
      and(
        eq(document.knowledgeBaseId, knowledgeBase.id),
        eq(document.userExcluded, false),
        isNull(document.archivedAt),
        isNull(document.deletedAt)
      )
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

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM knowledge_base WHERE id = ${knowledgeBaseId} FOR UPDATE`)

    await tx
      .update(knowledgeBase)
      .set({
        deletedAt: now,
        updatedAt: now,
      })
      .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))

    await tx
      .update(document)
      .set({
        archivedAt: now,
      })
      .where(
        and(
          eq(document.knowledgeBaseId, knowledgeBaseId),
          isNull(document.archivedAt),
          isNull(document.deletedAt)
        )
      )

    await tx
      .update(knowledgeConnector)
      .set({
        archivedAt: now,
        status: 'paused',
        updatedAt: now,
      })
      .where(
        and(
          eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      )
  })

  logger.info(`[${requestId}] Soft deleted knowledge base: ${knowledgeBaseId}`)
}

/**
 * Restore a soft-deleted knowledge base and its graph children.
 * Clears archivedAt on children that were archived as part of the KB snapshot.
 * Does NOT revive children that were directly deleted (deletedAt set).
 */
export async function restoreKnowledgeBase(
  knowledgeBaseId: string,
  requestId: string
): Promise<void> {
  const [kb] = await db
    .select({
      id: knowledgeBase.id,
      name: knowledgeBase.name,
      deletedAt: knowledgeBase.deletedAt,
      workspaceId: knowledgeBase.workspaceId,
    })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.id, knowledgeBaseId))
    .limit(1)

  if (!kb) {
    throw new Error('Knowledge base not found')
  }

  if (!kb.deletedAt) {
    throw new Error('Knowledge base is not archived')
  }

  if (kb.workspaceId) {
    const { getWorkspaceWithOwner } = await import('@/lib/workspaces/permissions/utils')
    const ws = await getWorkspaceWithOwner(kb.workspaceId)
    if (!ws || ws.archivedAt) {
      throw new Error('Cannot restore knowledge base into an archived workspace')
    }
  }

  /**
   * A concurrent create/rename can commit the same active name after `generateRestoreName`'s check
   * (MVCC) and before this transaction commits. Retries pick a new random suffix; 23505 is still
   * mapped to {@link KnowledgeBaseConflictError} if exhaustion occurs.
   */
  const maxUniqueViolationRetries = 8
  let attemptedRestoreName = ''

  for (let attempt = 0; attempt < maxUniqueViolationRetries; attempt++) {
    attemptedRestoreName = ''
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT 1 FROM knowledge_base WHERE id = ${knowledgeBaseId} FOR UPDATE`)

        attemptedRestoreName = await generateRestoreName(kb.name, async (candidate) => {
          if (!kb.workspaceId) return false
          const [match] = await tx
            .select({ id: knowledgeBase.id })
            .from(knowledgeBase)
            .where(
              and(
                eq(knowledgeBase.workspaceId, kb.workspaceId),
                eq(knowledgeBase.name, candidate),
                isNull(knowledgeBase.deletedAt)
              )
            )
            .limit(1)
          return !!match
        })

        const now = new Date()

        await tx
          .update(knowledgeBase)
          .set({ deletedAt: null, updatedAt: now, name: attemptedRestoreName })
          .where(eq(knowledgeBase.id, knowledgeBaseId))

        await tx
          .update(document)
          .set({ archivedAt: null })
          .where(
            and(
              eq(document.knowledgeBaseId, knowledgeBaseId),
              isNotNull(document.archivedAt),
              isNull(document.deletedAt)
            )
          )

        await tx
          .update(knowledgeConnector)
          .set({ archivedAt: null, status: 'active', updatedAt: now })
          .where(
            and(
              eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
              isNotNull(knowledgeConnector.archivedAt),
              isNull(knowledgeConnector.deletedAt)
            )
          )
      })
      break
    } catch (error: unknown) {
      if (getPostgresErrorCode(error) !== '23505') {
        throw error
      }
      if (attempt === maxUniqueViolationRetries - 1) {
        throw new KnowledgeBaseConflictError(attemptedRestoreName || kb.name)
      }
    }
  }

  logger.info(
    `[${requestId}] Restored knowledge base: ${knowledgeBaseId} as "${attemptedRestoreName}"`
  )
}
