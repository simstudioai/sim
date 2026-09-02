import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { listWorkspaceFileFoldersOperation } from '@/lib/workspace-files/application/workspace-file-folders'
import { toWorkspaceFileFolderPathView } from '@/lib/workspace-files/folder-display-path'
import { resolveFolderIdsForPaths } from '@/lib/workspace-files/folder-path-selection'

/** The folders a run may read from, plus whether files at the root are in scope. */
export interface WorkspaceFolderScope {
  folderIds: Set<string>
  /** Files carrying no folder id are in scope. See {@link resolveFolderIdsForPaths}. */
  includeRootFiles: boolean
}

/**
 * Resolves canonical folder paths to the folder scope a run may read from.
 *
 * Resolution happens at run time rather than when a block is configured:
 * choosing a folder means "whatever is in it when this runs", so a file added
 * tomorrow is read tomorrow. Expanding in the picker would freeze a snapshot.
 *
 * This loads folders only. Callers that need the files themselves filter their
 * own listing against the returned scope — the search path pushes it down into
 * SQL instead, which is why the folder half is separated from the file half.
 */
export async function resolveWorkspaceFolderScope(args: {
  principal: Principal
  workspaceId: string
  folderPaths: readonly string[]
  includeSubfolders: boolean | undefined
}): Promise<WorkspaceFolderScope> {
  const { folders } = await listWorkspaceFileFoldersOperation.execute({
    principal: args.principal,
    input: { workspaceId: args.workspaceId },
  })

  const projected = folders.map((folder) => ({
    ...toWorkspaceFileFolderPathView(folder),
    id: folder.id,
    parentId: folder.parentId,
  }))
  const selection = resolveFolderIdsForPaths(projected, args.folderPaths, {
    includeSubfolders: args.includeSubfolders,
  })
  if (selection.missingPath !== undefined) {
    throw new OrchestrationError('not_found', `Folder not found: ${selection.missingPath}`)
  }

  return { folderIds: selection.folderIds, includeRootFiles: selection.includeRootFiles }
}

/** Whether a file belongs to a resolved scope. Root files carry no folder id. */
export function isFileInWorkspaceFolderScope(
  folderId: string | null | undefined,
  scope: WorkspaceFolderScope
): boolean {
  return folderId ? scope.folderIds.has(folderId) : scope.includeRootFiles
}
