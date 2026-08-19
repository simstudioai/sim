'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useQueryStates } from 'nuqs'
import type { ServedFolderResourceType } from '@/lib/api/contracts/folders'
import {
  folderNavParsers,
  folderNavUrlKeys,
} from '@/app/workspace/[workspaceId]/components/folders/search-params'
import {
  type FolderAncestors,
  useFolderAncestors,
} from '@/app/workspace/[workspaceId]/components/folders/use-folder-ancestors'

export interface UseFolderNavigationOptions {
  resourceType: ServedFolderResourceType
  workspaceId?: string
  /**
   * Runs before {@link FolderNavigation.openFolder} moves, for state the destination
   * invalidates — in practice, clearing the list's search. Not run by
   * {@link FolderNavigation.setCurrentFolderId}.
   */
  onBeforeOpenFolder?: () => void
}

export interface FolderNavigation extends FolderAncestors {
  /** The open folder, or `null` at the workspace root. */
  currentFolderId: string | null
  /**
   * Moves to a folder without side effects. For writes that are not a chosen navigation —
   * a spring-open mid-drag, which is undone when the drag ends without a drop, or the heal
   * below. Pass `{ history: 'replace' }` to keep such a write out of the back stack.
   */
  setCurrentFolderId: (folderId: string | null, options?: { history?: 'push' | 'replace' }) => void
  /**
   * Opens a folder because the user chose to, running {@link
   * UseFolderNavigationOptions.onBeforeOpenFolder} first.
   *
   * Separate from {@link FolderNavigation.setCurrentFolderId} because opening a folder ends a
   * search — the results span every folder, so the one the user picked out of them is a
   * destination, not a narrower place to keep searching — while a spring-open must not, or an
   * abandoned drag would discard the search that produced the row being dragged.
   *
   * Defaults to the param group's `history: 'push'`: a chosen folder is a destination, and
   * Back returns to the results that led there.
   */
  openFolder: (folderId: string | null, options?: { history?: 'push' | 'replace' }) => void
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
  onBeforeOpenFolder,
}: UseFolderNavigationOptions): FolderNavigation {
  const [{ folderId: currentFolderId }, setFolderParams] = useQueryStates(
    folderNavParsers,
    folderNavUrlKeys
  )

  const ancestry = useFolderAncestors({
    resourceType,
    workspaceId,
    folderId: currentFolderId,
  })
  const { folderById, foldersResolved } = ancestry

  const setCurrentFolderId = useCallback(
    (folderId: string | null, options?: { history?: 'push' | 'replace' }) => {
      void setFolderParams({ folderId }, options)
    },
    [setFolderParams]
  )

  const onBeforeOpenFolderRef = useRef(onBeforeOpenFolder)
  onBeforeOpenFolderRef.current = onBeforeOpenFolder

  /**
   * Both writes land in one URL update: nuqs batches same-tick writes across param groups and
   * escalates the batch to `push` when any of them pushes, so clearing a `history: 'replace'`
   * search alongside the folder change stays a single history entry.
   */
  const openFolder = useCallback(
    (folderId: string | null, options?: { history?: 'push' | 'replace' }) => {
      onBeforeOpenFolderRef.current?.()
      void setFolderParams({ folderId }, options)
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

  return { ...ancestry, currentFolderId, setCurrentFolderId, openFolder }
}
