import type { BreadcrumbFolder } from '@/app/workspace/[workspaceId]/components/folders/folder-breadcrumbs'
import { breadcrumbFolderChain } from '@/app/workspace/[workspaceId]/components/folders/folder-breadcrumbs'
import type {
  ResourceCell,
  ResourceColumn,
} from '@/app/workspace/[workspaceId]/components/resource/resource'

/**
 * Whether the list is showing search results rather than a folder's contents.
 *
 * The distinction drives more than the filter: while searching, a row's folder is no
 * longer implied by the page, so the list has to say where each row lives, and an empty
 * result is a failed search rather than an empty place.
 */
export function isSearchingResources(search: string): boolean {
  return search.trim().length > 0
}

/**
 * The rows a foldered list should show.
 *
 * With no query the list is a place: the open folder's direct children, and nothing else.
 * With a query it stops being a place and searches the whole workspace, because a name you
 * only half-remember is precisely the case where you do not know which folder it is in.
 * Intersecting the two — matching the query only against the open folder — answers a
 * question nobody asks, and is indistinguishable from "no such file" when the file exists
 * one level down.
 *
 * Callers pass an already-debounced query; this runs on every keystroke's worth of state.
 */
export function scopeFolderedItems<T>(
  items: readonly T[],
  {
    currentFolderId,
    search,
    getParentId,
    getSearchText,
  }: {
    /** The open folder, or `null` at the workspace root. */
    currentFolderId: string | null
    search: string
    getParentId: (item: T) => string | null
    /**
     * The item's searchable fields. Matched one at a time rather than joined, so a query can
     * never straddle two of them — concatenating a name and a description would let the tail
     * of one and the head of the other match text that appears nowhere.
     */
    getSearchText: (item: T) => readonly (string | null | undefined)[]
  }
): T[] {
  if (!isSearchingResources(search)) {
    return items.filter((item) => getParentId(item) === currentFolderId)
  }
  const needle = search.trim().toLowerCase()
  return items.filter((item) =>
    getSearchText(item).some((field) => field?.toLowerCase().includes(needle))
  )
}

/**
 * What the location column shows when a row's folder cannot be resolved to a full path —
 * its ancestor chain is broken, so the honest answer is that we do not know where it is.
 *
 * Deliberately not `rootLabel`: this column exists to answer "where does this row live", and
 * naming the workspace root there is a specific wrong answer rather than a missing one. The
 * root case is a row with no folder at all, which is genuinely at the root.
 */
export const UNKNOWN_FOLDER_LOCATION = 'Unknown'

/**
 * Where a row lives, for the list's location column — ancestor names root-first joined by
 * `/`, or `rootLabel` for a row sitting at the workspace root.
 *
 * A chain that does not reach the root yields {@link UNKNOWN_FOLDER_LOCATION}, matching
 * {@link breadcrumbFolderChain}'s own rule that a partial path is not a shorter path, it is
 * a wrong one. Reachable when an ancestor folder was archived out from under the row.
 */
export function folderLocationLabel<T extends BreadcrumbFolder>(
  folderId: string | null | undefined,
  folderById: ReadonlyMap<string, T>,
  rootLabel: string
): string {
  if (!folderId) return rootLabel
  const chain = breadcrumbFolderChain(folderId, folderById)
  return chain.length > 0 ? chain.map((folder) => folder.name).join(' / ') : UNKNOWN_FOLDER_LOCATION
}

/**
 * The column naming each row's folder, carried only while searching: results span every
 * folder, so a name alone no longer says where a row lives. When the list is a folder's
 * contents the breadcrumb already says it.
 *
 * Defined here rather than per page so one conceptual column has one header and one width,
 * and beside {@link folderLocationLabel} because that is what fills it. Each page appends it
 * to its own columns at module scope, so the table swaps between two stable arrays rather
 * than building one per render.
 */
export const FOLDER_LOCATION_COLUMN: ResourceColumn = {
  id: 'location',
  header: 'Location',
  widthMultiplier: 1.1,
}

/**
 * The location cell a row carries while the list is not searching.
 *
 * {@link FOLDER_LOCATION_COLUMN} is absent then, so nothing renders this — which is the
 * point: resolving an ancestor chain per row to fill a column that is not on screen is work
 * every row throws away. Shared and empty so the skipped cell still has a stable identity.
 */
export const EMPTY_LOCATION_CELL: ResourceCell = {}
