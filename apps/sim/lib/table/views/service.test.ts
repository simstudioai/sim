/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ColumnDefinition, TableViewConfig } from '@/lib/table/types'
import { pruneViewConfig, validateTableViewConfig } from '@/lib/table/views/service'

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

  it('prunes deleted columns from nested filters without breaking the View', () => {
    const filter = {
      $or: [
        { col_gone: { $eq: 'x' } },
        { $and: [{ col_a: { $contains: 'A' } }, { col_gone: { $eq: 'y' } }] },
      ],
    }
    expect(pruneViewConfig({ filter }, columns).filter).toEqual({
      $or: [{ $and: [{ col_a: { $contains: 'A' } }] }],
    })
    expect(pruneViewConfig({ filter: { col_gone: 'x' } }, columns).filter).toBeNull()
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

describe('validateTableViewConfig', () => {
  it('accepts stable column ids and rejects display names or unknown ids', () => {
    expect(() =>
      validateTableViewConfig(
        { filter: { col_a: { $contains: 'A' } }, sort: { col_b: 'asc' } },
        columns
      )
    ).not.toThrow()
    expect(() => validateTableViewConfig({ filter: { Name: 'A' } }, columns)).toThrow(
      'Unknown View filter column: Name'
    )
    expect(() => validateTableViewConfig({ sort: { col_gone: 'desc' } }, columns)).toThrow(
      'Unknown View sort column: col_gone'
    )
  })
})
