/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  countLoadedTableRows,
  getNextTableRowsPageParam,
  hasMoreTableRows,
} from '@/hooks/queries/utils/table-rows-pagination'

function makePage(count: number, totalCount: number | null, startAt = 0, withOrderKey = true) {
  return {
    rows: Array.from({ length: count }, (_, i) => ({
      id: `r${startAt + i}`,
      ...(withOrderKey ? { orderKey: `k${String(startAt + i).padStart(6, '0')}` } : {}),
    })),
    totalCount,
  }
}

describe('countLoadedTableRows', () => {
  it('sums rows across pages', () => {
    expect(countLoadedTableRows([])).toBe(0)
    expect(countLoadedTableRows([makePage(3, 10), makePage(2, null, 3)])).toBe(5)
  })
})

describe('hasMoreTableRows', () => {
  it('returns false with no pages', () => {
    expect(hasMoreTableRows([])).toBe(false)
  })

  it('returns false when the last page is empty', () => {
    expect(hasMoreTableRows([makePage(1000, null), makePage(0, null, 1000)])).toBe(false)
  })

  it('returns false when the page-0 count is covered', () => {
    expect(hasMoreTableRows([makePage(3, 3)])).toBe(false)
  })

  it('returns true for a short page when the count says more exist', () => {
    // The regression this module exists for: a page shorter than the requested
    // size must never be read as end-of-table on its own.
    expect(hasMoreTableRows([makePage(36, 100)])).toBe(true)
  })

  it('returns true when the count is unknown and the last page is non-empty', () => {
    expect(hasMoreTableRows([makePage(1000, null)])).toBe(true)
  })

  it('returns false when a stale-low count is already exceeded', () => {
    expect(hasMoreTableRows([makePage(10, 5)])).toBe(false)
  })
})

describe('getNextTableRowsPageParam', () => {
  it('returns undefined when no more rows exist', () => {
    expect(getNextTableRowsPageParam([makePage(3, 3)], false)).toBeUndefined()
    expect(getNextTableRowsPageParam([makePage(1000, null), makePage(0, null)], false)).toBe(
      undefined
    )
  })

  it('returns the keyset cursor of the last loaded row on the default order', () => {
    const pages = [makePage(1000, 2000), makePage(500, null, 1000)]
    expect(getNextTableRowsPageParam(pages, false)).toEqual({
      orderKey: 'k001499',
      id: 'r1499',
    })
  })

  it('returns the loaded-row offset for sorted views, even after short pages', () => {
    const pages = [makePage(1000, 2000), makePage(36, null, 1000)]
    expect(getNextTableRowsPageParam(pages, true)).toBe(1036)
  })

  it('falls back to the loaded-row offset when the last row has no order key', () => {
    const pages = [makePage(700, 2000, 0, false)]
    expect(getNextTableRowsPageParam(pages, false)).toBe(700)
  })
})
