import { db } from '@sim/db'
import { workspaceFileFolder, workspaceFiles } from '@sim/db/schema'
import { and, eq, inArray, isNull, or, type SQL } from 'drizzle-orm'
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

  const workflowPlansPath = `${WORKFLOW_PLANS_BACKING_FOLDER}/${args.workflowId}`
  const isPlansFolder = (path: string) =>
    path === workflowPlansPath || path.startsWith(`${workflowPlansPath}/`)

  /**
   * Folders whose files this workflow owns, resolved by id rather than by path.
   * A file's `folderPath` is derived solely from its `folderId`, so matching on
   * folder membership is equivalent to the path comparison it replaces — without
   * loading every file in the workspace to compute it.
   *
   * Soft-deleted folders are included: path resolution ignores `deletedAt`, so a
   * live file parented to an archived folder still resolved to these paths and
   * must still be archived here.
   */
  const ownedFileFolderIds = folders.filter((f) => isPlansFolder(f.path)).map((f) => f.id)
  const changelogFolderIds = folders
    .filter((f) => f.path === WORKFLOW_CHANGELOG_BACKING_FOLDER)
    .map((f) => f.id)

  /** Only live folders are archived, matching the previous behavior. */
  const ownedFolderIds = folders
    .filter((f) => !f.deletedAt && isPlansFolder(f.path))
    .map((f) => f.id)

  /**
   * Collected as a list so the guard below tests the same value that is spread into
   * `or()`. `and()` and `or()` both drop `undefined` arguments, so an ownership
   * clause that silently resolved to nothing would leave a WHERE of workspace +
   * context + not-deleted — which archives every file in the workspace. Gating on a
   * non-empty list makes that unrepresentable.
   */
  const ownershipFilters = [
    ownedFileFolderIds.length > 0 ? inArray(workspaceFiles.folderId, ownedFileFolderIds) : null,
    changelogFolderIds.length > 0
      ? and(
          inArray(workspaceFiles.folderId, changelogFolderIds),
          eq(workspaceFiles.originalName, `${args.workflowId}.md`)
        )
      : null,
  ].filter((filter): filter is SQL => filter != null)

  let archivedFiles: { id: string }[] = []
  if (ownershipFilters.length > 0) {
    archivedFiles = await db
      .update(workspaceFiles)
      .set({ deletedAt })
      .where(
        and(
          eq(workspaceFiles.workspaceId, args.workspaceId),
          eq(workspaceFiles.context, 'workspace'),
          isNull(workspaceFiles.deletedAt),
          or(...ownershipFilters)
        )
      )
      .returning({ id: workspaceFiles.id })
  }

  let archivedFolders: { id: string }[] = []
  if (ownedFolderIds.length > 0) {
    archivedFolders = await db
      .update(workspaceFileFolder)
      .set({ deletedAt })
      .where(
        and(
          eq(workspaceFileFolder.workspaceId, args.workspaceId),
          inArray(workspaceFileFolder.id, ownedFolderIds),
          isNull(workspaceFileFolder.deletedAt)
        )
      )
      .returning({ id: workspaceFileFolder.id })
  }

  return { files: archivedFiles.length, folders: archivedFolders.length }
}
