import { getWorkspaceShares } from '@/lib/public-shares/share-manager'
import {
  listWorkspaceFiles,
  type WorkspaceFileScope,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

/**
 * Lists a workspace's files with each file's public share joined on — shared by
 * `GET /api/workspaces/[id]/files` and the Files/Home prefetches so a hydrated cache entry
 * and a client fetch cannot disagree.
 *
 * Callers are responsible for authorizing the viewer against `workspaceId` first.
 */
export async function listWorkspaceFilesWithShares(
  workspaceId: string,
  scope: WorkspaceFileScope = 'active'
) {
  const [files, shares] = await Promise.all([
    listWorkspaceFiles(workspaceId, { scope }),
    getWorkspaceShares('file', workspaceId),
  ])
  return files.map((file) => ({ ...file, share: shares.get(file.id) ?? null }))
}
