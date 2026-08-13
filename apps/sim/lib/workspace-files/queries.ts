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
 * `maxRows` bounds the result for a caller that will only use the list if the whole
 * workspace fits a payload budget: the read stops one row past the budget and returns
 * `null` on overflow rather than the prefix, which is what stops a caller presenting a
 * truncated read as the workspace's files. The two reads still run concurrently — the
 * workspaces under the budget are the common case, and serializing them to save a share
 * read on the rare oversized one would tax every normal request to do it.
 *
 * `throwOnError` propagates a failed file read instead of letting it degrade to an empty
 * list. A caller seeding a cache needs that distinction: an empty list would be cached
 * as authoritative, telling the user the workspace has no files.
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
      ...(maxRows === undefined ? {} : { limit: maxRows + 1 }),
      ...(options?.throwOnError ? { throwOnError: true } : {}),
    }),
    getWorkspaceShares('file', workspaceId),
  ])
  if (maxRows !== undefined && files.length > maxRows) return null

  const withShares = files.map((file) => ({ ...file, share: shares.get(file.id) ?? null }))
  return listWorkspaceFilesContract.response.schema.shape.files.parse(withShares)
}
