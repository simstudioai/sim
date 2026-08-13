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
 * Parsing through the route contract's response schema strips the server-only fields
 * `requestJson` strips on the client (`contentUpdatedAt`), so a prefetched entry is identical
 * to a client fetch rather than carrying a field that vanishes on the next refetch.
 *
 * Callers authorize the viewer against `workspaceId` first.
 *
 * `maxRows` bounds the work for a caller that will only use the list if the whole
 * workspace fits a payload budget: the read stops one row past the budget and returns
 * `null` on overflow, before the share join and the contract parse — so the workspaces
 * the budget exists to protect are the ones that pay least to be rejected. Returning
 * `null` rather than the prefix is what stops a caller presenting a truncated read as
 * the workspace's files.
 */
export async function listWorkspaceFilesWithShares(
  workspaceId: string,
  scope: WorkspaceFileScope,
  options?: { maxRows?: number }
) {
  const maxRows = options?.maxRows
  const files = await listWorkspaceFiles(workspaceId, {
    scope,
    ...(maxRows === undefined ? {} : { limit: maxRows + 1 }),
  })
  if (maxRows !== undefined && files.length > maxRows) return null

  const shares = await getWorkspaceShares('file', workspaceId)
  const withShares = files.map((file) => ({ ...file, share: shares.get(file.id) ?? null }))
  return listWorkspaceFilesContract.response.schema.shape.files.parse(withShares)
}
