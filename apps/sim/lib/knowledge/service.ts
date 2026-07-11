import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  knowledgeConnector,
  permissions,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  assertFolderMutable,
  assertResourceMutable,
  assertResourceMutableUnlessUnlocking,
} from '@sim/platform-authz/resource-lock'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, count, eq, exists, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { generateRestoreName } from '@/lib/core/utils/restore-name'
import { assertFolderParentValid } from '@/lib/folders/parent-validation'
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

export class KnowledgeBasePermissionError extends Error {
  readonly code = 'KNOWLEDGE_BASE_FORBIDDEN' as const
}

export class KnowledgeBaseValidationError extends Error {
  readonly code = 'KNOWLEDGE_BASE_VALIDATION' as const
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
      folderId: knowledgeBase.folderId,
      locked: knowledgeBase.locked,
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
    throw new KnowledgeBasePermissionError(
      'User does not have permission to create knowledge bases in this workspace'
    )
  }

  // Folder-parent validity (folder table) and duplicate-name (knowledgeBase
  // table) checks are disjoint queries with no dependency on each other, so
  // they run concurrently rather than as two sequential round-trips.
  const [parentError, duplicate] = await Promise.all([
    data.folderId
      ? assertFolderParentValid(data.folderId, {
          workspaceId: data.workspaceId,
          resourceType: 'knowledge_base',
        })
      : Promise.resolve(null),
    db
      .select({ id: knowledgeBase.id })
      .from(knowledgeBase)
      .where(
        and(
          eq(knowledgeBase.workspaceId, data.workspaceId),
          eq(knowledgeBase.name, data.name),
          isNull(knowledgeBase.deletedAt)
        )
      )
      .limit(1),
  ])

  if (parentError) {
    throw new KnowledgeBaseValidationError(parentError.error)
  }
  if (duplicate.length > 0) {
    throw new KnowledgeBaseConflictError(data.name)
  }

  const newKnowledgeBase = {
    id: kbId,
    name: data.name,
    description: data.description ?? null,
    workspaceId: data.workspaceId,
    folderId: data.folderId ?? null,
    userId: data.userId,
    tokenCount: 0,
    embeddingModel: data.embeddingModel,
    embeddingDimension: data.embeddingDimension,
    chunkingConfig: data.chunkingConfig,
    locked: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }

  // Wrap the lock check and insert in a transaction so a folder lock applied between
  // the check and the insert can't slip a knowledge base into a now-locked folder
  // (same TOCTOU class as createTable in lib/table/service.ts).
  try {
    await db.transaction(async (tx) => {
      // assertFolderParentValid above only checks workspace/type/deleted-state -- without
      // this, a knowledge base could be created directly inside a locked folder. Passing
      // `tx` keeps this read inside the same transaction as the insert below.
      if (data.folderId) {
        await assertFolderMutable(data.folderId, 'knowledge_base', tx)
      }
      await tx.insert(knowledgeBase).values(newKnowledgeBase)
    })
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
    folderId: data.folderId ?? null,
    locked: false,
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
    folderId?: string | null
    locked?: boolean
    chunkingConfig?: {
      maxSize: number
      minSize: number
      overlap: number
    }
  },
  requestId: string,
  options?: { actorUserId?: string }
): Promise<KnowledgeBaseWithCounts> {
  const now = new Date()
  const updateData: {
    updatedAt: Date
    name?: string
    description?: string | null
    workspaceId?: string | null
    folderId?: string | null
    locked?: boolean
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
  if (updates.folderId !== undefined) updateData.folderId = updates.folderId
  if (updates.locked !== undefined) updateData.locked = updates.locked
  if (updates.chunkingConfig !== undefined) {
    updateData.chunkingConfig = updates.chunkingConfig
  }

  // `Object.keys(updates)` can't distinguish "field genuinely provided" from "field
  // present as undefined" (the route always builds a full literal object) — reuse the
  // same `!== undefined` checks that already gate `updateData` above, matching the
  // isLockOnlyUpdate pattern used by renameTable()/performRenameWorkspaceFile().
  const hasNonLockUpdate =
    updates.name !== undefined ||
    updates.description !== undefined ||
    updates.workspaceId !== undefined ||
    updates.folderId !== undefined ||
    updates.chunkingConfig !== undefined
  // An admin combining `locked: false` with other field changes in one request is
  // unlocking the knowledge base as part of this same atomic write -- the
  // mutable-check must not treat that request's own current (about-to-be-cleared)
  // lock as blocking. It must still enforce a lock inherited from the KB's
  // containing folder, since clearing the KB's own `locked` flag doesn't affect
  // that.
  if (hasNonLockUpdate) {
    await assertResourceMutableUnlessUnlocking(
      'knowledge_base',
      knowledgeBaseId,
      updates.locked === false
    )
  }

  if (updates.workspaceId !== undefined && !options?.actorUserId) {
    throw new KnowledgeBasePermissionError(
      'actorUserId is required to change a knowledge base workspace'
    )
  }

  // Resolved before the transaction: the target workspace comes from the
  // request input, so checking it inside the FOR UPDATE tx would only issue a
  // second pooled-connection checkout while the first is held.
  const targetWorkspacePermission = updates.workspaceId
    ? await getUserEntityPermissions(
        options?.actorUserId as string,
        'workspace',
        updates.workspaceId
      )
    : null

  try {
    await db.transaction(async (tx) => {
      const [currentKb] = await tx
        .select({ workspaceId: knowledgeBase.workspaceId, userId: knowledgeBase.userId })
        .from(knowledgeBase)
        .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
        .for('update')
        .limit(1)

      if (!currentKb) {
        throw new Error(`Knowledge base ${knowledgeBaseId} not found`)
      }

      // The `hasNonLockUpdate` check above is a separate round-trip against the
      // default `db` client -- an admin could lock this KB in the window between
      // that check and this transaction. Re-check inside the transaction (joining
      // `tx` so the read is part of the same atomic unit as the FOR UPDATE lock
      // just acquired and the write below), matching deleteKnowledgeBase/
      // restoreKnowledgeBase in this file.
      if (hasNonLockUpdate) {
        await assertResourceMutableUnlessUnlocking(
          'knowledge_base',
          knowledgeBaseId,
          updates.locked === false,
          tx
        )
      }

      if (updates.workspaceId !== undefined) {
        const actorUserId = options?.actorUserId as string
        const currentWorkspaceId = currentKb.workspaceId ?? null
        const targetWorkspaceId = updates.workspaceId ?? null

        if (targetWorkspaceId !== currentWorkspaceId) {
          if (!targetWorkspaceId) {
            if (actorUserId !== currentKb.userId) {
              throw new KnowledgeBasePermissionError(
                'Only the knowledge base owner can remove it from a workspace'
              )
            }
          } else if (
            targetWorkspacePermission !== 'write' &&
            targetWorkspacePermission !== 'admin'
          ) {
            throw new KnowledgeBasePermissionError(
              'User does not have permission on the target workspace'
            )
          }
        }
      }

      const effectiveWorkspaceId =
        updates.workspaceId !== undefined ? updates.workspaceId : currentKb.workspaceId

      if (updates.folderId && !effectiveWorkspaceId) {
        throw new KnowledgeBaseValidationError(
          'Cannot assign a folder to a knowledge base with no workspace'
        )
      }

      // Folder-parent validity and duplicate-name are disjoint queries with
      // no dependency on each other; run them concurrently on the `tx`
      // client to minimize the window the FOR UPDATE row lock is held.
      const [parentError, duplicate] = await Promise.all([
        updates.folderId
          ? assertFolderParentValid(
              updates.folderId,
              { workspaceId: effectiveWorkspaceId as string, resourceType: 'knowledge_base' },
              tx
            )
          : Promise.resolve(null),
        updates.name !== undefined && effectiveWorkspaceId
          ? tx
              .select({ id: knowledgeBase.id })
              .from(knowledgeBase)
              .where(
                and(
                  eq(knowledgeBase.workspaceId, effectiveWorkspaceId),
                  eq(knowledgeBase.name, updates.name),
                  isNull(knowledgeBase.deletedAt),
                  ne(knowledgeBase.id, knowledgeBaseId)
                )
              )
              .limit(1)
          : Promise.resolve([]),
      ])

      if (parentError) {
        throw new KnowledgeBaseValidationError(parentError.error)
      }
      // assertResourceMutable above only checked the KB's *current* folder chain —
      // without this, a KB could be moved out of an unlocked folder into a locked one.
      // Passing `tx` keeps this read inside the same transaction as the write below.
      if (updates.folderId) {
        await assertFolderMutable(updates.folderId, 'knowledge_base', tx)
      }
      if (updates.name !== undefined && effectiveWorkspaceId && duplicate.length > 0) {
        throw new KnowledgeBaseConflictError(updates.name)
      }

      await tx
        .update(knowledgeBase)
        .set(updateData)
        .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))

      // When a KB changes workspace, re-point the ownership bindings for its
      // stored files so file authorization (which resolves the owning workspace
      // from the trusted binding, not from document.fileUrl) follows the KB to
      // its new workspace. Only bindings the KB's *current* workspace already
      // owns are moved: this scopes the update to this KB's own files and
      // prevents a document referencing another tenant's key (e.g. one planted
      // while the KB had no workspace) from hijacking that key's binding on
      // move. A null current workspace owns no bindings, so nothing is moved.
      if (updates.workspaceId !== undefined) {
        const currentWorkspaceId = currentKb.workspaceId ?? null
        const targetWorkspaceId = updates.workspaceId ?? null

        if (currentWorkspaceId && targetWorkspaceId !== currentWorkspaceId) {
          await tx
            .update(workspaceFiles)
            .set({ workspaceId: targetWorkspaceId })
            .where(
              and(
                eq(workspaceFiles.context, 'knowledge-base'),
                eq(workspaceFiles.workspaceId, currentWorkspaceId),
                isNull(workspaceFiles.deletedAt),
                exists(
                  tx
                    .select({ one: sql`1` })
                    .from(document)
                    .where(
                      and(
                        eq(document.knowledgeBaseId, knowledgeBaseId),
                        isNotNull(document.storageKey),
                        eq(document.storageKey, workspaceFiles.key)
                      )
                    )
                )
              )
            )
        }
      }
    })
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
      folderId: knowledgeBase.folderId,
      locked: knowledgeBase.locked,
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
      folderId: knowledgeBase.folderId,
      locked: knowledgeBase.locked,
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
  await assertResourceMutable('knowledge_base', knowledgeBaseId)

  const now = new Date()

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM knowledge_base WHERE id = ${knowledgeBaseId} FOR UPDATE`)

    // The pre-check above is a separate round-trip -- an admin could lock this KB
    // in the window between that check and this transaction. Re-check inside the
    // transaction, joining `tx` so the read is part of the same atomic unit as
    // the FOR UPDATE lock and the writes below.
    await assertResourceMutable('knowledge_base', knowledgeBaseId, tx)

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

        // Restore doesn't change folderId, so this correctly evaluates both the KB's own
        // `locked` flag and its (unchanged) containing folder chain. Runs inside the same
        // transaction as the FOR UPDATE lock above and the write below, closing the TOCTOU
        // window where a concurrent request locks the KB or its folder in between.
        await assertResourceMutable('knowledge_base', knowledgeBaseId, tx)

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
