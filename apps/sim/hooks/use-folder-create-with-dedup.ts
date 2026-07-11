import { useCallback } from 'react'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { useCreateFolder } from '@/hooks/queries/folders'
import type { Folder, FolderResourceType } from '@/stores/folders/types'

const logger = createLogger('useFolderCreateWithDedup')

/** Minimal shape required to dedupe a new folder's name against its siblings. */
export interface DedupFolder {
  name: string
  parentId: string | null
}

interface UseFolderCreateWithDedupProps<TFolder extends DedupFolder> {
  workspaceId: string | undefined
  resourceType: FolderResourceType
  folders: TFolder[]
  currentFolderId: string | null
  createFolder: ReturnType<typeof useCreateFolder>
  /** Runs after a successful create — e.g. kicking off inline rename on the new row. */
  onCreated: (folder: Folder) => void
  /** Base name before the "(N)" dedup suffix. Defaults to `'New folder'`. */
  baseName?: string
}

/**
 * Creates a new folder under `currentFolderId`, deduping its name against
 * existing siblings ("New folder", "New folder (1)", "New folder (2)", …).
 * Shared by every folder-scoped resource page (files/knowledge/tables) so
 * the dedup-numbering loop exists exactly once.
 */
export function useFolderCreateWithDedup<TFolder extends DedupFolder>({
  workspaceId,
  resourceType,
  folders,
  currentFolderId,
  createFolder,
  onCreated,
  baseName = 'New folder',
}: UseFolderCreateWithDedupProps<TFolder>): () => Promise<void> {
  return useCallback(async () => {
    if (!workspaceId) return
    const existingNames = new Set(
      folders
        .filter((folder) => (folder.parentId ?? null) === currentFolderId)
        .map((folder) => folder.name)
    )
    let name = baseName
    let counter = 1
    while (existingNames.has(name)) {
      name = `${baseName} (${counter})`
      counter++
    }

    try {
      const folder = await createFolder.mutateAsync({
        workspaceId,
        resourceType,
        name,
        parentId: currentFolderId ?? undefined,
      })
      onCreated(folder)
    } catch (error) {
      logger.error('Failed to create folder:', error)
      toast.error(toError(error).message)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- createFolder.mutateAsync is stable
  }, [workspaceId, folders, currentFolderId, resourceType, onCreated, baseName])
}
