/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ColumnDefinition, TableViewConfig } from '@/lib/table/types'
import { pruneViewConfig } from '@/lib/table/views/service'

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
    expect(pruneViewConfig({ sort: { col_gone: 'asc' } }, columns).sort).toBeNull()
    expect(pruneViewConfig({ sort: { col_a: 'desc' } }, columns).sort).toEqual({ col_a: 'desc' })
  })

  it('leaves the filter untouched even when it references a deleted column', () => {
    // Pruning a predicate would silently widen the view's row set — surfacing a
    // stale condition the user can see and remove is the safer failure.
    const filter = { col_gone: { $eq: 'x' } }
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
