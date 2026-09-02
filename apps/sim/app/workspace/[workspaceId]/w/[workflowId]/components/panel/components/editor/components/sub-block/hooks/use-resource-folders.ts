'use client'

import { useCallback, useMemo } from 'react'
import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { useQueryClient } from '@tanstack/react-query'
import type { FolderResourceType } from '@/lib/api/contracts/folders'
import { useWorkspaceInvalidationRoom } from '@/app/workspace/[workspaceId]/hooks/use-workspace-invalidation-room'
import { useFolders } from '@/hooks/queries/folders'
import { getCanonicalFolderPath } from '@/hooks/queries/utils/folder-tree'
import {
  invalidateWorkspaceFileBrowsers,
  useWorkspaceFileFolders,
} from '@/hooks/queries/workspace-file-folders'
import type { WorkflowFolder } from '@/stores/folders/types'

export interface ResourceFolder {
  id: string
  name: string
  parentId: string | null
  sortOrder: number
  /** Canonical percent-encoded path, the value every folder tool accepts. */
  path: string
}

export interface UseResourceFoldersResult {
  folders: ResourceFolder[]
  /** Canonical path keyed by folder id, for resolving a stored value back to a row. */
  byPath: Map<string, ResourceFolder>
  isLoading: boolean
}

/**
 * Loads a workspace's folders for one resource type and gives each its canonical
 * path.
 *
 * The split this hides is real and easy to trip over: `/api/folders` serves
 * `workflow`, `knowledge_base`, and `table`, but **not** `file`, which has its
 * own route and its own record shape. Every folder picker would otherwise have
 * to branch on resource type itself.
 *
 * Paths are derived on the client from `parentId` and `name` rather than read
 * from the server, because the file record's stored `path` is a
 * backslash-escaped display path while the tools take the percent-encoded
 * canonical form. Deriving both the same way keeps one representation in the UI.
 */
export function useResourceFolders(
  workspaceId: string | undefined,
  resourceType: FolderResourceType
): UseResourceFoldersResult {
  const isFileResource = resourceType === 'file'

  const generic = useFolders(workspaceId, {
    resourceType: isFileResource ? 'workflow' : resourceType,
    enabled: Boolean(workspaceId) && !isFileResource,
  })
  const files = useWorkspaceFileFolders(workspaceId ?? '', 'active', {
    enabled: Boolean(workspaceId) && isFileResource,
  })

  /*
   * A workflow run mutates folders on the server, far outside React Query, so
   * nothing here would refetch until the list went stale on its own — the tree
   * kept showing pre-move paths until a page reload. The file use cases already
   * broadcast `workspace-files-changed`; until now only the Files browser
   * listened. Joining the same room here makes every folder tree live.
   *
   * Passing an empty workspace id is the documented no-op for a room hook, which
   * is how this stays unsubscribed for the resource types that have no such
   * broadcast (knowledge bases and tables still wait out their stale time).
   */
  const queryClient = useQueryClient()
  const onFilesChanged = useCallback(() => {
    if (workspaceId) invalidateWorkspaceFileBrowsers(queryClient, workspaceId)
  }, [queryClient, workspaceId])
  useWorkspaceInvalidationRoom(
    isFileResource ? (workspaceId ?? '') : '',
    ROOM_TYPES.WORKSPACE_FILES,
    onFilesChanged
  )

  const rows = useMemo<WorkflowFolder[]>(() => {
    if (isFileResource) {
      return (files.data ?? []).map((folder) => ({
        id: folder.id,
        resourceType: 'file' as const,
        name: folder.name,
        userId: folder.userId,
        workspaceId: folder.workspaceId,
        parentId: folder.parentId,
        locked: false,
        sortOrder: folder.sortOrder,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        deletedAt: folder.deletedAt,
      }))
    }
    return generic.data ?? []
  }, [isFileResource, files.data, generic.data])

  return useMemo(() => {
    const byId = new Map(rows.map((row) => [row.id, row]))
    const folders: ResourceFolder[] = []
    for (const row of rows) {
      let path: string
      try {
        path = getCanonicalFolderPath(row.id, byId)
      } catch {
        /*
         * A cycle or a missing parent is reachable from the client cache, which
         * holds optimistic reorder writes. Skipping the row keeps the picker
         * usable instead of failing the whole panel over one bad edge.
         */
        continue
      }
      folders.push({
        id: row.id,
        name: row.name,
        parentId: row.parentId,
        sortOrder: row.sortOrder,
        path,
      })
    }
    folders.sort((a, b) => a.path.localeCompare(b.path))

    return {
      folders,
      byPath: new Map(folders.map((folder) => [folder.path, folder])),
      isLoading: isFileResource ? files.isLoading : generic.isLoading,
    }
  }, [rows, isFileResource, files.isLoading, generic.isLoading])
}
