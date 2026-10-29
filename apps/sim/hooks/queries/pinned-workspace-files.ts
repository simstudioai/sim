import { useMemo } from 'react'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { usePinnedIds } from '@/hooks/queries/pinned-items'
import { useWorkspaceFileLookups } from '@/hooks/queries/workspace-files'

/**
 * The pinned files in one folder (`null` for the root), looked up by id so a folder's pins can
 * lead it before any page of its list has reached them. In pin order.
 */
export function usePinnedWorkspaceFiles(
  workspaceId: string,
  folderId: string | null,
  options?: { enabled?: boolean }
): { pinnedFileIds: ReadonlySet<string>; files: WorkspaceFileRecord[] } {
  const pinnedFileIds = usePinnedIds(workspaceId, 'file')
  const ids = useMemo(() => [...pinnedFileIds], [pinnedFileIds])
  const lookups = useWorkspaceFileLookups(workspaceId, 'id', ids, options)
  const files = useMemo(
    () =>
      ids.flatMap((fileId) => {
        const file = lookups.byValue.get(fileId)
        return file && (file.folderId ?? null) === folderId ? [file] : []
      }),
    [ids, lookups.byValue, folderId]
  )
  return { pinnedFileIds, files }
}
