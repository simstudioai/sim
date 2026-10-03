import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { FolderIdScope } from '@/lib/folders/scope'
import { listWorkspaceFileFoldersOperation } from '@/lib/workspace-files/application/workspace-file-folders'
import { toWorkspaceFileFolderPathView } from '@/lib/workspace-files/folder-display-path'
import { resolveFolderIdsForPaths } from '@/lib/workspace-files/folder-path-selection'

/**
 * Loads a workspace's folders and resolves canonical paths to the scope a run
 * may read from.
 *
 * The scope itself is {@link FolderIdScope}, shared with the other resource
 * types; this is the workspace-file IO around it, and lives here rather than in
 * `lib/folders` because it reaches into the application layer, which a generic
 * folder utility must not.
 *
 * Resolution happens at run time rather than when a block is configured:
 * choosing a folder means "whatever is in it when this runs", so a file added
 * tomorrow is read tomorrow. Expanding in the picker would freeze a snapshot.
 *
 * Folders only. Callers that need the files filter their own listing against
 * the result; the search path pushes it into SQL instead, which is why the
 * folder half is resolved separately from the file half.
 */
export async function resolveWorkspaceFolderScope(args: {
  principal: Principal
  workspaceId: string
  folderPaths: readonly string[]
  includeSubfolders: boolean | undefined
}): Promise<FolderIdScope> {
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

  return { folderIds: selection.folderIds, includeRootItems: selection.includeRootItems }
}
