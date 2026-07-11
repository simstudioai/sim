import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { chat, folder, webhook, workflow, workflowMcpTool, workflowSchedule } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { assertFolderMutable, ResourceLockedError } from '@sim/platform-authz/resource-lock'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, min } from 'drizzle-orm'
import {
  assertFolderParentValid,
  checkFolderCircularReference,
} from '@/lib/folders/parent-validation'
import { archiveWorkflowsByIdsInWorkspace } from '@/lib/workflows/lifecycle'
import type { OrchestrationErrorCode } from '@/lib/workflows/orchestration/types'

const logger = createLogger('FolderLifecycle')

/** All queries against `folder` in this module are scoped to workflow folders. */
const isWorkflowFolder = eq(folder.resourceType, 'workflow')

export interface PerformCreateFolderParams {
  userId: string
  workspaceId: string
  name: string
  id?: string
  parentId?: string | null
  color?: string
  sortOrder?: number
}

export interface PerformCreateFolderResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  folder?: typeof folder.$inferSelect
}

export interface PerformUpdateFolderParams {
  folderId: string
  workspaceId: string
  userId: string
  name?: string
  locked?: boolean
  parentId?: string | null
  sortOrder?: number
}

export interface PerformUpdateFolderResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  folder?: typeof folder.$inferSelect
}

async function nextFolderSortOrder(
  workspaceId: string,
  parentId: string | null | undefined
): Promise<number> {
  const folderParentCondition = parentId ? eq(folder.parentId, parentId) : isNull(folder.parentId)
  const workflowParentCondition = parentId
    ? eq(workflow.folderId, parentId)
    : isNull(workflow.folderId)

  const [[folderResult], [workflowResult]] = await Promise.all([
    db
      .select({ minSortOrder: min(folder.sortOrder) })
      .from(folder)
      .where(and(eq(folder.workspaceId, workspaceId), isWorkflowFolder, folderParentCondition)),
    db
      .select({ minSortOrder: min(workflow.sortOrder) })
      .from(workflow)
      .where(and(eq(workflow.workspaceId, workspaceId), workflowParentCondition)),
  ])

  const minSortOrder = [folderResult?.minSortOrder, workflowResult?.minSortOrder].reduce<
    number | null
  >((currentMin, candidate) => {
    if (candidate == null) return currentMin
    if (currentMin == null) return candidate
    return Math.min(currentMin, candidate)
  }, null)

  return minSortOrder != null ? minSortOrder - 1 : 0
}

export async function performCreateFolder(
  params: PerformCreateFolderParams
): Promise<PerformCreateFolderResult> {
  try {
    const folderId = params.id || generateId()
    const parentId = params.parentId || null

    if (parentId) {
      if (parentId === folderId) {
        return {
          success: false,
          error: 'Folder cannot be its own parent',
          errorCode: 'validation',
        }
      }
      const parentError = await assertFolderParentValid(parentId, {
        workspaceId: params.workspaceId,
        resourceType: 'workflow',
      })
      if (parentError) return { success: false, ...parentError }
    }

    const sortOrder =
      params.sortOrder !== undefined
        ? params.sortOrder
        : await nextFolderSortOrder(params.workspaceId, parentId)

    const [createdFolder] = await db
      .insert(folder)
      .values({
        id: folderId,
        resourceType: 'workflow',
        name: params.name.trim(),
        userId: params.userId,
        workspaceId: params.workspaceId,
        parentId,
        sortOrder,
      })
      .returning()

    logger.info('Created workflow folder', { folderId, workspaceId: params.workspaceId, parentId })

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      action: AuditAction.FOLDER_CREATED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: folderId,
      resourceName: createdFolder.name,
      description: `Created folder "${createdFolder.name}"`,
      metadata: {
        name: createdFolder.name,
        workspaceId: params.workspaceId,
        parentId: parentId || undefined,
        sortOrder: createdFolder.sortOrder,
      },
    })

    return { success: true, folder: createdFolder }
  } catch (error) {
    if (getPostgresErrorCode(error) === '23505') {
      return {
        success: false,
        error: 'A folder with this name already exists in this location',
        errorCode: 'conflict',
      }
    }
    logger.error('Failed to create workflow folder', { error })
    return { success: false, error: 'Internal server error', errorCode: 'internal' }
  }
}

export async function performUpdateFolder(
  params: PerformUpdateFolderParams
): Promise<PerformUpdateFolderResult> {
  try {
    if (params.parentId && params.parentId === params.folderId) {
      return { success: false, error: 'Folder cannot be its own parent', errorCode: 'validation' }
    }

    if (params.parentId) {
      const parentError = await assertFolderParentValid(params.parentId, {
        workspaceId: params.workspaceId,
        resourceType: 'workflow',
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
    if (params.locked !== undefined) updates.locked = params.locked
    if (params.parentId !== undefined) updates.parentId = params.parentId || null
    if (params.sortOrder !== undefined) updates.sortOrder = params.sortOrder

    const [updatedFolder] = await db
      .update(folder)
      .set(updates)
      .where(
        and(
          eq(folder.id, params.folderId),
          eq(folder.workspaceId, params.workspaceId),
          isWorkflowFolder,
          isNull(folder.deletedAt)
        )
      )
      .returning()

    if (!updatedFolder) {
      return { success: false, error: 'Folder not found', errorCode: 'not_found' }
    }

    logger.info('Updated workflow folder', { folderId: params.folderId, updates })

    return { success: true, folder: updatedFolder }
  } catch (error) {
    if (getPostgresErrorCode(error) === '23505') {
      return {
        success: false,
        error: 'A folder with this name already exists in this location',
        errorCode: 'conflict',
      }
    }
    logger.error('Failed to update workflow folder', { error })
    return { success: false, error: 'Internal server error', errorCode: 'internal' }
  }
}

/**
 * Recursively deletes a folder: removes child folders first, archives non-archived
 * workflows in each folder via {@link archiveWorkflowsByIdsInWorkspace}, then soft-deletes
 * the folder row.
 */
async function deleteFolderRecursively(
  folderId: string,
  workspaceId: string,
  deletedAt?: Date
): Promise<{ folders: number; workflows: number }> {
  const timestamp = deletedAt ?? new Date()
  const stats = { folders: 0, workflows: 0 }

  const childFolders = await db
    .select({ id: folder.id })
    .from(folder)
    .where(
      and(
        eq(folder.parentId, folderId),
        eq(folder.workspaceId, workspaceId),
        isWorkflowFolder,
        isNull(folder.deletedAt)
      )
    )

  for (const childFolder of childFolders) {
    const childStats = await deleteFolderRecursively(childFolder.id, workspaceId, timestamp)
    stats.folders += childStats.folders
    stats.workflows += childStats.workflows
  }

  const workflowsInFolder = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(
      and(
        eq(workflow.folderId, folderId),
        eq(workflow.workspaceId, workspaceId),
        isNull(workflow.archivedAt)
      )
    )

  if (workflowsInFolder.length > 0) {
    await archiveWorkflowsByIdsInWorkspace(
      workspaceId,
      workflowsInFolder.map((entry) => entry.id),
      { requestId: `folder-${folderId}`, archivedAt: timestamp }
    )
    stats.workflows += workflowsInFolder.length
  }

  await db.update(folder).set({ deletedAt: timestamp }).where(eq(folder.id, folderId))
  stats.folders += 1

  return stats
}

/**
 * Counts non-archived workflows in the folder and all descendant folders.
 */
async function countWorkflowsInFolderRecursively(
  folderId: string,
  workspaceId: string
): Promise<number> {
  let count = 0

  const workflowsInFolder = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(
      and(
        eq(workflow.folderId, folderId),
        eq(workflow.workspaceId, workspaceId),
        isNull(workflow.archivedAt)
      )
    )

  count += workflowsInFolder.length

  const childFolders = await db
    .select({ id: folder.id })
    .from(folder)
    .where(
      and(
        eq(folder.parentId, folderId),
        eq(folder.workspaceId, workspaceId),
        isWorkflowFolder,
        isNull(folder.deletedAt)
      )
    )

  for (const childFolder of childFolders) {
    count += await countWorkflowsInFolderRecursively(childFolder.id, workspaceId)
  }

  return count
}

/** Parameters for {@link performDeleteFolder}. */
export interface PerformDeleteFolderParams {
  folderId: string
  workspaceId: string
  userId: string
  folderName?: string
}

/** Outcome of {@link performDeleteFolder}. */
export interface PerformDeleteFolderResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  deletedItems?: { folders: number; workflows: number }
}

/**
 * Performs a full folder deletion: enforces the last-workflow guard,
 * recursively archives child workflows and sub-folders, and records
 * an audit entry. Both the folders API DELETE handler and the copilot
 * delete_folder tool must use this function.
 */
export async function performDeleteFolder(
  params: PerformDeleteFolderParams
): Promise<PerformDeleteFolderResult> {
  const { folderId, workspaceId, userId, folderName } = params

  const workflowsInFolder = await countWorkflowsInFolderRecursively(folderId, workspaceId)
  const totalWorkflowsInWorkspace = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))

  if (workflowsInFolder > 0 && workflowsInFolder >= totalWorkflowsInWorkspace.length) {
    return {
      success: false,
      error: 'Cannot delete folder containing the only workflow(s) in the workspace',
      errorCode: 'validation',
    }
  }

  const deletionStats = await deleteFolderRecursively(folderId, workspaceId)

  logger.info('Deleted folder and all contents:', { folderId, deletionStats })

  recordAudit({
    workspaceId,
    actorId: userId,
    action: AuditAction.FOLDER_DELETED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: folderId,
    resourceName: folderName,
    description: `Deleted folder "${folderName || folderId}"`,
    metadata: {
      affected: {
        workflows: deletionStats.workflows,
        subfolders: deletionStats.folders - 1,
      },
    },
  })

  return { success: true, deletedItems: deletionStats }
}

/**
 * Recursively restores a folder and its children/workflows within a transaction.
 * Only restores workflows whose `archivedAt` matches the folder's `deletedAt` —
 * workflows individually deleted before the folder are left archived.
 */
async function restoreFolderRecursively(
  folderId: string,
  workspaceId: string,
  folderDeletedAt: Date,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0]
): Promise<{ folders: number; workflows: number }> {
  const stats = { folders: 0, workflows: 0 }

  await tx.update(folder).set({ deletedAt: null }).where(eq(folder.id, folderId))
  stats.folders += 1

  const archivedWorkflows = await tx
    .select({ id: workflow.id })
    .from(workflow)
    .where(
      and(
        eq(workflow.folderId, folderId),
        eq(workflow.workspaceId, workspaceId),
        eq(workflow.archivedAt, folderDeletedAt)
      )
    )

  if (archivedWorkflows.length > 0) {
    const workflowIds = archivedWorkflows.map((wf) => wf.id)
    const now = new Date()
    const restoreSet = { archivedAt: null, updatedAt: now }

    await tx.update(workflow).set(restoreSet).where(inArray(workflow.id, workflowIds))
    await tx
      .update(workflowSchedule)
      .set(restoreSet)
      .where(inArray(workflowSchedule.workflowId, workflowIds))
    await tx.update(webhook).set(restoreSet).where(inArray(webhook.workflowId, workflowIds))
    await tx.update(chat).set(restoreSet).where(inArray(chat.workflowId, workflowIds))
    await tx
      .update(workflowMcpTool)
      .set(restoreSet)
      .where(inArray(workflowMcpTool.workflowId, workflowIds))

    stats.workflows += archivedWorkflows.length
  }

  const archivedChildren = await tx
    .select({ id: folder.id })
    .from(folder)
    .where(
      and(
        eq(folder.parentId, folderId),
        eq(folder.workspaceId, workspaceId),
        isWorkflowFolder,
        eq(folder.deletedAt, folderDeletedAt)
      )
    )

  for (const child of archivedChildren) {
    const childStats = await restoreFolderRecursively(child.id, workspaceId, folderDeletedAt, tx)
    stats.folders += childStats.folders
    stats.workflows += childStats.workflows
  }

  return stats
}

/** Parameters for {@link performRestoreFolder}. */
export interface PerformRestoreFolderParams {
  folderId: string
  workspaceId: string
  userId: string
  folderName?: string
}

/** Outcome of {@link performRestoreFolder}. */
export interface PerformRestoreFolderResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  restoredItems?: { folders: number; workflows: number }
}

/**
 * Restores a soft-deleted folder and all its soft-deleted children and workflows.
 * If the folder's parent is still soft-deleted, moves it to the root level.
 */
export async function performRestoreFolder(
  params: PerformRestoreFolderParams
): Promise<PerformRestoreFolderResult> {
  const { folderId, workspaceId, userId, folderName } = params

  const { getWorkspaceWithOwner } = await import('@/lib/workspaces/permissions/utils')
  const ws = await getWorkspaceWithOwner(workspaceId)
  if (!ws || ws.archivedAt) {
    return {
      success: false,
      error: 'Cannot restore folder into an archived workspace',
      errorCode: 'validation',
    }
  }

  const outcome = await db.transaction(async (tx) => {
    // `FOR UPDATE` row-locks this folder for the rest of the transaction -- a plain
    // SELECT inside a transaction does not block a concurrent UPDATE, so without this
    // a lock toggled on this row after this read but before the restore write below
    // could still be silently bypassed.
    const [existingFolder] = await tx
      .select()
      .from(folder)
      .where(and(eq(folder.id, folderId), eq(folder.workspaceId, workspaceId), isWorkflowFolder))
      .for('update')

    if (!existingFolder) return { kind: 'not_found' as const }
    if (!existingFolder.deletedAt) return { kind: 'not_archived' as const }

    // The folder row is soft-deleted, so the generic lock engine (which only reads
    // active rows) can't see it -- check its own `locked` flag directly. This read
    // must happen inside the same transaction as the restore write below (not before
    // it opens): otherwise a concurrent lock landing between the read and the write
    // could still resurrect and mutate a folder that is now locked.
    if (existingFolder.locked) {
      throw new ResourceLockedError('workflow', false, 'Folder is locked')
    }

    let resolvedParentId = existingFolder.parentId
    if (resolvedParentId) {
      const [parentFolder] = await tx
        .select({ deletedAt: folder.deletedAt })
        .from(folder)
        .where(eq(folder.id, resolvedParentId))

      if (!parentFolder || parentFolder.deletedAt) {
        resolvedParentId = null
        await tx.update(folder).set({ parentId: null }).where(eq(folder.id, folderId))
      }
    }

    // resolvedParentId is either null (root, always safe) or a confirmed-active
    // folder -- without this, the folder could resurface under a folder that was
    // locked after this one was deleted. Passing `tx` (not the default db client)
    // keeps this read inside the same transaction as the write below, closing the
    // TOCTOU window where a concurrent request locks resolvedParentId in between.
    await assertFolderMutable(resolvedParentId, 'workflow', tx)

    const stats = await restoreFolderRecursively(
      folderId,
      workspaceId,
      existingFolder.deletedAt,
      tx
    )
    return { kind: 'ok' as const, stats, name: existingFolder.name }
  })

  if (outcome.kind === 'not_found') {
    return { success: false, error: 'Folder not found', errorCode: 'not_found' }
  }
  if (outcome.kind === 'not_archived') {
    return { success: false, error: 'Folder is not archived', errorCode: 'validation' }
  }

  const { stats, name } = outcome

  logger.info('Restored folder and all contents:', { folderId, restoredStats: stats })

  recordAudit({
    workspaceId,
    actorId: userId,
    action: AuditAction.FOLDER_RESTORED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: folderId,
    resourceName: folderName ?? name,
    description: `Restored folder "${folderName ?? name}"`,
    metadata: {
      affected: {
        workflows: stats.workflows,
        subfolders: stats.folders - 1,
      },
    },
  })

  return { success: true, restoredItems: stats }
}
