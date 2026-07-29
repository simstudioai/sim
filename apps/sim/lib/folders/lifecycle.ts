import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { folder as folderTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, min } from 'drizzle-orm'
import type { FolderCascadeCountsApi, FolderResourceType } from '@/lib/api/contracts/folders'
import {
  archiveFolderCascade,
  collectArchivedSubtreeIds,
  collectCascadeSubtreeIds,
  restoreFolderChildren,
  restoreFolderRows,
  toCascadeCounts,
} from '@/lib/folders/cascade'
import { folderResourceConfig } from '@/lib/folders/config'
import { deduplicateFolderName } from '@/lib/folders/naming'
import { wouldCreateFolderCycle } from '@/lib/folders/queries'
import type { FolderMutationErrorCode } from '@/lib/folders/status'
import type { OrchestrationErrorCode } from '@/lib/workflows/orchestration/types'

const logger = createLogger('FolderLifecycle')

const DUPLICATE_NAME_ERROR = 'A folder with this name already exists in this location'

export interface CreateFolderParams {
  resourceType: FolderResourceType
  userId: string
  workspaceId: string
  name: string
  id?: string
  parentId?: string | null
  sortOrder?: number
}

export interface FolderMutationResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  folder?: typeof folderTable.$inferSelect
}

export interface UpdateFolderParams {
  resourceType: FolderResourceType
  folderId: string
  workspaceId: string
  userId: string
  name?: string
  locked?: boolean
  parentId?: string | null
  sortOrder?: number
}

export interface DeleteFolderParams {
  resourceType: FolderResourceType
  folderId: string
  workspaceId: string
  userId: string
  folderName?: string
}

export interface DeleteFolderResult {
  success: boolean
  error?: string
  errorCode?: FolderMutationErrorCode
  deletedItems?: FolderCascadeCountsApi
}

export interface RestoreFolderParams {
  resourceType: FolderResourceType
  folderId: string
  workspaceId: string
  userId: string
  folderName?: string
}

export interface RestoreFolderResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  restoredItems?: FolderCascadeCountsApi
}

/**
 * Verifies that a prospective parent folder exists, belongs to the target workspace, is of
 * the same `resourceType`, and is not archived.
 *
 * The resourceType check is not defensive padding: the DB trigger
 * `folder_parent_resource_type_match` enforces the same invariant, so an app layer that
 * skipped it would surface a raw trigger error instead of a 400.
 */
async function assertParentFolderInWorkspace(
  resourceType: FolderResourceType,
  parentId: string,
  workspaceId: string
): Promise<{ error: string; errorCode: OrchestrationErrorCode } | null> {
  const [parent] = await db
    .select({
      workspaceId: folderTable.workspaceId,
      archivedAt: folderTable.deletedAt,
    })
    .from(folderTable)
    .where(and(eq(folderTable.id, parentId), eq(folderTable.resourceType, resourceType)))
    .limit(1)

  if (!parent || parent.workspaceId !== workspaceId || parent.archivedAt) {
    return { error: 'Parent folder not found', errorCode: 'validation' }
  }

  return null
}

/**
 * Places a new folder above its existing siblings. Workflows share one ordering space with
 * their folders, so their `sortOrder` participates; knowledge bases and tables have no
 * per-row ordering and are ignored via the absent `sortOrderColumn`.
 */
async function nextFolderSortOrder(
  resourceType: FolderResourceType,
  workspaceId: string,
  parentId: string | null | undefined
): Promise<number> {
  const config = folderResourceConfig(resourceType)
  const folderParentCondition = parentId
    ? eq(folderTable.parentId, parentId)
    : isNull(folderTable.parentId)

  const folderMinPromise = db
    .select({ minSortOrder: min(folderTable.sortOrder) })
    .from(folderTable)
    .where(
      and(
        eq(folderTable.workspaceId, workspaceId),
        eq(folderTable.resourceType, resourceType),
        folderParentCondition
      )
    )

  const childMinPromise: Promise<Array<{ minSortOrder: unknown }>> = config.sortOrderColumn
    ? db
        .select({ minSortOrder: min(config.sortOrderColumn) })
        .from(config.table)
        .where(
          and(
            eq(config.workspaceColumn, workspaceId),
            parentId ? eq(config.folderIdColumn, parentId) : isNull(config.folderIdColumn),
            config.scope
          )
        )
    : Promise.resolve([])

  const [[folderResult], [childResult]] = await Promise.all([folderMinPromise, childMinPromise])

  const candidates = [folderResult?.minSortOrder, childResult?.minSortOrder]
    .filter((value) => value != null)
    .map(Number)
    .filter((value) => Number.isFinite(value))

  return candidates.length > 0 ? Math.min(...candidates) - 1 : 0
}

export async function createFolder(params: CreateFolderParams): Promise<FolderMutationResult> {
  const config = folderResourceConfig(params.resourceType)

  try {
    const folderId = params.id || generateId()
    const parentId = params.parentId || null

    if (parentId) {
      if (parentId === folderId) {
        return { success: false, error: 'Folder cannot be its own parent', errorCode: 'validation' }
      }
      const parentError = await assertParentFolderInWorkspace(
        params.resourceType,
        parentId,
        params.workspaceId
      )
      if (parentError) return { success: false, ...parentError }
    }

    const sortOrder =
      params.sortOrder !== undefined
        ? params.sortOrder
        : await nextFolderSortOrder(params.resourceType, params.workspaceId, parentId)

    const [folder] = await db
      .insert(folderTable)
      .values({
        id: folderId,
        resourceType: params.resourceType,
        name: params.name.trim(),
        userId: params.userId,
        workspaceId: params.workspaceId,
        parentId,
        sortOrder,
      })
      .returning()

    logger.info('Created folder', {
      folderId,
      resourceType: params.resourceType,
      workspaceId: params.workspaceId,
      parentId,
    })

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      action: AuditAction.FOLDER_CREATED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: folderId,
      resourceName: folder.name,
      description: `Created ${config.label} folder "${folder.name}"`,
      metadata: {
        name: folder.name,
        workspaceId: params.workspaceId,
        folderResourceType: params.resourceType,
        parentId: parentId || undefined,
        sortOrder: folder.sortOrder,
      },
    })

    return { success: true, folder }
  } catch (error) {
    // The partial unique index on active (workspaceId, resourceType, parent, name) makes a
    // duplicate sibling name rejectable here. Create is a path where the user chooses the
    // name, so surface a 409 rather than silently deduplicating.
    if (getPostgresErrorCode(error) === '23505') {
      return { success: false, error: DUPLICATE_NAME_ERROR, errorCode: 'conflict' }
    }
    logger.error('Failed to create folder', { error, resourceType: params.resourceType })
    return { success: false, error: 'Internal server error', errorCode: 'internal' }
  }
}

export async function updateFolder(params: UpdateFolderParams): Promise<FolderMutationResult> {
  const config = folderResourceConfig(params.resourceType)

  try {
    if (params.parentId && params.parentId === params.folderId) {
      return { success: false, error: 'Folder cannot be its own parent', errorCode: 'validation' }
    }

    if (params.parentId) {
      const parentError = await assertParentFolderInWorkspace(
        params.resourceType,
        params.parentId,
        params.workspaceId
      )
      if (parentError) return { success: false, ...parentError }

      const wouldCreateCycle = await wouldCreateFolderCycle(
        params.folderId,
        params.parentId,
        params.resourceType
      )
      if (wouldCreateCycle) {
        return {
          success: false,
          error: 'Cannot create circular folder reference',
          errorCode: 'validation',
        }
      }
    }

    // Typed against the table rather than `Record<string, unknown>`: the loose type is what
    // let `color`/`isExpanded` survive an earlier cutover after the create path dropped them.
    const updates: Partial<typeof folderTable.$inferInsert> = { updatedAt: new Date() }
    if (params.name !== undefined) updates.name = params.name.trim()
    // Backstop for the route's rejection: the engine is also reachable from the copilot
    // tools, and a `locked` value on a type that has no lock semantics must never persist.
    if (params.locked !== undefined && config.supportsLocking) updates.locked = params.locked
    if (params.parentId !== undefined) updates.parentId = params.parentId || null
    if (params.sortOrder !== undefined) updates.sortOrder = params.sortOrder

    const [folder] = await db
      .update(folderTable)
      .set(updates)
      .where(
        and(
          eq(folderTable.id, params.folderId),
          eq(folderTable.workspaceId, params.workspaceId),
          eq(folderTable.resourceType, params.resourceType)
        )
      )
      .returning()

    if (!folder) {
      return { success: false, error: 'Folder not found', errorCode: 'not_found' }
    }

    logger.info('Updated folder', {
      folderId: params.folderId,
      resourceType: params.resourceType,
      updates,
    })

    return { success: true, folder }
  } catch (error) {
    if (getPostgresErrorCode(error) === '23505') {
      return { success: false, error: DUPLICATE_NAME_ERROR, errorCode: 'conflict' }
    }
    logger.error('Failed to update folder', { error, resourceType: params.resourceType })
    return { success: false, error: 'Internal server error', errorCode: 'internal' }
  }
}

/**
 * Soft-deletes a folder and everything under it. The subtree is resolved once, handed to
 * the resource's optional delete guard, then archived under one shared timestamp so
 * {@link restoreFolder} can bring back exactly this set and nothing else.
 *
 * Deleting an already-archived folder reuses that folder's existing `deletedAt` rather than
 * stamping a fresh one. A new timestamp here would be unrecoverable: the folder row keeps
 * its original stamp (the cascade only archives active folders), so anything archived under
 * the new stamp would never match on restore and would be stranded permanently.
 */
export async function deleteFolder(params: DeleteFolderParams): Promise<DeleteFolderResult> {
  const { resourceType, folderId, workspaceId, userId, folderName } = params
  const config = folderResourceConfig(resourceType)

  const [existing] = await db
    .select({ deletedAt: folderTable.deletedAt })
    .from(folderTable)
    .where(
      and(
        eq(folderTable.id, folderId),
        eq(folderTable.workspaceId, workspaceId),
        eq(folderTable.resourceType, resourceType)
      )
    )
    .limit(1)

  if (!existing) {
    return { success: false, error: 'Folder not found', errorCode: 'not_found' }
  }

  // Resolve the timestamp before the subtree, because the subtree walk needs it: on a retry
  // it is what distinguishes folders this cascade already stamped from folders archived
  // independently.
  const timestamp = existing.deletedAt ?? new Date()
  const folderIds = await collectCascadeSubtreeIds(
    db,
    workspaceId,
    resourceType,
    folderId,
    timestamp
  )

  const rejection = await config.guardDelete?.({ workspaceId, folderIds })
  if (rejection) {
    return { success: false, error: rejection.error, errorCode: rejection.errorCode }
  }

  const counts = await archiveFolderCascade(db, config, workspaceId, folderIds, timestamp)

  logger.info('Deleted folder and all contents', { folderId, resourceType, counts })

  recordAudit({
    workspaceId,
    actorId: userId,
    action: AuditAction.FOLDER_DELETED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: folderId,
    resourceName: folderName,
    description: `Deleted ${config.label} folder "${folderName || folderId}"`,
    metadata: {
      folderResourceType: resourceType,
      affected: {
        [config.countKey]: counts.children,
        subfolders: Math.max(counts.folders - 1, 0),
      },
    },
  })

  return { success: true, deletedItems: toCascadeCounts(config, counts) }
}

/**
 * Restores an archived folder together with everything archived alongside it.
 *
 * Two name hazards are handled before the cascade runs, both inside the transaction:
 * a folder whose parent is still archived is re-rooted, and the restored name is
 * deduplicated against the *resolved* parent's active siblings — the caller cannot rename
 * an archived folder, so a taken name would otherwise make it permanently unrestorable.
 */
export async function restoreFolder(params: RestoreFolderParams): Promise<RestoreFolderResult> {
  const { resourceType, folderId, workspaceId, userId, folderName } = params
  const config = folderResourceConfig(resourceType)

  const [folder] = await db
    .select()
    .from(folderTable)
    .where(
      and(
        eq(folderTable.id, folderId),
        eq(folderTable.workspaceId, workspaceId),
        eq(folderTable.resourceType, resourceType)
      )
    )

  if (!folder) {
    return { success: false, error: 'Folder not found', errorCode: 'not_found' }
  }

  const archivedAt = folder.deletedAt
  if (!archivedAt) {
    return { success: true, restoredItems: toCascadeCounts(config, { folders: 0, children: 0 }) }
  }

  const { getWorkspaceWithOwner } = await import('@/lib/workspaces/permissions/utils')
  const ws = await getWorkspaceWithOwner(workspaceId)
  if (!ws || ws.archivedAt) {
    return {
      success: false,
      error: 'Cannot restore folder into an archived workspace',
      errorCode: 'validation',
    }
  }

  const folderIds = await collectArchivedSubtreeIds(
    db,
    workspaceId,
    resourceType,
    folderId,
    archivedAt
  )

  // Resources with a `restoreChildren` hook come back BEFORE the folder rows. Those hooks
  // call canonical restores that open their own transactions, so they cannot run inside the
  // one below — and doing them first is what keeps a partial failure recoverable. Restoring
  // folders first would clear the root's `deletedAt`, so a later child failure would
  // short-circuit every retry on the `!archivedAt` early return above, stranding whatever
  // had not come back yet. In this order a failure leaves the folder archived and the whole
  // restore simply retryable; children already restored no longer match the timestamp and
  // are skipped.
  const hookChildren = config.restoreChildren
    ? await config.restoreChildren({ workspaceId, folderIds, timestamp: archivedAt })
    : null

  let counts: { folders: number; children: number }
  try {
    counts = await db.transaction(async (tx) => {
      const now = new Date()

      let resolvedParentId = folder.parentId
      if (folder.parentId) {
        const [parentFolder] = await tx
          .select({ archivedAt: folderTable.deletedAt })
          .from(folderTable)
          .where(
            and(eq(folderTable.id, folder.parentId), eq(folderTable.resourceType, resourceType))
          )

        if (!parentFolder || parentFolder.archivedAt) {
          resolvedParentId = null
          await tx
            .update(folderTable)
            .set({ parentId: null })
            .where(and(eq(folderTable.id, folderId), eq(folderTable.resourceType, resourceType)))
        }
      }

      // Safe to rename while the row is still archived: the unique index only covers active
      // rows, so this cannot collide before the cascade below clears `deletedAt`. Only the
      // restore root can conflict — descendants come back alongside the siblings they were
      // archived with.
      const restoredName = await deduplicateFolderName(
        tx,
        workspaceId,
        resolvedParentId,
        folder.name,
        resourceType
      )
      if (restoredName !== folder.name) {
        logger.info('Renamed folder on restore to avoid a sibling name conflict', {
          folderId,
          resourceType,
          from: folder.name,
          to: restoredName,
        })
        await tx.update(folderTable).set({ name: restoredName }).where(eq(folderTable.id, folderId))
      }

      const folders = await restoreFolderRows(tx, config, workspaceId, folderIds, archivedAt, now)

      const children =
        hookChildren ??
        (await restoreFolderChildren(tx, config, workspaceId, folderIds, archivedAt, now))

      return { folders, children }
    })
  } catch (error) {
    // Clearing `deletedAt` brings the row back under the partial unique index on active
    // (workspaceId, resourceType, parent, name). Dedup above covers the restore root, but a
    // concurrent create can still take the name between the check and the write.
    if (getPostgresErrorCode(error) === '23505') {
      return { success: false, error: DUPLICATE_NAME_ERROR, errorCode: 'conflict' }
    }
    throw error
  }

  logger.info('Restored folder and all contents', { folderId, resourceType, counts })

  recordAudit({
    workspaceId,
    actorId: userId,
    action: AuditAction.FOLDER_RESTORED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: folderId,
    resourceName: folderName ?? folder.name,
    description: `Restored ${config.label} folder "${folderName ?? folder.name}"`,
    metadata: {
      folderResourceType: resourceType,
      affected: {
        [config.countKey]: counts.children,
        subfolders: Math.max(counts.folders - 1, 0),
      },
    },
  })

  return { success: true, restoredItems: toCascadeCounts(config, counts) }
}
