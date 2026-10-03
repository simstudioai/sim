import type { folder } from '@sim/db/schema'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { withFolderTreeLock } from '@/lib/folders/locks'
import type { FolderPathIndex } from '@/lib/folders/paths'
import { ROOT_FOLDER_PATH } from '@/lib/folders/paths'
import { loadActiveFolderPathIndex, resolveFolderPathFromIndex } from '@/lib/folders/queries'
import { MAX_KNOWLEDGE_FOLDERS_PER_WORKSPACE } from '@/lib/knowledge/constants'

type FolderRow = typeof folder.$inferSelect

export async function resolveKnowledgeFolderPath(
  workspaceId: string,
  path: string
): Promise<{ folderId: string | null; index: FolderPathIndex<FolderRow> }> {
  return withFolderTreeLock(workspaceId, 'knowledge_base', async (tx) => {
    const index = await loadActiveFolderPathIndex(workspaceId, 'knowledge_base', tx, {
      maxRows: MAX_KNOWLEDGE_FOLDERS_PER_WORKSPACE,
    })
    const folderId = resolveFolderPathFromIndex(index, path)
    if (folderId === undefined) throw new OrchestrationError('not_found', 'Folder not found')
    return { folderId, index }
  })
}

/**
 * Renders a knowledge base's containing-folder path from the active folder index.
 *
 * A folder id the index does not hold reports the workspace root rather than
 * throwing. The index covers *active* folders only, so an archived knowledge base
 * whose containing folder was archived with it — or one whose folder was deleted
 * underneath it — resolves to nothing, and a well-formed read of that row must not
 * become a 500. Matches the v2 files projection, which falls back to `/` for the
 * same reason.
 */
export function knowledgeFolderPathForId(
  index: FolderPathIndex<FolderRow>,
  folderId: string | null | undefined
): string {
  if (!folderId) return ROOT_FOLDER_PATH
  return index.pathById.get(folderId) ?? ROOT_FOLDER_PATH
}
