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
 */
export async function listWorkspaceFilesWithShares(workspaceId: string, scope: WorkspaceFileScope) {
  const [files, shares] = await Promise.all([
    listWorkspaceFiles(workspaceId, { scope }),
    getWorkspaceShares('file', workspaceId),
  ])
  const withShares = files.map((file) => ({ ...file, share: shares.get(file.id) ?? null }))
  return listWorkspaceFilesContract.response.schema.shape.files.parse(withShares)
}
