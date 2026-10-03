import { listWorkspaceFilesContract } from '@/lib/api/contracts/workspace-files'
import { getWorkspaceShares } from '@/lib/public-shares/share-manager'
import {
  listWorkspaceFiles,
  type WorkspaceFileScope,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

/**
 * Lists a workspace's files with each file's public share joined on, parsed through the
 * `GET /api/workspaces/[id]/files` response contract so the workspace layout's server seed
 * caches exactly the shape that route returns.
 *
 * The shared response schema keeps server-prefetched and client-fetched entries identical,
 * including the content version used for conditional saves.
 *
 * Callers authorize the viewer against `workspaceId` first.
 *
 * `maxRows` bounds the result for a caller that only uses the list if the whole workspace
 * fits a payload budget: on overflow it returns `null` rather than the prefix, so a
 * truncated read is never presented as the workspace's files. The two reads still run
 * concurrently, since under-budget workspaces are the common case.
 *
 * `throwOnError` propagates a failed file read instead of degrading to an empty list,
 * which a cache seed would store as authoritative.
 */
export async function listWorkspaceFilesWithShares(
  workspaceId: string,
  scope: WorkspaceFileScope,
  options?: { maxRows?: number; throwOnError?: boolean }
) {
  const maxRows = options?.maxRows
  const [files, shares] = await Promise.all([
    listWorkspaceFiles(workspaceId, {
      scope,
      limit: maxRows === undefined ? undefined : maxRows + 1,
      throwOnError: options?.throwOnError,
    }),
    getWorkspaceShares('file', workspaceId),
  ])
  if (maxRows !== undefined && files.length > maxRows) return null

  const withShares = files.map((file) => ({ ...file, share: shares.get(file.id) ?? null }))
  return listWorkspaceFilesContract.response.schema.shape.files.parse(withShares)
}
