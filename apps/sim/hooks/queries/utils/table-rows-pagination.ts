import type { TableRowsCursor } from '@/lib/table/types'

/**
 * Infinite-rows page param: a keyset cursor on the default `(order_key, id)` order, or a numeric
 * offset for sorted views / legacy rows without an order key. `0` doubles as the first page.
 */
export type TableRowsPageParam = number | TableRowsCursor

interface TableRowsPageLike {
  rows: ReadonlyArray<{ id: string; orderKey?: string }>
  totalCount: number | null
  /**
   * Optional only so this loose page shape stays usable by callers that do not have a server
   * response to hand (tests, and the optimistic mappings). On the wire it is required — the
   * contract declares it non-optional and `requestJson` validates the response — so a real page
   * always carries it and the count fallback below is defensive, not a live path.
   */
  nextCursor?: string | null
}

/** Rows loaded across all fetched pages. */
export function countLoadedTableRows(pages: readonly TableRowsPageLike[]): number {
  return pages.reduce((sum, page) => sum + page.rows.length, 0)
}

/**
 * Whether more rows may exist past the fetched pages.
 *
 * `nextCursor` is the authoritative answer and is preferred whenever the server sent one: it is
 * non-null exactly when the drain proved an unreturned witness row, so it is correct for a page
 * cut by the byte budget as well as one cut by `limit`. Page fullness cannot answer this — a
 * byte-cut page is legitimately shorter than the requested size.
 *
 * The count rules remain as a fallback for pages cached before `nextCursor` was threaded through.
 * They are weaker: `totalCount` is advisory (computed in a separate transaction from the page
 * read), so a stale-high count self-corrects via the empty-page rule at the cost of one extra
 * request, and a stale-low count stops the drain early. A null `totalCount` is read as "unknown,
 * assume more" — which is why the `includeTotal` coercion bug made every table page forever.
 */
export function hasMoreTableRows(pages: readonly TableRowsPageLike[]): boolean {
  const lastPage = pages[pages.length - 1]
  if (!lastPage || lastPage.rows.length === 0) return false
  if (lastPage.nextCursor !== undefined) return lastPage.nextCursor !== null
  const totalCount = pages[0].totalCount
  return totalCount == null || countLoadedTableRows(pages) < totalCount
}

/**
 * Continuation for the next page: a keyset cursor from the last loaded row on the default
 * order, else the absolute offset — the actual loaded-row count, not pages × pageSize, so
 * short pages resume without gaps.
 */
export function getNextTableRowsPageParam(
  pages: readonly TableRowsPageLike[],
  sorted: boolean
): TableRowsPageParam | undefined {
  if (!hasMoreTableRows(pages)) return undefined
  const lastPage = pages[pages.length - 1]
  if (!sorted) {
    const last = lastPage.rows[lastPage.rows.length - 1]
    if (last?.orderKey) return { orderKey: last.orderKey, id: last.id }
  }
  return countLoadedTableRows(pages)
}
