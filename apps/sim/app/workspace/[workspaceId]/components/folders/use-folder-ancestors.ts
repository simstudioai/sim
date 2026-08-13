'use client'

import { useMemo } from 'react'
import type { ServedFolderResourceType } from '@/lib/api/contracts/folders'
import { breadcrumbFolderChain } from '@/app/workspace/[workspaceId]/components/folders/folder-breadcrumbs'
import { useFolders } from '@/hooks/queries/folders'
import type { WorkflowFolder } from '@/stores/folders/types'

export interface UseFolderAncestorsOptions {
  resourceType: ServedFolderResourceType
  workspaceId?: string
  /**
   * The folder to build the chain for — the open folder on a list page, or the resource's
   * own `folderId` on a detail page.
   */
  folderId: string | null | undefined
  /**
   * Set `false` on a surface that renders no breadcrumb trail — the embedded table view — so
   * it does not fetch a folder tree it will never show.
   */
  enabled?: boolean
}

export interface FolderAncestors {
  /**
   * Root-first ancestor chain of `folderId`, that folder last. Empty at the workspace root,
   * and empty while the folder list is still loading or when the id no longer resolves (a
   * deleted folder, a stale bookmark, a resource moved by someone else) — callers render the
   * root trail rather than a path that skips a level.
   */
  ancestors: WorkflowFolder[]
  /** Every active folder in this resource's tree, as returned by the folders API. */
  folders: WorkflowFolder[]
  folderById: Map<string, WorkflowFolder>
  /**
   * Whether `folders`/`folderById` can be trusted to be the COMPLETE set for this workspace.
   *
   * Deliberately exposed instead of `isLoading`, which is a footgun here: it is false for a
   * disabled query (no `workspaceId`), false for an errored one, and — because `useFolders`
   * sets `keepPreviousData` — false while the previous workspace's folders are still on screen
   * during a switch. A caller deciding "this resource's `folderId` does not resolve, so treat it
   * as an orphan" off `isLoading` would dump every foldered row at the root in all three.
   */
  foldersResolved: boolean
}

const EMPTY_FOLDERS: WorkflowFolder[] = []

/**
 * The folder tree for one resource type, plus the ancestor chain of a single folder in it.
 *
 * Shared by {@link useFolderNavigation} (which passes the URL's open folder) and by detail
 * pages (which pass the open resource's own `folderId`), so a table's header trail and the
 * table list's header trail are built from the same tree by the same walk.
 */
export function useFolderAncestors({
  resourceType,
  workspaceId,
  folderId,
  enabled,
}: UseFolderAncestorsOptions): FolderAncestors {
  const {
    data: folders = EMPTY_FOLDERS,
    isSuccess,
    isPlaceholderData,
  } = useFolders(workspaceId, { resourceType, enabled })

  const folderById = useMemo(() => {
    const byId = new Map<string, WorkflowFolder>()
    for (const folder of folders) byId.set(folder.id, folder)
    return byId
  }, [folders])

  const ancestors = useMemo(
    () => breadcrumbFolderChain(folderId, folderById),
    [folderId, folderById]
  )

  return {
    ancestors,
    folders,
    folderById,
    foldersResolved: isSuccess && !isPlaceholderData,
  }
}
