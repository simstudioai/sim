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
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { archiveWorkflowsByIdsInWorkspace } from '@/lib/workflows/lifecycle'
import type { OrchestrationErrorCode } from '@/lib/workflows/orchestration/types'

const logger = createLogger('FolderLifecycle')

/**
 * Recursively deletes a folder: removes child folders first, archives non-archived
 * workflows in each folder via {@link archiveWorkflowsByIdsInWorkspace}, then deletes
 * the folder row.
 */
export async function deleteFolderRecursively(
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
export async function countWorkflowsInFolderRecursively(
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
