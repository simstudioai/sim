import { db } from '@sim/db'
import { workflow, workflowFolder } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
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
  workspaceId: string
): Promise<{ folders: number; workflows: number }> {
  const stats = { folders: 0, workflows: 0 }

  const childFolders = await db
    .select({ id: workflowFolder.id })
    .from(workflowFolder)
    .where(and(eq(workflowFolder.parentId, folderId), eq(workflowFolder.workspaceId, workspaceId)))

  for (const childFolder of childFolders) {
    const childStats = await deleteFolderRecursively(childFolder.id, workspaceId)
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
      { requestId: `folder-${folderId}` }
    )
    stats.workflows += workflowsInFolder.length
  }

  await db.delete(workflowFolder).where(eq(workflowFolder.id, folderId))
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
    .where(and(eq(workflowFolder.parentId, folderId), eq(workflowFolder.workspaceId, workspaceId)))

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
