'use client'

import { useCallback, useEffect } from 'react'
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
}

export interface FolderNavigation extends FolderAncestors {
  /** The open folder, or `null` at the workspace root. */
  currentFolderId: string | null
  /**
   * Opens a folder. Defaults to the param group's `history: 'push'` — a folder the user chose
   * to open is a destination. Pass `{ history: 'replace' }` for a write that is not a chosen
   * navigation, such as the second and later spring-opens within a single drag.
   */
  setCurrentFolderId: (folderId: string | null, options?: { history?: 'push' | 'replace' }) => void
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

  return { ...ancestry, currentFolderId, setCurrentFolderId }
}
