import { db } from '@sim/db'
import { document, knowledgeBase, knowledgeConnector, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { filterUndefined } from '@sim/utils/object'
import type { SQL } from 'drizzle-orm'
import { and, count, eq, exists, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import type { V2KnowledgeBaseSortBy } from '@/lib/api/contracts/v2/knowledge'
import type { CursorKey, KeysetKey, ListSortOrder } from '@/lib/api/list-query'
import {
  keysetColumns,
  keysetPage,
  listOrderBy,
  resumeKeyset,
  searchFilter,
  textKey,
  timestampKey,
} from '@/lib/api/list-query'
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
import {
  type ResourceOwner,
  resourceScopeColumns,
  resourceScopeFromOwner,
} from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { generateRestoreName } from '@/lib/core/utils/restore-name'
import { findActiveFolder, resolveRestoredFolderId } from '@/lib/folders/queries'
import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { knowledgeAccessCondition } from '@/lib/knowledge/access/predicate'
import type { KnowledgeAccessScope } from '@/lib/knowledge/access/types'
import { mirrorsSourceAcls } from '@/lib/knowledge/connectors/access-modes'
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
    super(
      'conflict',
      `A knowledge base named "${name}" already exists in this workspace. Names are unique across the whole workspace — folders do not namespace them — so pick a different name, or rename/delete the existing knowledge base first.`
    )
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

/** The columns a knowledge-base keyset orders and resumes on. */
interface KnowledgeBaseSortRow {
  id: string
  name: string
  createdAt: Date
  updatedAt: Date
}

const knowledgeBaseIdKey = textKey<KnowledgeBaseSortRow>(knowledgeBase.id, (row) => row.id)

/**
 * Keyset orderings for the public list's sortable fields, made total over the
 * contract enum by `satisfies`.
 *
 * Each ends in `id` rather than `createdAt`. `createdAt` is not unique, so it
 * could not separate two knowledge bases created in the same millisecond — which
 * left ties in an order the planner chose, and would let a cursor repeat or skip
 * a row at a page boundary now that the list pages.
 */
const KNOWLEDGE_BASE_SORTS = {
  name: [textKey<KnowledgeBaseSortRow>(knowledgeBase.name, (row) => row.name), knowledgeBaseIdKey],
  createdAt: [
    timestampKey<KnowledgeBaseSortRow>(knowledgeBase.createdAt, (row) => row.createdAt),
    knowledgeBaseIdKey,
  ],
  updatedAt: [
    timestampKey<KnowledgeBaseSortRow>(knowledgeBase.updatedAt, (row) => row.updatedAt),
    knowledgeBaseIdKey,
  ],
} satisfies Record<V2KnowledgeBaseSortBy, readonly KeysetKey<KnowledgeBaseSortRow>[]>

export interface GetKnowledgeBasesOptions {
  access?: KnowledgeAccessScope
  /** Restrict to one knowledge-base folder; `undefined` lists all and `null` lists the root. */
  folderId?: string | null
  /** Case-insensitive substring match on the knowledge base name. */
  search?: string
  sortBy?: V2KnowledgeBaseSortBy
  sortOrder?: ListSortOrder
  /** Page size. Omitted reads the whole set as one page. */
  limit?: number
  /** Keyset to resume after, from the previous page's `nextCursorKeys`. */
  cursorKeys?: CursorKey[]
}

/** `active` hides soft-deleted rows, `archived` shows only them, `all` filters neither. */
function knowledgeBaseScopeCondition(scope: KnowledgeBaseScope) {
  if (scope === 'all') return undefined
  return scope === 'archived'
    ? sql`${knowledgeBase.deletedAt} IS NOT NULL`
    : isNull(knowledgeBase.deletedAt)
}

/**
 * The one projection every knowledge-base list renders: the base's own columns plus its live
 * document count. Both list queries read through here so a column added to one list can never
 * be missing from the other — they are concatenated into a single rendered list.
 */
async function readKnowledgeBaseRows(
  where: SQL | undefined,
  orderBy: SQL[],
  limit?: number,
  access?: KnowledgeAccessScope
): Promise<
  Array<Omit<KnowledgeBaseWithCounts, 'connectorTypes' | 'hasPermissionScopedConnector'>>
> {
  const query = db
    .select({
      id: knowledgeBase.id,
      userId: knowledgeBase.userId,
      name: knowledgeBase.name,
      isSearchIndex: knowledgeBase.isSearchIndex,
      description: knowledgeBase.description,
      tokenCount: sql<number>`COALESCE(SUM(${document.tokenCount}), 0)`.mapWith(Number),
      embeddingModel: knowledgeBase.embeddingModel,
      embeddingDimension: knowledgeBase.embeddingDimension,
      chunkingConfig: knowledgeBase.chunkingConfig,
      createdAt: knowledgeBase.createdAt,
      updatedAt: knowledgeBase.updatedAt,
      deletedAt: knowledgeBase.deletedAt,
      workspaceId: knowledgeBase.workspaceId,
      organizationId: knowledgeBase.organizationId,
      folderId: knowledgeBase.folderId,
      docCount: count(document.knowledgeBaseId),
    })
    .from(knowledgeBase)
    .leftJoin(
      document,
      and(
        eq(document.knowledgeBaseId, knowledgeBase.id),
        eq(document.userExcluded, false),
        isNull(document.archivedAt),
        isNull(document.deletedAt),
        access ? knowledgeAccessCondition(access) : undefined
      )
    )
    .where(where)
    .groupBy(knowledgeBase.id)
    .orderBy(...orderBy)

  const rows = limit === undefined ? await query : await query.limit(limit)

  return rows.map((kb) => ({
    ...kb,
    chunkingConfig: kb.chunkingConfig as ChunkingConfig,
    docCount: Number(kb.docCount),
  }))
}

async function attachConnectorTypes(
  knowledgeBases: Array<
    Omit<KnowledgeBaseWithCounts, 'connectorTypes' | 'hasPermissionScopedConnector'>
  >
): Promise<KnowledgeBaseWithCounts[]> {
  const kbIds = knowledgeBases.map((kb) => kb.id)
  const connectorRows =
    kbIds.length > 0
      ? await db
          .select({
            knowledgeBaseId: knowledgeConnector.knowledgeBaseId,
            connectorType: knowledgeConnector.connectorType,
            accessMode: knowledgeConnector.accessMode,
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
  const memberScopedKbIds = new Set<string>()
  /** Mirrored ACLs scope documents whether or not the feature is on: off, they read as hidden, never as workspace-visible. */
  const mirroredKbIds = new Set<string>()
  for (const row of connectorRows) {
    const types = connectorTypesByKb.get(row.knowledgeBaseId) ?? []
    if (!types.includes(row.connectorType)) types.push(row.connectorType)
    connectorTypesByKb.set(row.knowledgeBaseId, types)
    if (row.accessMode === 'members') memberScopedKbIds.add(row.knowledgeBaseId)
    if (mirrorsSourceAcls(row.accessMode)) mirroredKbIds.add(row.knowledgeBaseId)
  }
  /**
   * A members-mode connector only scopes documents where the feature is on;
   * off, its documents read as workspace-visible and the base must say so.
   */
  const memberScopedWorkspaceIds = new Set(
    knowledgeBases
      .filter((kb) => memberScopedKbIds.has(kb.id) && kb.workspaceId)
      .map((kb) => kb.workspaceId as string)
  )
  for (const workspaceId of memberScopedWorkspaceIds) {
    if (await isKnowledgeMemberAccessAvailable({ workspaceId })) continue
    for (const kb of knowledgeBases) {
      if (kb.workspaceId === workspaceId) memberScopedKbIds.delete(kb.id)
    }
  }

  return knowledgeBases.map((kb) => ({
    ...kb,
    connectorTypes: connectorTypesByKb.get(kb.id) ?? [],
    hasPermissionScopedConnector: memberScopedKbIds.has(kb.id) || mirroredKbIds.has(kb.id),
  }))
}

/**
 * Lists active knowledge bases in one canonical workspace after application
 * authorization. Unlike the legacy user-oriented query, this never widens the
 * scope to workspace-less rows and never depends on a human permission join.
 */
async function readWorkspaceKnowledgeBaseRows(
  workspaceId: string,
  scope: KnowledgeBaseScope,
  options?: GetKnowledgeBasesOptions
): Promise<{
  data: Array<Omit<KnowledgeBaseWithCounts, 'connectorTypes' | 'hasPermissionScopedConnector'>>
  nextCursorKeys: CursorKey[] | null
}> {
  const {
    folderId,
    search,
    sortBy = 'createdAt',
    sortOrder = 'asc',
    limit,
    cursorKeys,
  } = options ?? {}
  const keys = KNOWLEDGE_BASE_SORTS[sortBy]

  /**
   * An unpaged read is unbounded, matching the sibling internal lists (`listTables`, workspace
   * files). A row cap could only ever fire for a caller that did not ask for a page — the one
   * kind with no cursor to respond with — so it can only turn a slow list into a 500.
   */
  const readLimit = limit === undefined ? undefined : limit + 1

  const rows = await readKnowledgeBaseRows(
    and(
      eq(knowledgeBase.workspaceId, workspaceId),
      knowledgeBaseScopeCondition(scope),
      folderId === undefined
        ? undefined
        : folderId === null
          ? isNull(knowledgeBase.folderId)
          : eq(knowledgeBase.folderId, folderId),
      searchFilter(knowledgeBase.name, search),
      resumeKeyset(keys, cursorKeys, sortOrder)
    ),
    listOrderBy(keysetColumns(keys), sortOrder),
    readLimit,
    options?.access
  )

  return keysetPage(keys, rows, limit)
}

export async function getWorkspaceKnowledgeBases(
  workspaceId: string,
  scope: KnowledgeBaseScope = 'active',
  options?: GetKnowledgeBasesOptions
): Promise<{ data: KnowledgeBaseWithCounts[]; nextCursorKeys: CursorKey[] | null }> {
  const page = await readWorkspaceKnowledgeBaseRows(workspaceId, scope, options)
  return {
    data: await attachConnectorTypes(page.data),
    nextCursorKeys: page.nextCursorKeys,
  }
}

/**
 * Lists the caller's legacy personal knowledge bases — the ones that predate workspaces and
 * carry no `workspaceId`, where the creator is the only possible authority. Workspace-owned
 * rows are read by {@link getWorkspaceKnowledgeBases} after an application use case has
 * authorized the workspace; nothing here re-derives that access.
 *
 * @deprecated Nothing creates workspace-less knowledge bases any more, so this population only
 * shrinks. Backfill the remaining rows onto a workspace and this function, its branch in
 * {@link listWorkspaceAndLegacyKnowledgeBases}, and the concept itself can go.
 */
async function readLegacyPersonalKnowledgeBaseRows(
  userId: string,
  scope: KnowledgeBaseScope
): Promise<
  Array<Omit<KnowledgeBaseWithCounts, 'connectorTypes' | 'hasPermissionScopedConnector'>>
> {
  const rows = await readKnowledgeBaseRows(
    and(
      knowledgeBaseScopeCondition(scope),
      eq(knowledgeBase.userId, userId),
      isNull(knowledgeBase.workspaceId),
      isNull(knowledgeBase.organizationId)
    ),
    listOrderBy(keysetColumns(KNOWLEDGE_BASE_SORTS.createdAt), 'asc')
  )

  return rows
}

export async function getLegacyPersonalKnowledgeBases(
  userId: string,
  scope: KnowledgeBaseScope = 'active'
): Promise<KnowledgeBaseWithCounts[]> {
  return attachConnectorTypes(await readLegacyPersonalKnowledgeBaseRows(userId, scope))
}

/**
 * Every knowledge base a caller can see under one workspace, as one ordered list.
 *
 * Two reads, because the list answers to two authorities. The workspace's own rows are read
 * once the caller has been authorized FOR that workspace — re-deriving that access from a
 * `permissions` row would contradict the authorization that just passed, since workspace
 * `admin` can come from an organization role with no such row behind it. Legacy workspace-less
 * bases answer only to their creator and belong under no workspace at all, so they ride along
 * here; otherwise they are reachable from nowhere.
 *
 * Callers authorize first. Nothing here decides access.
 */
export async function listWorkspaceAndLegacyKnowledgeBases(
  userId: string,
  workspaceId: string,
  scope: KnowledgeBaseScope = 'active',
  access?: KnowledgeAccessScope
): Promise<KnowledgeBaseWithCounts[]> {
  const [workspaceRows, legacyPersonalRows] = await Promise.all([
    readWorkspaceKnowledgeBaseRows(workspaceId, scope, { access }).then((page) => page.data),
    readLegacyPersonalKnowledgeBaseRows(userId, scope),
  ])

  /** One connector projection over the merged set, rather than one per source. */
  return attachConnectorTypes(
    legacyPersonalRows.length === 0
      ? workspaceRows
      : [...workspaceRows, ...legacyPersonalRows].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
        )
  )
}

/** Loads at most two active exact-name matches so a caller can fail on corrupt ambiguity. */
export async function findActiveKnowledgeBasesByExactName(
  workspaceId: string,
  name: string
): Promise<
  Array<Omit<KnowledgeBaseWithCounts, 'connectorTypes' | 'hasPermissionScopedConnector'>>
> {
  return readKnowledgeBaseRows(
    and(
      eq(knowledgeBase.workspaceId, workspaceId),
      eq(knowledgeBase.name, name),
      isNull(knowledgeBase.deletedAt)
    ),
    listOrderBy(keysetColumns(KNOWLEDGE_BASE_SORTS.createdAt), 'asc'),
    2
  )
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
  data: Omit<CreateKnowledgeBaseData, 'workspaceId'> & ResourceOwner,
  requestId: string
): Promise<KnowledgeBaseWithCounts> {
  const scope = resourceScopeFromOwner(data)
  const owner = resourceScopeColumns(scope)
  const kbId = generateId()
  const now = new Date()

  await assertKnowledgeBaseFolder(data.folderId, owner.workspaceId)

  const folderId = data.folderId ?? null

  const newKnowledgeBase = {
    id: kbId,
    name: data.name,
    isSearchIndex: data.isSearchIndex ?? false,
    description: data.description ?? null,
    ...owner,
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
        resourceScopeCondition(knowledgeBase, scope),
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
    ...owner,
    folderId,
    docCount: 0,
    connectorTypes: [],
    hasPermissionScopedConnector: false,
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
    chunkingConfig?: ChunkingConfig
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
    /**
     * Projected field by field rather than assigned whole, so every member of
     * {@link ChunkingConfig} is named here: `strategy` and `strategyOptions`
     * used to survive only because structural typing let them ride on an
     * object typed as the three size fields, and the first destructure of
     * those three would have dropped them silently.
     */
    const { maxSize, minSize, overlap, strategy, strategyOptions } = updates.chunkingConfig
    updateData.chunkingConfig = filterUndefined({
      maxSize,
      minSize,
      overlap,
      strategy,
      strategyOptions,
    })
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
        organizationId: knowledgeBase.organizationId,
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
        .select({
          workspaceId: knowledgeBase.workspaceId,
          organizationId: knowledgeBase.organizationId,
          userId: knowledgeBase.userId,
          isSearchIndex: knowledgeBase.isSearchIndex,
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
        .for('update')
        .limit(1)

      if (!currentKb) {
        throw new KnowledgeBaseNotFoundError(knowledgeBaseId)
      }

      if (
        currentKb.isSearchIndex &&
        updates.workspaceId !== undefined &&
        updates.workspaceId !== currentKb.workspaceId
      ) {
        throw new KnowledgeBasePermissionError('The search index must stay in its workspace')
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
      isSearchIndex: knowledgeBase.isSearchIndex,
      description: knowledgeBase.description,
      tokenCount: sql<number>`COALESCE(SUM(${document.tokenCount}), 0)`.mapWith(Number),
      embeddingModel: knowledgeBase.embeddingModel,
      embeddingDimension: knowledgeBase.embeddingDimension,
      chunkingConfig: knowledgeBase.chunkingConfig,
      createdAt: knowledgeBase.createdAt,
      updatedAt: knowledgeBase.updatedAt,
      deletedAt: knowledgeBase.deletedAt,
      workspaceId: knowledgeBase.workspaceId,
      organizationId: knowledgeBase.organizationId,
      folderId: knowledgeBase.folderId,
      docCount: count(document.knowledgeBaseId),
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

  const [withConnectors] = await attachConnectorTypes([
    {
      ...updatedKb[0],
      chunkingConfig: updatedKb[0].chunkingConfig as ChunkingConfig,
      docCount: Number(updatedKb[0].docCount),
    },
  ])
  return withConnectors
}

/**
 * Display names for knowledge bases that live in `workspaceId`, keyed by id.
 *
 * Scoped by workspace in the query rather than checked afterwards, so an id belonging to another
 * tenant resolves to nothing at all. Deliberately narrower than {@link getKnowledgeBaseById}, which
 * joins `document` and aggregates counts — far more than a name lookup needs.
 */
export async function getKnowledgeBaseNames(
  knowledgeBaseIds: readonly string[],
  workspaceId: string
): Promise<Map<string, string>> {
  if (knowledgeBaseIds.length === 0) return new Map()

  const rows = await db
    .select({ id: knowledgeBase.id, name: knowledgeBase.name })
    .from(knowledgeBase)
    .where(
      and(
        inArray(knowledgeBase.id, [...new Set(knowledgeBaseIds)]),
        eq(knowledgeBase.workspaceId, workspaceId),
        isNull(knowledgeBase.deletedAt)
      )
    )

  return new Map(rows.map((row) => [row.id, row.name]))
}

/**
 * Get a single knowledge base by ID
 */
export async function getKnowledgeBaseById(
  knowledgeBaseId: string
): Promise<KnowledgeBaseWithCounts | null> {
  const result = await readKnowledgeBaseRows(
    and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)),
    [],
    1
  )

  if (result.length === 0) {
    return null
  }

  return {
    ...result[0],
    chunkingConfig: result[0].chunkingConfig as ChunkingConfig,
    docCount: Number(result[0].docCount),
    connectorTypes: [],
    hasPermissionScopedConnector: false,
  }
}

/**
 * The knowledge base with its connector summary, for the surfaces that show
 * it. Kept off {@link getKnowledgeBaseById} so every operation that only
 * resolves its context does not pay for the connector read.
 */
export async function attachKnowledgeBaseConnectors(
  knowledgeBase: KnowledgeBaseWithCounts,
  access?: KnowledgeAccessScope
): Promise<KnowledgeBaseWithCounts> {
  let visible = knowledgeBase
  if (access) {
    const [counts] = await db
      .select({
        docCount: count(),
        tokenCount: sql<number>`COALESCE(SUM(${document.tokenCount}), 0)`.mapWith(Number),
      })
      .from(document)
      .where(
        and(
          eq(document.knowledgeBaseId, knowledgeBase.id),
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
          isNull(document.deletedAt),
          knowledgeAccessCondition(access)
        )
      )
    visible = { ...knowledgeBase, docCount: Number(counts.docCount), tokenCount: counts.tokenCount }
  }
  const [withConnectors] = await attachConnectorTypes([visible])
  return withConnectors
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
  options?: { archivedAt?: Date; assertedWorkspaceId?: string; allowSearchIndexDelete?: boolean }
): Promise<void> {
  const now = options?.archivedAt ?? new Date()

  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        id: knowledgeBase.id,
        workspaceId: knowledgeBase.workspaceId,
        organizationId: knowledgeBase.organizationId,
        isSearchIndex: knowledgeBase.isSearchIndex,
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
      .for('update')
    if (!locked) throw new KnowledgeBaseNotFoundError(knowledgeBaseId)
    if (locked.isSearchIndex && !options?.allowSearchIndexDelete) {
      throw new KnowledgeBasePermissionError('Only workspace admins can delete the search index')
    }

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
      organizationId: knowledgeBase.organizationId,
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
      if (getPostgresConstraintName(error) === 'kb_workspace_search_index_unique') {
        throw new OrchestrationError(
          'conflict',
          'This workspace already has an active search index'
        )
      }
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
