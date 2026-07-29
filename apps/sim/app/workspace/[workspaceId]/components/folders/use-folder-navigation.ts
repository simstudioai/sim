'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useQueryStates } from 'nuqs'
import type { ServedFolderResourceType } from '@/lib/api/contracts/folders'
import {
  folderNavParsers,
  folderNavUrlKeys,
} from '@/app/workspace/[workspaceId]/components/folders/search-params'
import { useFolders } from '@/hooks/queries/folders'
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
  isLoading: boolean
}

const EMPTY_FOLDERS: WorkflowFolder[] = []

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

  const { data: folders = EMPTY_FOLDERS, isLoading } = useFolders(workspaceId, { resourceType })

  const setCurrentFolderId = useCallback(
    (folderId: string | null) => {
      void setFolderParams({ folderId })
    },
    [setFolderParams]
  )

  const folderById = useMemo(() => {
    const byId = new Map<string, WorkflowFolder>()
    for (const folder of folders) byId.set(folder.id, folder)
    return byId
  }, [folders])

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
   * Waits for `isLoading` so an empty index mid-fetch never evicts a perfectly good id.
   */
  useEffect(() => {
    if (isLoading || !currentFolderId || folderById.has(currentFolderId)) return
    void setFolderParams({ folderId: null })
  }, [isLoading, currentFolderId, folderById, setFolderParams])

  const breadcrumbs = useMemo(() => {
    if (!currentFolderId) return EMPTY_FOLDERS

    /**
     * Walks up via `parentId` rather than splitting a materialized path — the generic
     * folder table stores no path — and guards against a cycle, which the DB permits
     * between constraint checks. An unresolvable link collapses the whole trail so the
     * header falls back to the root title instead of rendering a partial path.
     */
    const chain: WorkflowFolder[] = []
    const seen = new Set<string>()
    let cursor: string | null = currentFolderId

    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const folder: WorkflowFolder | undefined = folderById.get(cursor)
      if (!folder) return EMPTY_FOLDERS
      chain.unshift(folder)
      cursor = folder.parentId
    }

    return chain
  }, [currentFolderId, folderById])

  return {
    currentFolderId,
    setCurrentFolderId,
    breadcrumbs,
    folders,
    folderById,
    isLoading,
  }
}
