import { listWorkspaceFilesContract } from '@/lib/api/contracts/workspace-files'
import { getWorkspaceShares } from '@/lib/public-shares/share-manager'
import {
  listWorkspaceFiles,
  type WorkspaceFileScope,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

/**
 * Lists a workspace's files with each file's public share joined on — shared by
 * `GET /api/workspaces/[id]/files` and the Files browser's server prefetch so both cache
 * one shape.
 *
 * Parsing through the route contract's response schema strips the server-only fields
 * `requestJson` strips on the client (`contentUpdatedAt`), so a prefetched entry is identical
 * to a client fetch rather than carrying a field that vanishes on the next refetch.
 *
 * Callers authorize the viewer against `workspaceId` first.
 *
 * `limit` caps the rows read for callers that only need to know whether the workspace fits
 * a payload budget; the result is then a prefix of the list, not the list, so no caller may
 * present a limited read as the workspace's files.
 */
export async function listWorkspaceFilesWithShares(
  workspaceId: string,
  scope: WorkspaceFileScope,
  options?: { limit?: number }
) {
  const [files, shares] = await Promise.all([
    listWorkspaceFiles(workspaceId, { scope, limit: options?.limit }),
    getWorkspaceShares('file', workspaceId),
  ])
  const withShares = files.map((file) => ({ ...file, share: shares.get(file.id) ?? null }))
  return listWorkspaceFilesContract.response.schema.shape.files.parse(withShares)
}
