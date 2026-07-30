/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ColumnDefinition, TableViewConfig } from '@/lib/table/types'
import { normalizeStoredViewConfig, pruneViewConfig } from '@/lib/table/views/service'

const columns: ColumnDefinition[] = [
  { id: 'col_a', name: 'Name', type: 'text' },
  { id: 'col_b', name: 'Email', type: 'text' },
]

describe('pruneViewConfig', () => {
  it('drops layout references to columns that no longer exist', () => {
    const config: TableViewConfig = {
      columnOrder: ['col_a', 'col_gone', 'col_b'],
      pinnedColumns: ['col_gone'],
      hiddenColumns: ['col_b', 'col_gone'],
      columnWidths: { col_a: 200, col_gone: 120 },
    }

    expect(pruneViewConfig(config, columns)).toEqual({
      columnOrder: ['col_a', 'col_b'],
      pinnedColumns: [],
      hiddenColumns: ['col_b'],
      columnWidths: { col_a: 200 },
    })
  })

  it('drops a sort on a deleted column and collapses to null when none remain', () => {
    expect(
      pruneViewConfig({ sort: [{ field: 'col_gone', direction: 'asc' }] }, columns).sort
    ).toBeNull()
    expect(
      pruneViewConfig({ sort: [{ field: 'col_a', direction: 'desc' }] }, columns).sort
    ).toEqual([{ field: 'col_a', direction: 'desc' }])
  })

  it('leaves the filter untouched even when it references a deleted column', () => {
    // Pruning a predicate would silently widen the view's row set — surfacing a
    // stale condition the user can see and remove is the safer failure.
    const filter = { all: [{ field: 'col_gone', op: 'eq' as const, value: 'x' }] }
    expect(pruneViewConfig({ filter }, columns).filter).toEqual(filter)
  })

  it('leaves absent keys absent rather than materializing empty ones', () => {
    expect(pruneViewConfig({}, columns)).toEqual({})
  })

  it('falls back to column name for legacy columns with no id', () => {
    const legacy: ColumnDefinition[] = [{ name: 'Legacy', type: 'text' }]
    expect(pruneViewConfig({ hiddenColumns: ['Legacy', 'nope'] }, legacy).hiddenColumns).toEqual([
      'Legacy',
    ])
  })
})

/**
 * Reads written before the grammar switch: the feature never released, so
 * legacy-shaped configs exist only from pre-refactor testing — but they must
 * come back as v2, not render broken.
 */
describe('normalizeStoredViewConfig', () => {
  it('converts a legacy $-object filter to a predicate tree', () => {
    const out = normalizeStoredViewConfig({ filter: { col_a: { $eq: 'x' } } })
    expect(out.filter).toEqual({ all: [{ field: 'col_a', op: 'eq', value: 'x' }] })
  })

  it('converts a legacy {col: dir} sort record to an ordered spec', () => {
    const out = normalizeStoredViewConfig({ sort: { col_a: 'desc' } })
    expect(out.sort).toEqual([{ field: 'col_a', direction: 'desc' }])
  })

  it('passes v2-shaped configs through untouched', () => {
    const config = {
      filter: { all: [{ field: 'col_a', op: 'eq', value: 'x' }] },
      sort: [{ field: 'col_a', direction: 'asc' }],
    }
    expect(normalizeStoredViewConfig(config)).toEqual(config)
  })

  it('drops an unconvertible legacy filter rather than surfacing it broken', () => {
    const out = normalizeStoredViewConfig({ filter: { $bogus: [{ nested: true }] } })
    expect(out.filter).toBeNull()
  })
})
