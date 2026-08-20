import type { V2SortOrder } from '@/lib/api/contracts/v2/shared'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/**
 * Shared search, sort, and paging for the catalog reads.
 *
 * Every catalog list is a code-defined set narrowed in memory rather than an
 * ordered SQL read, so all three steps happen here and all three are shared —
 * two lists sorting the same field differently would make their cursors
 * describe different sequences under the same name.
 */

/**
 * Normalizes a search term, rejecting one that is present but blank.
 *
 * The contracts already trim and reject an empty term, so this is the guard for
 * a non-HTTP caller: a blank search that silently matched everything would be a
 * filter the caller believes applied and did not.
 */
export function normalizeCatalogSearch(search: string | undefined): string | undefined {
  if (search === undefined) return undefined
  const normalized = search.trim().toLowerCase()
  if (!normalized) throw new OrchestrationError('validation', 'search cannot be empty')
  return normalized
}

/** Whether any of a resource's searchable fields contains the term. */
export function matchesCatalogSearch(
  term: string | undefined,
  ...fields: Array<string | undefined>
): boolean {
  if (term === undefined) return true
  return fields.some((field) => field?.toLowerCase().includes(term))
}

/**
 * Orders two strings by UTF-16 code unit, deliberately not by `localeCompare`.
 *
 * A bare `localeCompare` reads the process's default locale and ICU data, so two
 * app instances started with different `LANG` values order the same set
 * differently — and an offset cursor minted on one then names a different row on
 * the other, silently skipping or repeating entries. Code-unit order is the same
 * everywhere, which is the property a cursor needs; catalog ids and names are
 * ASCII, so nothing human-visible changes.
 */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/**
 * Sorts a copy by one string field, breaking ties on `id`.
 *
 * The tie-break is what makes an offset cursor sound: two entries comparing
 * equal on the sort field must still hold a fixed order, or the position a
 * cursor names moves between requests. `id` is unique across every catalog, so
 * it fully orders each one.
 */
export function sortCatalogEntries<T extends { id: string }>(
  entries: readonly T[],
  select: (entry: T) => string,
  sortOrder: V2SortOrder
): T[] {
  const direction = sortOrder === 'desc' ? -1 : 1
  return [...entries].sort((left, right) => {
    const compared = compareCodeUnits(select(left), select(right))
    if (compared !== 0) return compared * direction
    return compareCodeUnits(left.id, right.id) * direction
  })
}

export interface CatalogPage<T> {
  entries: T[]
  offset: number
  limit: number
  hasMore: boolean
}

/** Takes one page out of an ordered sequence, reporting whether more remain. */
export function takeCatalogPage<T>(
  entries: readonly T[],
  offset: number,
  limit: number
): CatalogPage<T> {
  return {
    entries: entries.slice(offset, offset + limit),
    offset,
    limit,
    hasMore: offset + limit < entries.length,
  }
}
