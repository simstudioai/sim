import type { folder } from '@sim/db/schema'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { withFolderTreeLock } from '@/lib/folders/locks'
import type { FolderPathIndex } from '@/lib/folders/paths'
import { ROOT_FOLDER_PATH } from '@/lib/folders/paths'
import { loadActiveFolderPathIndex, resolveFolderPathFromIndex } from '@/lib/folders/queries'

type FolderRow = typeof folder.$inferSelect

export interface ResolvedTableFolderPath {
  folderId: string | null
  index: FolderPathIndex<FolderRow>
}

export async function resolveTableFolderPath(
  workspaceId: string,
  path: string
): Promise<ResolvedTableFolderPath | null> {
  return withFolderTreeLock(workspaceId, 'table', async (tx) => {
    const index = await loadActiveFolderPathIndex(workspaceId, 'table', tx, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    const folderId = resolveFolderPathFromIndex(index, path)
    return folderId === undefined ? null : { folderId, index }
  })
}

export function tableFolderPathForId(
  index: FolderPathIndex<FolderRow>,
  folderId: string | null | undefined
): string {
  if (!folderId) return ROOT_FOLDER_PATH
  const path = index.pathById.get(folderId)
  if (!path) throw new Error('Table references an inactive or missing folder')
  return path
}

/**
 * The same projection for a table that may itself be archived.
 *
 * Archiving a folder cascades onto the tables inside it but leaves their
 * `folderId` pointing at the now-inactive row — which is exactly why restore has
 * to re-root a dangling `folderId`. So on any read that can surface an archived
 * table, an unresolvable folder is the expected state rather than the
 * inconsistency {@link tableFolderPathForId} treats it as, and one such row
 * would otherwise throw a bare `Error` and 500 the whole page with no cursor
 * position able to skip past it.
 *
 * The root is the honest answer: it is where restore would put the table if the
 * caller restored it now.
 */
export function archivableTableFolderPath(
  index: FolderPathIndex<FolderRow>,
  folderId: string | null | undefined
): string {
  if (!folderId) return ROOT_FOLDER_PATH
  return index.pathById.get(folderId) ?? ROOT_FOLDER_PATH
}
