import { db } from '@sim/db'
import { folder as workspaceFileFolder, workspaceFiles } from '@sim/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  WORKFLOW_CHANGELOG_BACKING_FOLDER,
  WORKFLOW_PLANS_BACKING_FOLDER,
  WORKSPACE_PLANS_BACKING_FOLDER,
} from '@/lib/copilot/vfs/workflow-aliases'
import {
  ensureWorkspaceFileFolderPath,
  listWorkspaceFileFolders,
} from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  getWorkspaceFileByName,
  listWorkspaceFiles,
  uploadWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

export interface WorkflowAliasBacking {
  changelogFolderId: string
  plansRootFolderId: string
  workflowPlansFolderId: string
  workspacePlansFolderId: string
  changelogFile: WorkspaceFileRecord | null
}

function initialChangelogContent(workflowName?: string): string {
  const title = workflowName?.trim() || 'Workflow'
  return `# ${title} Changelog\n`
}

export async function ensureWorkflowAliasBacking(args: {
  workspaceId: string
  userId: string
  workflowId: string
  workflowName?: string
}): Promise<WorkflowAliasBacking> {
  const changelogFolderId = await ensureWorkspaceFileFolderPath({
    workspaceId: args.workspaceId,
    userId: args.userId,
    pathSegments: [WORKFLOW_CHANGELOG_BACKING_FOLDER],
  })
  const plansRootFolderId = await ensureWorkspaceFileFolderPath({
    workspaceId: args.workspaceId,
    userId: args.userId,
    pathSegments: [WORKFLOW_PLANS_BACKING_FOLDER],
  })
  const workflowPlansFolderId = await ensureWorkspaceFileFolderPath({
    workspaceId: args.workspaceId,
    userId: args.userId,
    pathSegments: [WORKFLOW_PLANS_BACKING_FOLDER, args.workflowId],
  })
  const workspacePlansFolderId = await ensureWorkspaceFileFolderPath({
    workspaceId: args.workspaceId,
    userId: args.userId,
    pathSegments: [WORKFLOW_PLANS_BACKING_FOLDER, WORKSPACE_PLANS_BACKING_FOLDER],
  })

  if (
    !changelogFolderId ||
    !plansRootFolderId ||
    !workflowPlansFolderId ||
    !workspacePlansFolderId
  ) {
    throw new Error('Failed to provision workflow alias backing folders')
  }

  const changelogName = `${args.workflowId}.md`
  let changelogFile = await getWorkspaceFileByName(args.workspaceId, changelogName, {
    folderId: changelogFolderId,
  })
  if (!changelogFile) {
    await uploadWorkspaceFile(
      args.workspaceId,
      args.userId,
      Buffer.from(initialChangelogContent(args.workflowName), 'utf-8'),
      changelogName,
      'text/markdown',
      { folderId: changelogFolderId }
    )
    changelogFile = await getWorkspaceFileByName(args.workspaceId, changelogName, {
      folderId: changelogFolderId,
    })
  }

  return {
    changelogFolderId,
    plansRootFolderId,
    workflowPlansFolderId,
    workspacePlansFolderId,
    changelogFile,
  }
}

export async function ensureWorkspacePlanBacking(args: {
  workspaceId: string
  userId: string
}): Promise<{ plansRootFolderId: string; workspacePlansFolderId: string }> {
  const plansRootFolderId = await ensureWorkspaceFileFolderPath({
    workspaceId: args.workspaceId,
    userId: args.userId,
    pathSegments: [WORKFLOW_PLANS_BACKING_FOLDER],
  })
  const workspacePlansFolderId = await ensureWorkspaceFileFolderPath({
    workspaceId: args.workspaceId,
    userId: args.userId,
    pathSegments: [WORKFLOW_PLANS_BACKING_FOLDER, WORKSPACE_PLANS_BACKING_FOLDER],
  })
  if (!plansRootFolderId || !workspacePlansFolderId) {
    throw new Error('Failed to provision workspace plan backing folders')
  }
  return { plansRootFolderId, workspacePlansFolderId }
}

export async function cleanupWorkflowAliasBacking(args: {
  workspaceId: string
  workflowId: string
  deletedAt?: Date
}): Promise<{ files: number; folders: number }> {
  const deletedAt = args.deletedAt ?? new Date()
  const folders = await listWorkspaceFileFolders(args.workspaceId, {
    scope: 'all',
    includeReservedSystemFolders: true,
  })
  const files = await listWorkspaceFiles(args.workspaceId, {
    scope: 'all',
    folders,
    includeReservedSystemFiles: true,
  })

  const ownedFileIds = files
    .filter((file) => {
      if (file.deletedAt) return false
      const changelogMatch =
        file.folderPath === WORKFLOW_CHANGELOG_BACKING_FOLDER &&
        file.name === `${args.workflowId}.md`
      const workflowPlanMatch =
        file.folderPath === `${WORKFLOW_PLANS_BACKING_FOLDER}/${args.workflowId}` ||
        Boolean(file.folderPath?.startsWith(`${WORKFLOW_PLANS_BACKING_FOLDER}/${args.workflowId}/`))
      return changelogMatch || workflowPlanMatch
    })
    .map((file) => file.id)

  const ownedFolderIds = folders
    .filter((folder) => {
      if (folder.deletedAt) return false
      return (
        folder.path === `${WORKFLOW_PLANS_BACKING_FOLDER}/${args.workflowId}` ||
        folder.path.startsWith(`${WORKFLOW_PLANS_BACKING_FOLDER}/${args.workflowId}/`)
      )
    })
    .map((folder) => folder.id)

  if (ownedFileIds.length > 0) {
    await db
      .update(workspaceFiles)
      .set({ deletedAt })
      .where(
        and(
          eq(workspaceFiles.workspaceId, args.workspaceId),
          inArray(workspaceFiles.id, ownedFileIds),
          isNull(workspaceFiles.deletedAt)
        )
      )
  }

  if (ownedFolderIds.length > 0) {
    await db
      .update(workspaceFileFolder)
      .set({ deletedAt })
      .where(
        and(
          eq(workspaceFileFolder.workspaceId, args.workspaceId),
          eq(workspaceFileFolder.resourceType, 'file'),
          inArray(workspaceFileFolder.id, ownedFolderIds),
          isNull(workspaceFileFolder.deletedAt)
        )
      )
  }

  return { files: ownedFileIds.length, folders: ownedFolderIds.length }
}
