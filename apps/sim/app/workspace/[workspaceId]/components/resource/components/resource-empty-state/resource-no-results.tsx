import { Chip } from '@sim/emcn'
import { EmptyState } from '@/components/empty-state/empty-state'

interface ResourceNoResultsProps {
  /**
   * The query the rows were actually filtered by — the debounced value, never the instant
   * URL one, or the copy names a query the list has not run yet. Empty when only filters
   * narrowed the list.
   */
  search: string
  /** Applied filter chips, so the copy can name filters as the thing that matched nothing. */
  filterCount: number
  /** Clears the query and every filter, restoring the open folder's contents. */
  onClear: () => void
}

/**
 * What a foldered list shows when a search or filter matched nothing.
 *
 * Distinct from the resource's zero-data graphic, which invites you to create your first
 * item and would be a lie here — see {@link resourceListState}. Without this the table
 * renders an unexplained blank, which reads as a broken page rather than an empty result.
 *
 * Both descriptions state a scope the user cannot otherwise see, which is what earns them a
 * line at all: a search spans every folder, so a bare "no results" while standing inside one
 * invites exactly the wrong conclusion — that they should go looking elsewhere themselves —
 * while filters narrow only the open folder. The search branch wins when both are set,
 * because the wider scope is the more surprising of the two.
 */
export function ResourceNoResults({ search, filterCount, onClear }: ResourceNoResultsProps) {
  const trimmed = search.trim()
  return (
    <EmptyState
      title={trimmed ? `No results for “${trimmed}”` : 'No results'}
      description={
        trimmed ? 'Searched every folder in this workspace.' : 'Filters apply to this folder only.'
      }
      action={
        <Chip variant='border' onClick={onClear}>
          {trimmed && filterCount > 0
            ? 'Clear search and filters'
            : trimmed
              ? 'Clear search'
              : 'Clear filters'}
        </Chip>
      }
    />
  )
}
