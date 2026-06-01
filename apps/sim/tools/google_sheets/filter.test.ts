/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { filterSheetRows } from '@/tools/google_sheets/filter'

const VALUES: unknown[][] = [
  ['Name', 'Email', 'Status', 'Score'],
  ['Alice', 'alice@example.com', 'Active', '90'],
  ['Bob', 'bob@test.com', 'Closed', '40'],
  ['Carol', 'carol@example.com', 'Active', '7'],
]

describe('filterSheetRows', () => {
  it('passes values through unchanged when no filter column is provided', () => {
    const result = filterSheetRows(VALUES, {})
    expect(result.applied).toBe(false)
    expect(result.values).toBe(VALUES)
    expect(result.totalRows).toBe(3)
  })

  it('passes through when filterValue is empty', () => {
    const result = filterSheetRows(VALUES, { filterColumn: 'Status', filterValue: '' })
    expect(result.applied).toBe(false)
    expect(result.values).toBe(VALUES)
  })

  it('defaults to case-insensitive contains', () => {
    const result = filterSheetRows(VALUES, { filterColumn: 'status', filterValue: 'active' })
    expect(result.applied).toBe(true)
    expect(result.columnFound).toBe(true)
    expect(result.values).toEqual([VALUES[0], VALUES[1], VALUES[3]])
    expect(result.matchedRows).toBe(2)
  })

  it('matches column names case-insensitively and trims whitespace', () => {
    const result = filterSheetRows(VALUES, {
      filterColumn: '  EMAIL ',
      filterValue: 'example.com',
    })
    expect(result.columnFound).toBe(true)
    expect(result.matchedRows).toBe(2)
  })

  it('supports exact and not_equals', () => {
    expect(
      filterSheetRows(VALUES, {
        filterColumn: 'Status',
        filterValue: 'Active',
        filterMatchType: 'exact',
      }).matchedRows
    ).toBe(2)
    expect(
      filterSheetRows(VALUES, {
        filterColumn: 'Status',
        filterValue: 'Active',
        filterMatchType: 'not_equals',
      }).matchedRows
    ).toBe(1)
  })

  it('supports starts_with, ends_with, and not_contains', () => {
    expect(
      filterSheetRows(VALUES, {
        filterColumn: 'Email',
        filterValue: 'bob',
        filterMatchType: 'starts_with',
      }).matchedRows
    ).toBe(1)
    expect(
      filterSheetRows(VALUES, {
        filterColumn: 'Email',
        filterValue: '.com',
        filterMatchType: 'ends_with',
      }).matchedRows
    ).toBe(3)
    expect(
      filterSheetRows(VALUES, {
        filterColumn: 'Email',
        filterValue: 'example.com',
        filterMatchType: 'not_contains',
      }).matchedRows
    ).toBe(1)
  })

  it('compares numerically for ordering operators (not substring)', () => {
    const gt = filterSheetRows(VALUES, {
      filterColumn: 'Score',
      filterValue: '50',
      filterMatchType: 'gt',
    })
    expect(gt.matchedRows).toBe(1)
    expect(gt.values).toEqual([VALUES[0], VALUES[1]])

    expect(
      filterSheetRows(VALUES, {
        filterColumn: 'Score',
        filterValue: '40',
        filterMatchType: 'gte',
      }).matchedRows
    ).toBe(2)
    expect(
      filterSheetRows(VALUES, {
        filterColumn: 'Score',
        filterValue: '40',
        filterMatchType: 'lt',
      }).matchedRows
    ).toBe(1)
    expect(
      filterSheetRows(VALUES, {
        filterColumn: 'Score',
        filterValue: '40',
        filterMatchType: 'lte',
      }).matchedRows
    ).toBe(2)
  })

  it('orders negative numbers correctly', () => {
    const temps: unknown[][] = [
      ['City', 'Temp'],
      ['A', '-5'],
      ['B', '0'],
      ['C', '-12'],
      ['D', '3'],
    ]
    expect(
      filterSheetRows(temps, { filterColumn: 'Temp', filterValue: '-5', filterMatchType: 'gte' })
        .matchedRows
    ).toBe(3)
    expect(
      filterSheetRows(temps, { filterColumn: 'Temp', filterValue: '0', filterMatchType: 'lt' })
        .matchedRows
    ).toBe(2)
  })

  it('excludes blank and non-numeric cells from numeric comparisons', () => {
    const scores: unknown[][] = [
      ['Name', 'Score'],
      ['Alice', '90'],
      ['Bob', ''],
      ['Carol', 'N/A'],
      ['Dan', '60'],
    ]
    const result = filterSheetRows(scores, {
      filterColumn: 'Score',
      filterValue: '50',
      filterMatchType: 'gt',
    })
    expect(result.matchedRows).toBe(2)
    expect(result.values).toEqual([scores[0], scores[1], scores[4]])
  })

  it('falls back to lexicographic ordering when values are not numeric (ISO dates)', () => {
    const dated: unknown[][] = [
      ['Task', 'Due'],
      ['A', '2026-01-15'],
      ['B', '2026-03-01'],
      ['C', '2025-12-31'],
    ]
    const result = filterSheetRows(dated, {
      filterColumn: 'Due',
      filterValue: '2026-01-01',
      filterMatchType: 'gte',
    })
    expect(result.matchedRows).toBe(2)
  })

  it('reports columnFound=false and leaves values unchanged when the column is missing', () => {
    const result = filterSheetRows(VALUES, {
      filterColumn: 'Nonexistent',
      filterValue: 'x',
    })
    expect(result.applied).toBe(false)
    expect(result.columnFound).toBe(false)
    expect(result.matchedRows).toBe(0)
    expect(result.values).toBe(VALUES)
    expect(result.totalRows).toBe(3)
  })

  it('handles a header-only sheet and reports the column as found when it exists', () => {
    const headerOnly: unknown[][] = [['Name', 'Status']]
    const result = filterSheetRows(headerOnly, { filterColumn: 'Status', filterValue: 'Active' })
    expect(result.applied).toBe(false)
    expect(result.columnFound).toBe(true)
    expect(result.matchedRows).toBe(0)
    expect(result.totalRows).toBe(0)
    expect(result.values).toBe(headerOnly)
  })

  it('reports columnFound=false for a header-only sheet when the column is absent', () => {
    const headerOnly: unknown[][] = [['Name', 'Status']]
    const result = filterSheetRows(headerOnly, { filterColumn: 'Nonexistent', filterValue: 'x' })
    expect(result.applied).toBe(false)
    expect(result.columnFound).toBe(false)
    expect(result.matchedRows).toBe(0)
    expect(result.values).toBe(headerOnly)
  })

  it('reports columnFound=false for an empty values array', () => {
    const empty: unknown[][] = []
    const result = filterSheetRows(empty, { filterColumn: 'Status', filterValue: 'Active' })
    expect(result.applied).toBe(false)
    expect(result.columnFound).toBe(false)
    expect(result.matchedRows).toBe(0)
    expect(result.totalRows).toBe(0)
  })

  it('treats missing cells as empty strings', () => {
    const sparse: unknown[][] = [['Name', 'Status'], ['Alice'], ['Bob', 'Active']]
    const result = filterSheetRows(sparse, {
      filterColumn: 'Status',
      filterValue: 'Active',
      filterMatchType: 'exact',
    })
    expect(result.matchedRows).toBe(1)
    expect(result.values).toEqual([sparse[0], sparse[2]])
  })

  it('always retains the header row in filtered output', () => {
    const result = filterSheetRows(VALUES, {
      filterColumn: 'Status',
      filterValue: 'no-match',
      filterMatchType: 'exact',
    })
    expect(result.values).toEqual([VALUES[0]])
    expect(result.matchedRows).toBe(0)
  })
})
