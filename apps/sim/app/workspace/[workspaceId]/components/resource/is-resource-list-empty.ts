interface ResourceListEmptyInput {
  rowCount: number
  /** The list query's first load. No rows yet means "not arrived", not "none exist". */
  isLoading: boolean
  /** The query is serving the previous key's rows while the new key refetches. */
  isPlaceholderData: boolean
  /** A failed load also leaves the list empty. */
  error: unknown
  /**
   * The search term the rows are actually filtered by — the debounced value, never the
   * instant URL one.
   */
  search: string
  filterCount: number
  /** The open folder, or `null` at the root. Omit for lists without folder navigation. */
  folderId?: string | null
  /**
   * Whether the folder tree has resolved. Folder rows share the list with resource rows,
   * so a workspace holding only folders looks empty until they arrive. Omit for lists
   * without folder navigation.
   */
  foldersResolved?: boolean
}

/**
 * Whether a resource list holds nothing, as opposed to merely showing nothing.
 *
 * A zero-data graphic invites someone to create their first item, so it may only
 * appear when that is the true answer. Every other way `rows` empties out is a
 * different message and gets gated here:
 *
 * - A search or filter that matched nothing, or an empty subfolder — the copy would
 *   be wrong. The search must be the debounced value the rows are filtered by;
 *   reading the instant URL value flashes the graphic for one debounce window after
 *   a search is cleared.
 * - The list still arriving. Server prefetches are allowed to seed nothing, and the
 *   files list deliberately seeds nothing above 300 rows — so without this the
 *   emptiest-looking screen is shown to the fullest workspaces.
 * - The query serving the previous key's rows. Filters are part of the query key and
 *   every list keeps previous data, so `isLoading` is false across a filter change.
 * - A failed load, which is not an invitation to create anything.
 * - The folder tree still resolving, for the same reason as the rows themselves: a
 *   workspace whose only contents are folders reads as empty until they land.
 */
export function isResourceListEmpty({
  rowCount,
  isLoading,
  isPlaceholderData,
  error,
  search,
  filterCount,
  folderId = null,
  foldersResolved = true,
}: ResourceListEmptyInput): boolean {
  return (
    rowCount === 0 &&
    !isLoading &&
    !isPlaceholderData &&
    !error &&
    foldersResolved &&
    folderId === null &&
    !search.trim() &&
    filterCount === 0
  )
}
