'use client'

import { useCallback, useEffect } from 'react'
import { useQueryStates } from 'nuqs'
import type { ServedFolderResourceType } from '@/lib/api/contracts/folders'
import {
  folderNavParsers,
  folderNavUrlKeys,
} from '@/app/workspace/[workspaceId]/components/folders/search-params'
import { useFolderAncestors } from '@/app/workspace/[workspaceId]/components/folders/use-folder-ancestors'
import type { WorkflowFolder } from '@/stores/folders/types'

export interface UseFolderNavigationOptions {
  resourceType: ServedFolderResourceType
  workspaceId?: string
}

export interface FolderNavigation {
  /** The open folder, or `null` at the workspace root. */
  currentFolderId: string | null
  setCurrentFolderId: (folderId: string | null) => void
  /**
   * Root-first ancestor chain of the open folder, the open folder last. Empty at the root,
   * and empty while the folder list is still loading or when the id no longer resolves (a
   * deleted folder or a stale bookmark) — callers fall back to the root listing rather than
   * rendering a broken trail.
   */
  breadcrumbs: WorkflowFolder[]
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

/**
 * URL-backed folder navigation for a foldered resource list. Deliberately
 * resourceType-agnostic — the Workflows, Files, Knowledge, and Tables trees are separate
 * folder hierarchies over one table, so the caller names its own tree and gets that tree's
 * folders, navigation state, and ancestor chain.
 *
 * The open folder lives in the URL rather than component state because it is shareable,
 * bookmarkable, and belongs in the back stack (see `.claude/rules/sim-url-state.md`).
 */
export function useFolderNavigation({
  resourceType,
  workspaceId,
}: UseFolderNavigationOptions): FolderNavigation {
  const [{ folderId: currentFolderId }, setFolderParams] = useQueryStates(
    folderNavParsers,
    folderNavUrlKeys
  )

  const { ancestors, folders, folderById, foldersResolved } = useFolderAncestors({
    resourceType,
    workspaceId,
    folderId: currentFolderId,
  })

  const setCurrentFolderId = useCallback(
    (folderId: string | null) => {
      void setFolderParams({ folderId })
    },
    [setFolderParams]
  )

  /**
   * Heals a `?folderId=` that no longer resolves — a bookmark to a folder since deleted, or a
   * link from someone whose workspace it was not.
   *
   * Without this the page is a dead end rather than a mistake: the header falls back to the
   * root title while the list still filters on the dead id, so the user sees a page that looks
   * like the root but is empty and hides everything actually at the root. Worse, the create
   * and upload actions keep targeting that id, so a new resource is filed somewhere nothing
   * can reach.
   *
   * Gated on {@link FolderNavigation.foldersResolved} so an empty or stale index never evicts a
   * perfectly good id.
   */
  useEffect(() => {
    if (!foldersResolved || !currentFolderId || folderById.has(currentFolderId)) return
    /**
     * `history: 'replace'`, overriding the `push` these params default to. Opening a folder is
     * a navigation and belongs in the back stack; correcting a URL that never pointed anywhere
     * is not. Pushing here strands the user: Back returns to the dead `?folderId=`, which heals
     * and pushes again, so Back never escapes the page.
     */
    void setFolderParams({ folderId: null }, { history: 'replace' })
  }, [foldersResolved, currentFolderId, folderById, setFolderParams])

  return {
    currentFolderId,
    setCurrentFolderId,
    breadcrumbs: ancestors,
    folders,
    folderById,
    foldersResolved,
  }
}
