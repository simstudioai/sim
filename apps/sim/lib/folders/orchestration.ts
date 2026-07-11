import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { folder as folderTable, knowledgeBase, userTableDefinitions } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { assertFolderMutable, ResourceLockedError } from '@sim/platform-authz/resource-lock'
import { getPostgresErrorCode, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { FolderResourceType } from '@/lib/api/contracts/folders'
import type { DbOrTx } from '@/lib/db/types'
import {
  assertFolderParentValid,
  checkFolderCircularReference,
} from '@/lib/folders/parent-validation'
import { collectDescendantFolderIds } from '@/lib/folders/subtree'
import {
  archiveWorkspaceFileFolderRecursive,
  createWorkspaceFileFolder,
  restoreWorkspaceFileFolder,
  updateWorkspaceFileFolder,
  WorkspaceFileFolderConflictError,
  type WorkspaceFileFolderRecord,
} from '@/lib/uploads/contexts/workspace'
import {
  performCreateFolder as performCreateWorkflowFolder,
  performDeleteFolder as performDeleteWorkflowFolder,
  performRestoreFolder as performRestoreWorkflowFolder,
  performUpdateFolder as performUpdateWorkflowFolder,
} from '@/lib/workflows/orchestration/folder-lifecycle'
import type { OrchestrationErrorCode } from '@/lib/workflows/orchestration/types'

const logger = createLogger('FolderOrchestration')

export type Folder = typeof folderTable.$inferSelect

export interface PerformCreateFolderParams {
  resourceType: FolderResourceType
  userId: string
  workspaceId: string
  name: string
  id?: string
  parentId?: string | null
  sortOrder?: number
}

export interface PerformFolderResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  folder?: Folder
}

export interface PerformUpdateFolderParams {
  resourceType: FolderResourceType
  folderId: string
  workspaceId: string
  userId: string
  name?: string
  locked?: boolean
  parentId?: string | null
  sortOrder?: number
}

export interface PerformDeleteFolderParams {
  resourceType: FolderResourceType
  folderId: string
  workspaceId: string
  userId: string
  folderName?: string
}

export interface PerformDeleteFolderResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  deletedItems?: {
    folders: number
    workflows?: number
    files?: number
    knowledgeBases?: number
    tables?: number
  }
}

export interface PerformRestoreFolderParams {
  resourceType: FolderResourceType
  folderId: string
  workspaceId: string
  userId: string
  folderName?: string
}

export interface PerformRestoreFolderResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  restoredItems?: {
    folders: number
    workflows?: number
    files?: number
    knowledgeBases?: number
    tables?: number
  }
}

export interface PerformReorderFoldersParams {
  resourceType: FolderResourceType
  workspaceId: string
  updates: Array<{ id: string; sortOrder: number; parentId?: string | null }>
}

/**
 * Adapts the `uploads/contexts/workspace` VFS record (which carries a
 * server-computed `path` the generic contract doesn't expose) to the
 * physical `folder` table shape the generic routes/contracts expect.
 * `locked` is reserved-but-unused for `file` folders (see
 * `packages/db/schema.ts`), so we mirror the table's own default here
 * rather than round-tripping to re-select it.
 */
function toFileFolder(record: WorkspaceFileFolderRecord): Folder {
  return {
    id: record.id,
    resourceType: 'file',
    name: record.name,
    userId: record.userId,
    workspaceId: record.workspaceId,
    parentId: record.parentId,
    locked: record.locked,
    sortOrder: record.sortOrder,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt,
  }
}

/**
 * `file`-resourceType folder CRUD delegates to `uploads/contexts/workspace`
 * (`createWorkspaceFileFolder`/`updateWorkspaceFileFolder`/
 * `archiveWorkspaceFileFolderRecursive`/`restoreWorkspaceFileFolder`) — the
 * single source of truth for file-folder writes (advisory locking, name
 * conflict detection, recursive archive/restore) — rather than
 * reimplementing that logic against the raw `folder` table here.
 */
async function performCreateFileFolder(
  params: PerformCreateFolderParams
): Promise<PerformFolderResult> {
  const parentId = params.parentId || null
  const folderId = params.id || generateId()
  if (parentId === folderId) {
    return { success: false, error: 'Folder cannot be its own parent', errorCode: 'validation' }
  }
  const parentError = await assertFolderParentValid(parentId, {
    workspaceId: params.workspaceId,
    resourceType: 'file',
  })
  if (parentError) return { success: false, ...parentError }

  try {
    const created = await createWorkspaceFileFolder({
      id: folderId,
      workspaceId: params.workspaceId,
      userId: params.userId,
      name: params.name,
      parentId,
      sortOrder: params.sortOrder,
    })

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      action: AuditAction.FOLDER_CREATED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: created.id,
      resourceName: created.name,
      description: `Created file folder "${created.name}"`,
    })

    return { success: true, folder: toFileFolder(created) }
  } catch (error) {
    if (
      error instanceof WorkspaceFileFolderConflictError ||
      getPostgresErrorCode(error) === '23505'
    ) {
      return { success: false, error: toError(error).message, errorCode: 'conflict' }
    }
    logger.error('Failed to create file folder', { error })
    return { success: false, error: 'Internal server error', errorCode: 'internal' }
  }
}

async function performUpdateFileFolder(
  params: PerformUpdateFolderParams
): Promise<PerformFolderResult> {
  if (params.parentId && params.parentId === params.folderId) {
    return { success: false, error: 'Folder cannot be its own parent', errorCode: 'validation' }
  }
  if (params.parentId) {
    const parentError = await assertFolderParentValid(params.parentId, {
      workspaceId: params.workspaceId,
      resourceType: 'file',
    })
    if (parentError) return { success: false, ...parentError }
  }

  try {
    const updated = await updateWorkspaceFileFolder({
      workspaceId: params.workspaceId,
      folderId: params.folderId,
      name: params.name,
      parentId: params.parentId,
      sortOrder: params.sortOrder,
      locked: params.locked,
    })

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      action: AuditAction.FOLDER_UPDATED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: params.folderId,
      resourceName: updated.name,
      description: `Updated file folder "${updated.name}"`,
    })

    return { success: true, folder: toFileFolder(updated) }
  } catch (error) {
    if (
      error instanceof WorkspaceFileFolderConflictError ||
      getPostgresErrorCode(error) === '23505'
    ) {
      return { success: false, error: toError(error).message, errorCode: 'conflict' }
    }
    if (toError(error).message === 'Folder not found') {
      return { success: false, error: 'Folder not found', errorCode: 'not_found' }
    }
    logger.error('Failed to update file folder', { error })
    return { success: false, error: 'Internal server error', errorCode: 'internal' }
  }
}

async function performDeleteFileFolder(
  params: PerformDeleteFolderParams
): Promise<PerformDeleteFolderResult> {
  const { folderId, workspaceId, userId, folderName } = params

  try {
    const deletedItems = await archiveWorkspaceFileFolderRecursive(workspaceId, folderId)

    logger.info('Deleted file folder and contents', { folderId, ...deletedItems })

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.FOLDER_DELETED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: folderId,
      resourceName: folderName,
      description: `Deleted file folder "${folderName || folderId}"`,
      metadata: {
        affected: { files: deletedItems.files, subfolders: deletedItems.folders - 1 },
      },
    })

    return { success: true, deletedItems }
  } catch (error) {
    if (toError(error).message === 'Folder not found') {
      return { success: false, error: 'Folder not found', errorCode: 'not_found' }
    }
    logger.error('Failed to delete file folder', { error })
    return { success: false, error: 'Internal server error', errorCode: 'internal' }
  }
}

async function performRestoreFileFolder(
  params: PerformRestoreFolderParams
): Promise<PerformRestoreFolderResult> {
  const { folderId, workspaceId, userId, folderName } = params

  try {
    const { folder, restoredItems } = await restoreWorkspaceFileFolder(workspaceId, folderId)

    logger.info('Restored file folder and contents', { folderId, restoredItems })

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.FOLDER_RESTORED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: folderId,
      resourceName: folderName ?? folder.name,
      description: `Restored file folder "${folderName ?? folder.name}"`,
      metadata: {
        affected: {
          files: restoredItems.files,
          subfolders: Math.max(0, restoredItems.folders - 1),
        },
      },
    })

    return { success: true, restoredItems }
  } catch (error) {
    // Propagate uncaught -- matches performRestoreWorkflowFolder/performRestoreResourceFolder,
    // which never catch it, so the route's ResourceLockedError -> 423 handling applies uniformly.
    if (error instanceof ResourceLockedError) {
      throw error
    }
    if (
      error instanceof WorkspaceFileFolderConflictError ||
      getPostgresErrorCode(error) === '23505'
    ) {
      return {
        success: false,
        error: 'A folder with this name already exists in this location',
        errorCode: 'conflict',
      }
    }
    const message = toError(error).message
    if (message === 'Folder not found') {
      return { success: false, error: message, errorCode: 'not_found' }
    }
    if (message === 'Folder is not archived') {
      return { success: false, error: message, errorCode: 'validation' }
    }
    logger.error('Failed to restore file folder', { error })
    return { success: false, error: 'Internal server error', errorCode: 'internal' }
  }
}

/**
 * Walks `parentId` chains within a single resourceType to collect a folder's
 * full subtree (itself + all descendants), scoped to currently-active
 * (non-deleted) folders. Delegates the pure walk to the shared
 * `collectDescendantFolderIds` helper also used by the file-folder cascade in
 * `uploads/contexts/workspace/workspace-file-folder-manager.ts`.
 */
async function collectFolderSubtreeIds(
  workspaceId: string,
  resourceType: FolderResourceType,
  folderId: string,
  dbClient: DbOrTx = db
): Promise<string[]> {
  const activeFolders = await dbClient
    .select({ id: folderTable.id, parentId: folderTable.parentId })
    .from(folderTable)
    .where(
      and(
        eq(folderTable.workspaceId, workspaceId),
        eq(folderTable.resourceType, resourceType),
        isNull(folderTable.deletedAt)
      )
    )

  return [folderId, ...collectDescendantFolderIds(activeFolders, folderId)]
}

/**
 * `knowledge_base` and `table` folder cascades are identical except for the
 * target table and its soft-delete column (`knowledgeBase.deletedAt` vs
 * `userTableDefinitions.archivedAt`). This config captures that one delta so
 * {@link performDeleteResourceFolder}/{@link performRestoreResourceFolder}
 * implement the cascade logic exactly once.
 */
interface FolderCascadeConfig<TCountKey extends 'knowledgeBases' | 'tables'> {
  resourceType: 'knowledge_base' | 'table'
  countKey: TCountKey
  /** Soft-deletes every contained resource row whose folderId is in `folderIds`. */
  archiveChildren: (
    tx: DbOrTx,
    folderIds: string[],
    workspaceId: string,
    now: Date
  ) => Promise<{ id: string }[]>
  /** Restores contained resource rows directly under `folderId` whose soft-delete timestamp matches. */
  restoreChildren: (
    tx: DbOrTx,
    folderId: string,
    workspaceId: string,
    matchTimestamp: Date
  ) => Promise<{ id: string }[]>
}

const KNOWLEDGE_BASE_FOLDER_CASCADE: FolderCascadeConfig<'knowledgeBases'> = {
  resourceType: 'knowledge_base',
  countKey: 'knowledgeBases',
  archiveChildren: (tx, folderIds, workspaceId, now) =>
    tx
      .update(knowledgeBase)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          inArray(knowledgeBase.folderId, folderIds),
          eq(knowledgeBase.workspaceId, workspaceId),
          isNull(knowledgeBase.deletedAt)
        )
      )
      .returning({ id: knowledgeBase.id }),
  restoreChildren: (tx, folderId, workspaceId, matchTimestamp) =>
    tx
      .update(knowledgeBase)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(knowledgeBase.folderId, folderId),
          eq(knowledgeBase.workspaceId, workspaceId),
          eq(knowledgeBase.deletedAt, matchTimestamp)
        )
      )
      .returning({ id: knowledgeBase.id }),
}

const TABLE_FOLDER_CASCADE: FolderCascadeConfig<'tables'> = {
  resourceType: 'table',
  countKey: 'tables',
  archiveChildren: (tx, folderIds, workspaceId, now) =>
    tx
      .update(userTableDefinitions)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          inArray(userTableDefinitions.folderId, folderIds),
          eq(userTableDefinitions.workspaceId, workspaceId),
          isNull(userTableDefinitions.archivedAt)
        )
      )
      .returning({ id: userTableDefinitions.id }),
  restoreChildren: (tx, folderId, workspaceId, matchTimestamp) =>
    tx
      .update(userTableDefinitions)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(userTableDefinitions.folderId, folderId),
          eq(userTableDefinitions.workspaceId, workspaceId),
          eq(userTableDefinitions.archivedAt, matchTimestamp)
        )
      )
      .returning({ id: userTableDefinitions.id }),
}

function cascadeResourceLabel(resourceType: 'knowledge_base' | 'table'): string {
  return resourceType === 'table' ? 'table' : 'knowledge base'
}

/**
 * Deletes a `knowledge_base`/`table` folder and cascades to its subtree and
 * contained resources, all inside a single transaction so a crash mid-cascade
 * can't leave folders archived without their contents (or vice versa).
 */
async function performDeleteResourceFolder<TCountKey extends 'knowledgeBases' | 'tables'>(
  params: PerformDeleteFolderParams,
  cascade: FolderCascadeConfig<TCountKey>
): Promise<PerformDeleteFolderResult> {
  const { folderId, workspaceId, userId, folderName } = params
  const now = new Date()

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: folderTable.id })
      .from(folderTable)
      .where(
        and(
          eq(folderTable.id, folderId),
          eq(folderTable.workspaceId, workspaceId),
          eq(folderTable.resourceType, cascade.resourceType),
          isNull(folderTable.deletedAt)
        )
      )
      .limit(1)
    if (!existing) return null

    const folderIds = await collectFolderSubtreeIds(workspaceId, cascade.resourceType, folderId, tx)

    const archivedFolders = await tx
      .update(folderTable)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          inArray(folderTable.id, folderIds),
          eq(folderTable.workspaceId, workspaceId),
          eq(folderTable.resourceType, cascade.resourceType),
          isNull(folderTable.deletedAt)
        )
      )
      .returning({ id: folderTable.id })

    const archivedChildren = await cascade.archiveChildren(tx, folderIds, workspaceId, now)

    return { folders: archivedFolders.length, children: archivedChildren.length }
  })

  if (!result) return { success: false, error: 'Folder not found', errorCode: 'not_found' }

  logger.info(`Deleted ${cascade.resourceType} folder and contents`, {
    folderId,
    folders: result.folders,
    [cascade.countKey]: result.children,
  })

  recordAudit({
    workspaceId,
    actorId: userId,
    action: AuditAction.FOLDER_DELETED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: folderId,
    resourceName: folderName,
    description: `Deleted ${cascadeResourceLabel(cascade.resourceType)} folder "${folderName || folderId}"`,
    metadata: {
      affected: { [cascade.countKey]: result.children, subfolders: result.folders - 1 },
    },
  })

  const deletedItems: NonNullable<PerformDeleteFolderResult['deletedItems']> =
    cascade.countKey === 'knowledgeBases'
      ? { folders: result.folders, knowledgeBases: result.children }
      : { folders: result.folders, tables: result.children }

  return { success: true, deletedItems }
}

/**
 * Restores a soft-deleted `knowledge_base`/`table` folder and its subtree,
 * only resurrecting folders/resources archived at the same instant (matched
 * by timestamp) as the folder itself. All writes run in a single transaction.
 */
async function performRestoreResourceFolder<TCountKey extends 'knowledgeBases' | 'tables'>(
  params: PerformRestoreFolderParams,
  cascade: FolderCascadeConfig<TCountKey>
): Promise<PerformRestoreFolderResult> {
  const { folderId, workspaceId, userId, folderName } = params

  const outcome = await db.transaction(async (tx) => {
    const [raw] = await tx
      .select()
      .from(folderTable)
      .where(
        and(
          eq(folderTable.id, folderId),
          eq(folderTable.workspaceId, workspaceId),
          eq(folderTable.resourceType, cascade.resourceType)
        )
      )
      .limit(1)
    if (!raw) return { kind: 'not_found' as const }
    if (!raw.deletedAt) return { kind: 'not_archived' as const }

    // The folder row is soft-deleted, so the generic lock engine (which only reads
    // active rows) can't see it -- check its own `locked` flag directly.
    if (raw.locked) {
      throw new ResourceLockedError(cascade.resourceType, false, 'Folder is locked')
    }

    const folderDeletedAt = raw.deletedAt

    // Only restore the same subtree that was archived together (matched by
    // deletedAt timestamp) — sibling folders/resources soft-deleted
    // independently before or after this folder's delete must not resurrect.
    const stats = { folders: 0, children: 0 }
    const seen = new Set<string>()
    const restoreSubtree = async (currentFolderId: string): Promise<void> => {
      if (seen.has(currentFolderId)) return
      seen.add(currentFolderId)

      const restoredChildren = await cascade.restoreChildren(
        tx,
        currentFolderId,
        workspaceId,
        folderDeletedAt
      )
      stats.children += restoredChildren.length

      const archivedChildFolders = await tx
        .select({ id: folderTable.id })
        .from(folderTable)
        .where(
          and(
            eq(folderTable.parentId, currentFolderId),
            eq(folderTable.workspaceId, workspaceId),
            eq(folderTable.resourceType, cascade.resourceType),
            eq(folderTable.deletedAt, folderDeletedAt)
          )
        )
      for (const child of archivedChildFolders) {
        const [restoredChild] = await tx
          .update(folderTable)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(and(eq(folderTable.id, child.id), eq(folderTable.deletedAt, folderDeletedAt)))
          .returning({ id: folderTable.id })
        if (!restoredChild) continue
        stats.folders += 1
        await restoreSubtree(child.id)
      }
    }

    // If the parent folder is still archived, restore to root rather than
    // leaving the folder orphaned under an archived parent.
    let resolvedParentId = raw.parentId
    if (resolvedParentId) {
      const [parent] = await tx
        .select({ deletedAt: folderTable.deletedAt })
        .from(folderTable)
        .where(eq(folderTable.id, resolvedParentId))
        .limit(1)
      if (!parent || parent.deletedAt) resolvedParentId = null
    }

    // resolvedParentId is either null (root, always safe) or a confirmed-active
    // folder -- without this, the folder could resurface under a folder that was
    // locked after this one was deleted. Passing `tx` (not the default db client)
    // keeps this read inside the same transaction as the write below, closing the
    // TOCTOU window where a concurrent request locks resolvedParentId in between.
    await assertFolderMutable(resolvedParentId, cascade.resourceType, tx)

    await tx
      .update(folderTable)
      .set({ deletedAt: null, parentId: resolvedParentId, updatedAt: new Date() })
      .where(eq(folderTable.id, folderId))
    stats.folders += 1
    await restoreSubtree(folderId)

    return { kind: 'ok' as const, stats, name: raw.name }
  })

  if (outcome.kind === 'not_found') {
    return { success: false, error: 'Folder not found', errorCode: 'not_found' }
  }
  if (outcome.kind === 'not_archived') {
    return { success: false, error: 'Folder is not archived', errorCode: 'validation' }
  }

  const { stats, name } = outcome

  logger.info(`Restored ${cascade.resourceType} folder and contents`, { folderId, ...stats })

  recordAudit({
    workspaceId,
    actorId: userId,
    action: AuditAction.FOLDER_RESTORED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: folderId,
    resourceName: folderName ?? name,
    description: `Restored ${cascadeResourceLabel(cascade.resourceType)} folder "${folderName ?? name}"`,
    metadata: {
      affected: {
        [cascade.countKey]: stats.children,
        subfolders: Math.max(0, stats.folders - 1),
      },
    },
  })

  const restoredItems: NonNullable<PerformRestoreFolderResult['restoredItems']> =
    cascade.countKey === 'knowledgeBases'
      ? { folders: stats.folders, knowledgeBases: stats.children }
      : { folders: stats.folders, tables: stats.children }

  return { success: true, restoredItems }
}

export async function performCreateFolder(
  params: PerformCreateFolderParams
): Promise<PerformFolderResult> {
  if (params.resourceType === 'workflow') {
    return performCreateWorkflowFolder(params)
  }
  if (params.resourceType === 'file') {
    return performCreateFileFolder(params)
  }
  // knowledge_base / table: plain create, no cascade concerns yet.
  const folderId = params.id || generateId()
  const parentId = params.parentId || null
  if (parentId === folderId) {
    return { success: false, error: 'Folder cannot be its own parent', errorCode: 'validation' }
  }
  const parentError = await assertFolderParentValid(parentId, {
    workspaceId: params.workspaceId,
    resourceType: params.resourceType,
  })
  if (parentError) return { success: false, ...parentError }

  const [created] = await db
    .insert(folderTable)
    .values({
      id: folderId,
      resourceType: params.resourceType,
      name: params.name.trim(),
      userId: params.userId,
      workspaceId: params.workspaceId,
      parentId,
      sortOrder: params.sortOrder ?? 0,
    })
    .returning()

  return { success: true, folder: created }
}

export async function performUpdateFolder(
  params: PerformUpdateFolderParams
): Promise<PerformFolderResult> {
  if (params.resourceType === 'workflow') {
    return performUpdateWorkflowFolder(params)
  }
  if (params.resourceType === 'file') {
    return performUpdateFileFolder(params)
  }

  if (params.parentId && params.parentId === params.folderId) {
    return { success: false, error: 'Folder cannot be its own parent', errorCode: 'validation' }
  }
  if (params.parentId) {
    const parentError = await assertFolderParentValid(params.parentId, {
      workspaceId: params.workspaceId,
      resourceType: params.resourceType,
    })
    if (parentError) return { success: false, ...parentError }

    const wouldCreateCycle = await checkFolderCircularReference(params.folderId, params.parentId)
    if (wouldCreateCycle) {
      return {
        success: false,
        error: 'Cannot create circular folder reference',
        errorCode: 'validation',
      }
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (params.name !== undefined) updates.name = params.name.trim()
  if (params.parentId !== undefined) updates.parentId = params.parentId || null
  if (params.sortOrder !== undefined) updates.sortOrder = params.sortOrder
  if (params.locked !== undefined) updates.locked = params.locked

  const [updated] = await db
    .update(folderTable)
    .set(updates)
    .where(
      and(
        eq(folderTable.id, params.folderId),
        eq(folderTable.workspaceId, params.workspaceId),
        eq(folderTable.resourceType, params.resourceType),
        isNull(folderTable.deletedAt)
      )
    )
    .returning()

  if (!updated) return { success: false, error: 'Folder not found', errorCode: 'not_found' }
  return { success: true, folder: updated }
}

export async function performDeleteFolder(
  params: PerformDeleteFolderParams
): Promise<PerformDeleteFolderResult> {
  if (params.resourceType === 'workflow') {
    const result = await performDeleteWorkflowFolder(params)
    return {
      ...result,
      deletedItems: result.deletedItems
        ? { folders: result.deletedItems.folders, workflows: result.deletedItems.workflows }
        : undefined,
    }
  }
  if (params.resourceType === 'file') {
    return performDeleteFileFolder(params)
  }
  if (params.resourceType === 'knowledge_base') {
    return performDeleteResourceFolder(params, KNOWLEDGE_BASE_FOLDER_CASCADE)
  }
  return performDeleteResourceFolder(params, TABLE_FOLDER_CASCADE)
}

export async function performRestoreFolder(
  params: PerformRestoreFolderParams
): Promise<PerformRestoreFolderResult> {
  if (params.resourceType === 'workflow') {
    return performRestoreWorkflowFolder(params)
  }
  if (params.resourceType === 'file') {
    return performRestoreFileFolder(params)
  }
  if (params.resourceType === 'knowledge_base') {
    return performRestoreResourceFolder(params, KNOWLEDGE_BASE_FOLDER_CASCADE)
  }
  return performRestoreResourceFolder(params, TABLE_FOLDER_CASCADE)
}

/** Marks a concurrent-deletion race caught inside the reorder transaction as a 404, not a 500. */
class FolderReorderNotFoundError extends Error {}

export async function performReorderFolders(params: PerformReorderFoldersParams): Promise<{
  success: boolean
  updated: number
  error?: string
  errorCode?: OrchestrationErrorCode
}> {
  const { resourceType, workspaceId, updates } = params

  const folderIds = updates.map((u) => u.id)
  const existingFolders = await db
    .select({ id: folderTable.id, workspaceId: folderTable.workspaceId })
    .from(folderTable)
    .where(
      and(
        inArray(folderTable.id, folderIds),
        eq(folderTable.resourceType, resourceType),
        isNull(folderTable.deletedAt)
      )
    )

  const validIds = new Set(
    existingFolders.filter((f) => f.workspaceId === workspaceId).map((f) => f.id)
  )
  // Any id that doesn't resolve to an existing, active, same-workspace folder (wrong
  // workspace, wrong resourceType, or soft-deleted) fails the whole batch up front --
  // matching the parentId check below -- rather than silently reordering a subset and
  // reporting success with a smaller `updated` count.
  const invalidId = updates.find((u) => !validIds.has(u.id))
  if (invalidId) {
    return {
      success: false,
      updated: 0,
      error: 'One or more folders were not found',
      errorCode: 'not_found',
    }
  }
  const validUpdates = updates

  // Reparents also need `assertFolderParentValid` on the new parent (the
  // `validIds` check above only validates `id`). Any invalid parentId fails
  // the whole batch up front rather than silently skipping that entry.
  // Distinct target parentIds are validated concurrently since a subtree
  // drag-drop can reparent many folders in one call.
  const targetParentIds = Array.from(
    new Set(validUpdates.map((u) => u.parentId).filter((id): id is string => Boolean(id)))
  )
  const parentErrors = await Promise.all(
    targetParentIds.map((parentId) =>
      assertFolderParentValid(parentId, { workspaceId, resourceType })
    )
  )
  const firstParentError = parentErrors.find((error) => error !== null)
  if (firstParentError) {
    return {
      success: false,
      updated: 0,
      error: firstParentError.error,
      errorCode: firstParentError.errorCode,
    }
  }

  try {
    await db.transaction(async (tx) => {
      // Re-check each target parent is still active inside the transaction --
      // assertFolderParentValid above only reads at validation time, so a parent
      // concurrently soft-deleted before this transaction opens could otherwise
      // leave an active folder pointing at a deleted one.
      if (targetParentIds.length > 0) {
        const activeParents = await tx
          .select({ id: folderTable.id })
          .from(folderTable)
          .where(and(inArray(folderTable.id, targetParentIds), isNull(folderTable.deletedAt)))
        if (activeParents.length !== targetParentIds.length) {
          throw new FolderReorderNotFoundError('Parent folder not found')
        }
      }

      // The route checks lock state before calling this function, but that's a
      // separate round-trip -- an admin could lock a source folder or a target
      // parent in the window between that check and this transaction. Re-check
      // both inside the transaction (joining `tx` so the read is part of the
      // same atomic unit as the writes below) before applying anything.
      for (const update of validUpdates) {
        await assertFolderMutable(update.id, resourceType, tx)
      }
      for (const parentId of targetParentIds) {
        await assertFolderMutable(parentId, resourceType, tx)
      }

      for (const update of validUpdates) {
        const updateData: Record<string, unknown> = {
          sortOrder: update.sortOrder,
          updatedAt: new Date(),
        }
        if (update.parentId !== undefined) updateData.parentId = update.parentId || null

        // Re-check deletedAt at write time (not just the validation read above) --
        // without this, a folder concurrently soft-deleted between validation and
        // this transaction could still have its sortOrder/parentId mutated. Throwing
        // rolls back the whole transaction rather than silently applying a partial
        // batch, matching this function's fail-whole-batch behavior on other errors.
        const [updated] = await tx
          .update(folderTable)
          .set(updateData)
          .where(and(eq(folderTable.id, update.id), isNull(folderTable.deletedAt)))
          .returning({ id: folderTable.id })
        if (!updated) {
          throw new FolderReorderNotFoundError('One or more folders were not found')
        }
      }
    })
  } catch (error) {
    // Propagate uncaught so the route's ResourceLockedError -> 423 handling applies.
    if (error instanceof ResourceLockedError) {
      throw error
    }
    if (error instanceof FolderReorderNotFoundError) {
      return { success: false, updated: 0, error: error.message, errorCode: 'not_found' }
    }
    // An unexpected DB/transaction failure, not a client-caused validation error --
    // log the real cause but don't leak internal error details to the response.
    logger.error('Unexpected error reordering folders', { error })
    return {
      success: false,
      updated: 0,
      error: 'Failed to reorder folders',
      errorCode: 'internal',
    }
  }

  return { success: true, updated: validUpdates.length }
}
