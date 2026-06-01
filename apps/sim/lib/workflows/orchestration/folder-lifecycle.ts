import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  a2aAgent,
  chat,
  form,
  webhook,
  workflow,
  workflowFolder,
  workflowMcpTool,
  workflowSchedule,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, min } from 'drizzle-orm'
import { archiveWorkflowsByIdsInWorkspace } from '@/lib/workflows/lifecycle'
import type { OrchestrationErrorCode } from '@/lib/workflows/orchestration/types'
import { checkForCircularReference } from '@/lib/workflows/utils'

const logger = createLogger('FolderLifecycle')

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
  folder?: typeof workflowFolder.$inferSelect
}

export interface PerformUpdateFolderParams {
  folderId: string
  workspaceId: string
  userId: string
  name?: string
  color?: string
  isExpanded?: boolean
  locked?: boolean
  parentId?: string | null
  sortOrder?: number
}

export interface PerformUpdateFolderResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  folder?: typeof workflowFolder.$inferSelect
}

async function nextFolderSortOrder(
  workspaceId: string,
  parentId: string | null | undefined
): Promise<number> {
  const folderParentCondition = parentId
    ? eq(workflowFolder.parentId, parentId)
    : isNull(workflowFolder.parentId)
  const workflowParentCondition = parentId
    ? eq(workflow.folderId, parentId)
    : isNull(workflow.folderId)

  const [[folderResult], [workflowResult]] = await Promise.all([
    db
      .select({ minSortOrder: min(workflowFolder.sortOrder) })
      .from(workflowFolder)
      .where(and(eq(workflowFolder.workspaceId, workspaceId), folderParentCondition)),
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
    const sortOrder =
      params.sortOrder !== undefined
        ? params.sortOrder
        : await nextFolderSortOrder(params.workspaceId, parentId)

    const [folder] = await db
      .insert(workflowFolder)
      .values({
        id: folderId,
        name: params.name.trim(),
        userId: params.userId,
        workspaceId: params.workspaceId,
        parentId,
        color: params.color || '#6B7280',
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
      resourceName: folder.name,
      description: `Created folder "${folder.name}"`,
      metadata: {
        name: folder.name,
        workspaceId: params.workspaceId,
        parentId: parentId || undefined,
        color: folder.color,
        sortOrder: folder.sortOrder,
      },
    })

    return { success: true, folder }
  } catch (error) {
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
      const wouldCreateCycle = await checkForCircularReference(params.folderId, params.parentId)
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
    if (params.color !== undefined) updates.color = params.color
    if (params.isExpanded !== undefined) updates.isExpanded = params.isExpanded
    if (params.locked !== undefined) updates.locked = params.locked
    if (params.parentId !== undefined) updates.parentId = params.parentId || null
    if (params.sortOrder !== undefined) updates.sortOrder = params.sortOrder

    const [folder] = await db
      .update(workflowFolder)
      .set(updates)
      .where(
        and(
          eq(workflowFolder.id, params.folderId),
          eq(workflowFolder.workspaceId, params.workspaceId)
        )
      )
      .returning()

    if (!folder) {
      return { success: false, error: 'Folder not found', errorCode: 'not_found' }
    }

    logger.info('Updated workflow folder', { folderId: params.folderId, updates })

    return { success: true, folder }
  } catch (error) {
    logger.error('Failed to update workflow folder', { error })
    return { success: false, error: 'Internal server error', errorCode: 'internal' }
  }
}

/**
 * Recursively deletes a folder: removes child folders first, archives non-archived
 * workflows in each folder via {@link archiveWorkflowsByIdsInWorkspace}, then deletes
 * the folder row.
 */
async function deleteFolderRecursively(
  folderId: string,
  workspaceId: string,
  archivedAt?: Date
): Promise<{ folders: number; workflows: number }> {
  const timestamp = archivedAt ?? new Date()
  const stats = { folders: 0, workflows: 0 }

  const childFolders = await db
    .select({ id: workflowFolder.id })
    .from(workflowFolder)
    .where(
      and(
        eq(workflowFolder.parentId, folderId),
        eq(workflowFolder.workspaceId, workspaceId),
        isNull(workflowFolder.archivedAt)
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

  await db
    .update(workflowFolder)
    .set({ archivedAt: timestamp })
    .where(eq(workflowFolder.id, folderId))
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
    .select({ id: workflowFolder.id })
    .from(workflowFolder)
    .where(
      and(
        eq(workflowFolder.parentId, folderId),
        eq(workflowFolder.workspaceId, workspaceId),
        isNull(workflowFolder.archivedAt)
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
 * Only restores workflows whose `archivedAt` matches the folder's — workflows
 * individually deleted before the folder are left archived.
 */
async function restoreFolderRecursively(
  folderId: string,
  workspaceId: string,
  folderArchivedAt: Date,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0]
): Promise<{ folders: number; workflows: number }> {
  const stats = { folders: 0, workflows: 0 }

  await tx.update(workflowFolder).set({ archivedAt: null }).where(eq(workflowFolder.id, folderId))
  stats.folders += 1

  const archivedWorkflows = await tx
    .select({ id: workflow.id })
    .from(workflow)
    .where(
      and(
        eq(workflow.folderId, folderId),
        eq(workflow.workspaceId, workspaceId),
        eq(workflow.archivedAt, folderArchivedAt)
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
    await tx.update(form).set(restoreSet).where(inArray(form.workflowId, workflowIds))
    await tx
      .update(workflowMcpTool)
      .set(restoreSet)
      .where(inArray(workflowMcpTool.workflowId, workflowIds))
    await tx.update(a2aAgent).set(restoreSet).where(inArray(a2aAgent.workflowId, workflowIds))

    stats.workflows += archivedWorkflows.length
  }

  const archivedChildren = await tx
    .select({ id: workflowFolder.id })
    .from(workflowFolder)
    .where(
      and(
        eq(workflowFolder.parentId, folderId),
        eq(workflowFolder.workspaceId, workspaceId),
        eq(workflowFolder.archivedAt, folderArchivedAt)
      )
    )

  for (const child of archivedChildren) {
    const childStats = await restoreFolderRecursively(child.id, workspaceId, folderArchivedAt, tx)
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
  restoredItems?: { folders: number; workflows: number }
}

/**
 * Restores an archived folder and all its archived children and workflows.
 * If the folder's parent is still archived, moves it to the root level.
 */
export async function performRestoreFolder(
  params: PerformRestoreFolderParams
): Promise<PerformRestoreFolderResult> {
  const { folderId, workspaceId, userId, folderName } = params

  const [folder] = await db
    .select()
    .from(workflowFolder)
    .where(and(eq(workflowFolder.id, folderId), eq(workflowFolder.workspaceId, workspaceId)))

  if (!folder) {
    return { success: false, error: 'Folder not found' }
  }

  if (!folder.archivedAt) {
    return { success: true, restoredItems: { folders: 0, workflows: 0 } }
  }

  const { getWorkspaceWithOwner } = await import('@/lib/workspaces/permissions/utils')
  const ws = await getWorkspaceWithOwner(workspaceId)
  if (!ws || ws.archivedAt) {
    return { success: false, error: 'Cannot restore folder into an archived workspace' }
  }

  const restoredStats = await db.transaction(async (tx) => {
    if (folder.parentId) {
      const [parentFolder] = await tx
        .select({ archivedAt: workflowFolder.archivedAt })
        .from(workflowFolder)
        .where(eq(workflowFolder.id, folder.parentId))

      if (!parentFolder || parentFolder.archivedAt) {
        await tx
          .update(workflowFolder)
          .set({ parentId: null })
          .where(eq(workflowFolder.id, folderId))
      }
    }

    return restoreFolderRecursively(folderId, workspaceId, folder.archivedAt!, tx)
  })

  logger.info('Restored folder and all contents:', { folderId, restoredStats })

  recordAudit({
    workspaceId,
    actorId: userId,
    action: AuditAction.FOLDER_RESTORED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: folderId,
    resourceName: folderName ?? folder.name,
    description: `Restored folder "${folderName ?? folder.name}"`,
    metadata: {
      affected: {
        workflows: restoredStats.workflows,
        subfolders: restoredStats.folders - 1,
      },
    },
  })

  return { success: true, restoredItems: restoredStats }
}
