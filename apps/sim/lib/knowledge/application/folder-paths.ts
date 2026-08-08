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

export function knowledgeFolderPathForId(
  index: FolderPathIndex<FolderRow>,
  folderId: string | null | undefined
): string {
  if (!folderId) return ROOT_FOLDER_PATH
  const path = index.pathById.get(folderId)
  if (!path) throw new Error('Knowledge base references an inactive or missing folder')
  return path
}
