import type { TableRowsCursor } from '@/lib/table/types'

/**
 * Infinite-rows page param: a keyset cursor on the default `(order_key, id)` order, or a numeric
 * offset for sorted views / legacy rows without an order key. `0` doubles as the first page.
 */
export type TableRowsPageParam = number | TableRowsCursor

interface TableRowsPageLike {
  rows: ReadonlyArray<{ id: string; orderKey?: string }>
  totalCount: number | null
}

/** Rows loaded across all fetched pages. */
export function countLoadedTableRows(pages: readonly TableRowsPageLike[]): number {
  return pages.reduce((sum, page) => sum + page.rows.length, 0)
}

/**
 * Whether more rows may exist past the fetched pages. A page is terminal only when it is
 * empty or when page 0's `COUNT(*)` is already covered — never when it is merely shorter
 * than the requested page size, so a short server page can never be misread as end-of-table.
 *
 * `totalCount` is advisory (computed in a separate transaction from the page read). A
 * stale-high count self-corrects via the empty-page rule at the cost of one extra request;
 * a stale-low count (rows deleted after page 0's COUNT) stops the drain early — accepted,
 * since the view is already stale and the run-stream/interval invalidations refetch it.
 */
export function hasMoreTableRows(pages: readonly TableRowsPageLike[]): boolean {
  const lastPage = pages[pages.length - 1]
  if (!lastPage || lastPage.rows.length === 0) return false
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
