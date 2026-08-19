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
export function isResourceListEmpty(input: ResourceListEmptyInput): boolean {
  return resourceListState(input) === 'empty'
}

/**
 * What a resource list should render in place of rows.
 *
 * - `rows` — rows are showing, or none have settled yet, so the table renders itself.
 * - `empty` — the workspace genuinely holds nothing; the zero-data graphic is the true answer.
 * - `no-results` — a search or filter matched nothing. Distinct from `empty`, because the
 *   copy that invites you to create your first item would be a lie, and distinct from `rows`,
 *   because rendering neither leaves an unexplained blank table.
 *
 * One function rather than two predicates: the two states share every "the rows have actually
 * arrived" condition, and when those lived in both places a new condition could be added to
 * one and silently left off the other.
 */
export function resourceListState({
  rowCount,
  isLoading,
  isPlaceholderData,
  error,
  search,
  filterCount,
  folderId = null,
  foldersResolved = true,
}: ResourceListEmptyInput): 'rows' | 'empty' | 'no-results' {
  const settled = rowCount === 0 && !isLoading && !isPlaceholderData && !error && foldersResolved
  if (!settled) return 'rows'
  const narrowed = Boolean(search.trim()) || filterCount > 0
  if (narrowed) return 'no-results'
  /** An empty subfolder is not an empty workspace, so it gets neither state. */
  return folderId === null ? 'empty' : 'rows'
}
