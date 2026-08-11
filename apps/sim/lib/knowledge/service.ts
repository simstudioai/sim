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
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import {
  and,
  type Column,
  count,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import type { V2KnowledgeBaseSortBy } from '@/lib/api/contracts/v2/knowledge'
import type { ListSortOrder } from '@/lib/api/list-query'
import { listOrderBy, searchFilter } from '@/lib/api/list-query'
import type { HighestPrioritySubscription } from '@/lib/billing/core/plan'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { ensureUserStatsExists } from '@/lib/billing/core/usage'
import {
  applyStorageUsageDeltasInTx,
  maybeNotifyStorageLimitForBillingContext,
  resolveStorageBillingContext,
  type StorageBillingContext,
} from '@/lib/billing/storage'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRestoreName } from '@/lib/core/utils/restore-name'
import { findActiveFolder, resolveRestoredFolderId } from '@/lib/folders/queries'
import {
  MAX_KNOWLEDGE_BASES_PER_WORKSPACE,
  MAX_KNOWLEDGE_CONNECTOR_TYPE_ROWS_PER_LIST,
} from '@/lib/knowledge/constants'
import type {
  ChunkingConfig,
  CreateKnowledgeBaseData,
  KnowledgeBaseWithCounts,
} from '@/lib/knowledge/types'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('KnowledgeBaseService')

/**
 * Every caller-fixable knowledge-base failure is an {@link OrchestrationError},
 * so `lib/knowledge/orchestration` classifies it by class and each surface maps
 * that one class to its own status. Message text is then free to change without
 * silently moving a 409 to a 400.
 */
export class KnowledgeBaseConflictError extends OrchestrationError {
  constructor(name: string) {
    super('conflict', `A knowledge base named "${name}" already exists in this workspace`)
    this.name = 'KnowledgeBaseConflictError'
  }
}

export class KnowledgeBasePermissionError extends OrchestrationError {
  constructor(message: string) {
    super('forbidden', message)
    this.name = 'KnowledgeBasePermissionError'
  }
}

/** Raised when a caller files a knowledge base under a folder it may not use. */
export class KnowledgeBaseFolderError extends OrchestrationError {
  constructor() {
    super('validation', 'Folder not found in this workspace')
    this.name = 'KnowledgeBaseFolderError'
  }
}

/** Raised when a knowledge base the caller named does not exist (or is archived). */
export class KnowledgeBaseNotFoundError extends OrchestrationError {
  constructor(knowledgeBaseId: string) {
    super('not_found', `Knowledge base ${knowledgeBaseId} not found`)
    this.name = 'KnowledgeBaseNotFoundError'
  }
}

/**
 * Verifies `folderId` is an active `knowledge_base` folder in `workspaceId`. A `null` target
 * (the workspace root) needs no check.
 */
async function assertKnowledgeBaseFolder(
  folderId: string | null | undefined,
  workspaceId: string | null
): Promise<void> {
  if (!folderId) return
  if (!workspaceId) throw new KnowledgeBaseFolderError()
  if (!(await findActiveFolder(folderId, workspaceId, 'knowledge_base'))) {
    throw new KnowledgeBaseFolderError()
  }
}

export type KnowledgeBaseScope = 'active' | 'archived' | 'all'

type KnowledgeBaseStorageMove =
  | {
      kind: 'workspace-to-workspace'
      sourceContext: StorageBillingContext
      sourceWorkspaceId: string
      destinationContext: StorageBillingContext
    }
  | {
      kind: 'workspace-to-personal'
      sourceContext: StorageBillingContext
      sourceWorkspaceId: string
      ownerSubscription: HighestPrioritySubscription | null
      ownerUserId: string
    }
  | {
      kind: 'personal-to-workspace'
      sourceWorkspaceId: null
      destinationContext: StorageBillingContext
      ownerSubscription: HighestPrioritySubscription | null
      ownerUserId: string
    }

/**
 * Orderings for the public list's sortable fields, made total over the contract
 * enum by `satisfies`. Each ends in `createdAt` so knowledge bases sharing a
 * name still come back in a stable order.
 */
const KNOWLEDGE_BASE_SORTS = {
  name: [knowledgeBase.name, knowledgeBase.createdAt],
  createdAt: [knowledgeBase.createdAt],
  updatedAt: [knowledgeBase.updatedAt, knowledgeBase.createdAt],
} satisfies Record<V2KnowledgeBaseSortBy, readonly Column[]>

export interface GetKnowledgeBasesOptions {
  /** Restrict to one knowledge-base folder; `undefined` lists all and `null` lists the root. */
  folderId?: string | null
  /** Case-insensitive substring match on the knowledge base name. */
  search?: string
  sortBy?: V2KnowledgeBaseSortBy
  sortOrder?: ListSortOrder
}

async function attachConnectorTypes(
  knowledgeBases: Array<Omit<KnowledgeBaseWithCounts, 'connectorTypes'>>
): Promise<KnowledgeBaseWithCounts[]> {
  const kbIds = knowledgeBases.map((kb) => kb.id)
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
          .limit(MAX_KNOWLEDGE_CONNECTOR_TYPE_ROWS_PER_LIST + 1)
      : []
  if (connectorRows.length > MAX_KNOWLEDGE_CONNECTOR_TYPE_ROWS_PER_LIST) {
    throw new Error(
      `Knowledge connector projection exceeds the ${MAX_KNOWLEDGE_CONNECTOR_TYPE_ROWS_PER_LIST} row limit`
    )
  }

  const connectorTypesByKb = new Map<string, string[]>()
  for (const row of connectorRows) {
    const types = connectorTypesByKb.get(row.knowledgeBaseId) ?? []
    if (!types.includes(row.connectorType)) types.push(row.connectorType)
    connectorTypesByKb.set(row.knowledgeBaseId, types)
  }

  return knowledgeBases.map((kb) => ({
    ...kb,
    connectorTypes: connectorTypesByKb.get(kb.id) ?? [],
  }))
}

/**
 * Lists active knowledge bases in one canonical workspace after application
 * authorization. Unlike the legacy user-oriented query, this never widens the
 * scope to workspace-less rows and never depends on a human permission join.
 */
export async function getWorkspaceKnowledgeBases(
  workspaceId: string,
  scope: KnowledgeBaseScope = 'active',
  options?: GetKnowledgeBasesOptions
): Promise<KnowledgeBaseWithCounts[]> {
  const { folderId, search, sortBy = 'createdAt', sortOrder = 'asc' } = options ?? {}
  const scopeCondition =
    scope === 'all'
      ? undefined
      : scope === 'archived'
        ? sql`${knowledgeBase.deletedAt} IS NOT NULL`
        : isNull(knowledgeBase.deletedAt)

  const rows = await db
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
    .where(
      and(
        eq(knowledgeBase.workspaceId, workspaceId),
        scopeCondition,
        folderId === undefined
          ? undefined
          : folderId === null
            ? isNull(knowledgeBase.folderId)
            : eq(knowledgeBase.folderId, folderId),
        searchFilter(knowledgeBase.name, search)
      )
    )
    .groupBy(knowledgeBase.id)
    .orderBy(...listOrderBy(KNOWLEDGE_BASE_SORTS[sortBy], sortOrder))
    .limit(MAX_KNOWLEDGE_BASES_PER_WORKSPACE + 1)

  if (rows.length > MAX_KNOWLEDGE_BASES_PER_WORKSPACE) {
    throw new Error(
      `Knowledge base list exceeds the ${MAX_KNOWLEDGE_BASES_PER_WORKSPACE} row limit`
    )
  }

  return attachConnectorTypes(
    rows.map((kb) => ({
      ...kb,
      chunkingConfig: kb.chunkingConfig as ChunkingConfig,
      docCount: Number(kb.docCount),
    }))
  )
}

/**
 * Get knowledge bases that a user can access.
 *
 * Filter and sort are applied in the query, so a search costs one narrowed scan
 * rather than materializing every knowledge base the caller can reach.
 */
export async function getKnowledgeBases(
  userId: string,
  workspaceId?: string | null,
  scope: KnowledgeBaseScope = 'active',
  options?: GetKnowledgeBasesOptions
): Promise<KnowledgeBaseWithCounts[]> {
  const { folderId, search, sortBy = 'createdAt', sortOrder = 'asc' } = options ?? {}
  const scopeCondition =
    scope === 'all'
      ? undefined
      : scope === 'archived'
        ? sql`${knowledgeBase.deletedAt} IS NOT NULL`
        : isNull(knowledgeBase.deletedAt)

  /**
   * Legacy knowledge bases predate workspaces and have no `workspaceId`, so the creator is
   * their only possible authority. Anything with a `workspaceId` must clear
   * `currentWorkspaceMembership` instead — creator identity goes stale the moment a member
   * is removed from the workspace.
   */
  const legacyOwnedKnowledgeBase = and(
    eq(knowledgeBase.userId, userId),
    isNull(knowledgeBase.workspaceId)
  )
  const currentWorkspaceMembership = and(
    isNotNull(permissions.userId),
    isNull(workspace.archivedAt)
  )

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
        folderId === undefined
          ? undefined
          : folderId === null
            ? isNull(knowledgeBase.folderId)
            : eq(knowledgeBase.folderId, folderId),
        searchFilter(knowledgeBase.name, search),
        or(
          and(
            workspaceId ? eq(knowledgeBase.workspaceId, workspaceId) : undefined,
            currentWorkspaceMembership
          ),
          legacyOwnedKnowledgeBase
        )
      )
    )
    .groupBy(knowledgeBase.id)
    .orderBy(...listOrderBy(KNOWLEDGE_BASE_SORTS[sortBy], sortOrder))

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
  const hasPermission = await getUserEntityPermissions(data.userId, 'workspace', data.workspaceId)
  if (hasPermission !== 'admin' && hasPermission !== 'write') {
    throw new KnowledgeBasePermissionError(
      'User does not have permission to create knowledge bases in this workspace'
    )
  }

  return createAuthorizedKnowledgeBase(data, requestId)
}

/**
 * Persists a knowledge base for an already-authorized application use case.
 * Callers outside the application layer must use {@link createKnowledgeBase}.
 */
export async function createAuthorizedKnowledgeBase(
  data: CreateKnowledgeBaseData,
  requestId: string
): Promise<KnowledgeBaseWithCounts> {
  const kbId = generateId()
  const now = new Date()

  await assertKnowledgeBaseFolder(data.folderId, data.workspaceId)

  const folderId = data.folderId ?? null

  const newKnowledgeBase = {
    id: kbId,
    name: data.name,
    description: data.description ?? null,
    workspaceId: data.workspaceId,
    folderId,
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
    folderId,
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
    chunkingConfig?: {
      maxSize: number
      minSize: number
      overlap: number
    }
  },
  requestId: string,
  options?: { actorUserId?: string; assertedWorkspaceId?: string }
): Promise<KnowledgeBaseWithCounts> {
  const now = new Date()
  const updateData: Partial<typeof knowledgeBase.$inferInsert> = {
    updatedAt: now,
  }

  if (updates.name !== undefined) updateData.name = updates.name
  if (updates.description !== undefined) updateData.description = updates.description
  if (updates.workspaceId !== undefined) updateData.workspaceId = updates.workspaceId
  if (updates.folderId !== undefined) updateData.folderId = updates.folderId
  if (updates.chunkingConfig !== undefined) {
    updateData.chunkingConfig = updates.chunkingConfig
  }

  if (updates.workspaceId !== undefined && !options?.actorUserId) {
    throw new KnowledgeBasePermissionError(
      'actorUserId is required to change a knowledge base workspace'
    )
  }

  /**
   * Folder admission is resolved against the workspace the knowledge base will end up in,
   * before the transaction opens — same posture as the permission and storage lookups below,
   * which deliberately keep external reads off a pooled transaction connection.
   *
   * A workspace change without an explicit folder needs no lookup here: the storage block
   * below already reads the current row, and re-roots from there.
   */
  if (updates.folderId !== undefined) {
    let effectiveWorkspaceId = updates.workspaceId
    if (effectiveWorkspaceId === undefined) {
      const [snapshot] = await db
        .select({ workspaceId: knowledgeBase.workspaceId })
        .from(knowledgeBase)
        .where(
          and(
            eq(knowledgeBase.id, knowledgeBaseId),
            isNull(knowledgeBase.deletedAt),
            options?.assertedWorkspaceId
              ? eq(knowledgeBase.workspaceId, options.assertedWorkspaceId)
              : undefined
          )
        )
        .limit(1)
      if (!snapshot) {
        throw new KnowledgeBaseNotFoundError(knowledgeBaseId)
      }
      effectiveWorkspaceId = snapshot.workspaceId
    }
    await assertKnowledgeBaseFolder(updates.folderId, effectiveWorkspaceId)
  }

  /**
   * Resolve transfer admission before opening the transaction. The locked KB
   * row below revalidates this source snapshot; a concurrent move is an error
   * instead of silently falling back to newly observed payer data.
   */
  let storageMove: KnowledgeBaseStorageMove | undefined
  if (updates.workspaceId !== undefined) {
    const [kbSnapshot] = await db
      .select({
        workspaceId: knowledgeBase.workspaceId,
        userId: knowledgeBase.userId,
        folderId: knowledgeBase.folderId,
      })
      .from(knowledgeBase)
      .where(
        and(
          eq(knowledgeBase.id, knowledgeBaseId),
          isNull(knowledgeBase.deletedAt),
          options?.assertedWorkspaceId
            ? eq(knowledgeBase.workspaceId, options.assertedWorkspaceId)
            : undefined
        )
      )
      .limit(1)
    if (!kbSnapshot) {
      throw new KnowledgeBaseNotFoundError(knowledgeBaseId)
    }
    const sourceWorkspaceId = kbSnapshot.workspaceId ?? null
    const destinationWorkspaceId = updates.workspaceId ?? null

    /**
     * Folders never cross workspaces, so a workspace move would leave the row pointing at a
     * folder the destination cannot render — an active knowledge base nobody can reach.
     * Land it at the destination root unless the caller named a folder itself.
     */
    if (
      updates.folderId === undefined &&
      kbSnapshot.folderId &&
      destinationWorkspaceId !== sourceWorkspaceId
    ) {
      updateData.folderId = null
    }

    if (
      sourceWorkspaceId &&
      destinationWorkspaceId &&
      sourceWorkspaceId !== destinationWorkspaceId
    ) {
      const [sourceContext, destinationContext] = await Promise.all([
        resolveStorageBillingContext(sourceWorkspaceId),
        resolveStorageBillingContext(destinationWorkspaceId),
      ])
      storageMove = {
        kind: 'workspace-to-workspace',
        sourceWorkspaceId,
        sourceContext,
        destinationContext,
      }
    } else if (sourceWorkspaceId && !destinationWorkspaceId) {
      const [sourceContext, ownerSubscription] = await Promise.all([
        resolveStorageBillingContext(sourceWorkspaceId),
        getHighestPrioritySubscription(kbSnapshot.userId),
        ensureUserStatsExists(kbSnapshot.userId),
      ])
      storageMove = {
        kind: 'workspace-to-personal',
        sourceWorkspaceId,
        sourceContext,
        ownerUserId: kbSnapshot.userId,
        ownerSubscription,
      }
    } else if (!sourceWorkspaceId && destinationWorkspaceId) {
      const [destinationContext, ownerSubscription] = await Promise.all([
        resolveStorageBillingContext(destinationWorkspaceId),
        getHighestPrioritySubscription(kbSnapshot.userId),
        ensureUserStatsExists(kbSnapshot.userId),
      ])
      storageMove = {
        kind: 'personal-to-workspace',
        sourceWorkspaceId: null,
        destinationContext,
        ownerUserId: kbSnapshot.userId,
        ownerSubscription,
      }
    }
  }

  /**
   * The target permission is also resolved before the transaction so no
   * external permission lookup holds a pooled transaction connection.
   */
  const targetWorkspacePermission = updates.workspaceId
    ? await getUserEntityPermissions(
        options?.actorUserId as string,
        'workspace',
        updates.workspaceId
      )
    : null

  let destinationUpdatedUsage: number | undefined
  try {
    destinationUpdatedUsage = await db.transaction(async (tx) => {
      const [currentKb] = await tx
        .select({ workspaceId: knowledgeBase.workspaceId, userId: knowledgeBase.userId })
        .from(knowledgeBase)
        .where(
          and(
            eq(knowledgeBase.id, knowledgeBaseId),
            isNull(knowledgeBase.deletedAt),
            options?.assertedWorkspaceId
              ? eq(knowledgeBase.workspaceId, options.assertedWorkspaceId)
              : undefined
          )
        )
        .for('update')
        .limit(1)

      if (!currentKb) {
        throw new KnowledgeBaseNotFoundError(knowledgeBaseId)
      }

      if (storageMove && (currentKb.workspaceId ?? null) !== storageMove.sourceWorkspaceId) {
        throw new Error(
          `Knowledge base ${knowledgeBaseId} workspace changed; retry with fresh storage billing contexts`
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

      if (updates.name !== undefined) {
        const effectiveWorkspaceId =
          updates.workspaceId !== undefined ? updates.workspaceId : currentKb.workspaceId

        if (effectiveWorkspaceId) {
          const duplicate = await tx
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

          if (duplicate.length > 0) {
            throw new KnowledgeBaseConflictError(updates.name)
          }
        }
      }

      /**
       * Storage lock order for a move is KB, sorted workspaces, sorted user
       * payers, then sorted organization payers. The accounting helpers own the
       * workspace/payer portion and keep same-payer moves aggregate-neutral.
       * Document bytes are summed in SQL while the KB lock excludes concurrent
       * normal document insertion.
       */
      let transferUpdatedUsage: number | undefined
      if (storageMove) {
        const [billableStorage] = await tx
          .select({
            bytes: sql<number>`COALESCE(SUM(${document.fileSize}), 0)`,
          })
          .from(document)
          .where(
            and(
              eq(document.knowledgeBaseId, knowledgeBaseId),
              isNull(document.connectorId),
              isNull(document.deletedAt)
            )
          )
          .limit(1)
        const billableBytes = Number(billableStorage?.bytes ?? 0)
        if (storageMove.kind === 'workspace-to-workspace') {
          transferUpdatedUsage = await applyStorageUsageDeltasInTx(tx, {
            workspaceDeltas: [
              { context: storageMove.sourceContext, deltaBytes: -billableBytes },
              { context: storageMove.destinationContext, deltaBytes: billableBytes },
            ],
            legacyDeltas: [],
          })
        } else if (storageMove.kind === 'workspace-to-personal') {
          transferUpdatedUsage = await applyStorageUsageDeltasInTx(tx, {
            workspaceDeltas: [{ context: storageMove.sourceContext, deltaBytes: -billableBytes }],
            legacyDeltas: [
              {
                userId: storageMove.ownerUserId,
                subscription: storageMove.ownerSubscription,
                deltaBytes: billableBytes,
              },
            ],
          })
        } else {
          transferUpdatedUsage = await applyStorageUsageDeltasInTx(tx, {
            workspaceDeltas: [
              { context: storageMove.destinationContext, deltaBytes: billableBytes },
            ],
            legacyDeltas: [
              {
                userId: storageMove.ownerUserId,
                subscription: storageMove.ownerSubscription,
                deltaBytes: -billableBytes,
              },
            ],
          })
        }
      }

      await tx
        .update(knowledgeBase)
        .set(updateData)
        .where(
          and(
            eq(knowledgeBase.id, knowledgeBaseId),
            isNull(knowledgeBase.deletedAt),
            options?.assertedWorkspaceId
              ? eq(knowledgeBase.workspaceId, options.assertedWorkspaceId)
              : undefined
          )
        )

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

      return transferUpdatedUsage
    })
  } catch (error: unknown) {
    if (getPostgresErrorCode(error) === '23505' && updates.name !== undefined) {
      throw new KnowledgeBaseConflictError(updates.name)
    }
    throw error
  }

  if (storageMove && destinationUpdatedUsage !== undefined) {
    if (storageMove.kind === 'workspace-to-workspace') {
      const sourcePayer = storageMove.sourceContext.billingEntity
      const destinationPayer = storageMove.destinationContext.billingEntity
      if (sourcePayer.type !== destinationPayer.type || sourcePayer.id !== destinationPayer.id) {
        void maybeNotifyStorageLimitForBillingContext(
          storageMove.destinationContext,
          destinationUpdatedUsage
        )
      }
    } else if (storageMove.kind === 'personal-to-workspace') {
      void maybeNotifyStorageLimitForBillingContext(
        storageMove.destinationContext,
        destinationUpdatedUsage
      )
    }
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
    .where(
      and(
        eq(knowledgeBase.id, knowledgeBaseId),
        isNull(knowledgeBase.deletedAt),
        options?.assertedWorkspaceId
          ? eq(knowledgeBase.workspaceId, options.assertedWorkspaceId)
          : undefined
      )
    )
    .groupBy(knowledgeBase.id)
    .limit(1)

  if (updatedKb.length === 0) {
    throw new KnowledgeBaseNotFoundError(knowledgeBaseId)
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
 *
 * `options.archivedAt` lets a bulk caller stamp every row it archives with one shared
 * timestamp, which is how the folder cascade later identifies exactly what it archived and
 * restores that set and nothing else. Mirrors `archiveWorkflow`'s option of the same name.
 * Defaults to now, so single-KB callers are unaffected.
 */
export async function deleteKnowledgeBase(
  knowledgeBaseId: string,
  requestId: string,
  options?: { archivedAt?: Date; assertedWorkspaceId?: string }
): Promise<void> {
  const now = options?.archivedAt ?? new Date()

  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: knowledgeBase.id, workspaceId: knowledgeBase.workspaceId })
      .from(knowledgeBase)
      .where(
        and(
          eq(knowledgeBase.id, knowledgeBaseId),
          isNull(knowledgeBase.deletedAt),
          options?.assertedWorkspaceId
            ? eq(knowledgeBase.workspaceId, options.assertedWorkspaceId)
            : undefined
        )
      )
      .limit(1)
      .for('update')
    if (!locked) throw new KnowledgeBaseNotFoundError(knowledgeBaseId)

    await tx
      .update(knowledgeBase)
      .set({
        deletedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(knowledgeBase.id, knowledgeBaseId),
          isNull(knowledgeBase.deletedAt),
          options?.assertedWorkspaceId
            ? eq(knowledgeBase.workspaceId, options.assertedWorkspaceId)
            : undefined
        )
      )

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
  requestId: string,
  options?: { restoringFolderIds?: ReadonlySet<string> }
): Promise<void> {
  const [kb] = await db
    .select({
      id: knowledgeBase.id,
      name: knowledgeBase.name,
      deletedAt: knowledgeBase.deletedAt,
      workspaceId: knowledgeBase.workspaceId,
      folderId: knowledgeBase.folderId,
    })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.id, knowledgeBaseId))
    .limit(1)

  if (!kb) {
    throw new KnowledgeBaseNotFoundError(knowledgeBaseId)
  }

  if (!kb.deletedAt) {
    throw new OrchestrationError('conflict', 'Knowledge base is not archived')
  }

  if (kb.workspaceId) {
    const { getWorkspaceWithOwner } = await import('@/lib/workspaces/permissions/utils')
    const ws = await getWorkspaceWithOwner(kb.workspaceId)
    if (!ws || ws.archivedAt) {
      throw new OrchestrationError(
        'conflict',
        'Cannot restore knowledge base into an archived workspace'
      )
    }
  }

  /**
   * Restoring a knowledge base whose folder is still archived would file it under a folder
   * the Knowledge page never renders, leaving an active row nobody can reach. Re-root it
   * instead — the same treatment `restoreFolder` gives a folder with an archived parent.
   * `restoringFolderIds` exempts the folder subtree this restore is part of, which is still
   * archived at the moment the cascade calls in.
   */
  const restoredFolderId = await resolveRestoredFolderId(
    kb.folderId,
    kb.workspaceId,
    'knowledge_base',
    options?.restoringFolderIds
  )

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
          .set({
            deletedAt: null,
            updatedAt: now,
            name: attemptedRestoreName,
            folderId: restoredFolderId,
          })
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
