/**
 * @vitest-environment node
 */
import { tableViews } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ColumnDefinition, TableViewConfig } from '@/lib/table/types'

const { mockSignalTableViewsChanged } = vi.hoisted(() => ({
  mockSignalTableViewsChanged: vi.fn(),
}))
vi.mock('@/lib/table/events', () => ({
  signalTableViewsChanged: mockSignalTableViewsChanged,
}))

import {
  createTableView,
  deleteTableView,
  normalizeStoredViewConfig,
  pruneViewConfig,
  updateTableView,
} from '@/lib/table/views/service'

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

describe('table-view mutations signal collaborators', () => {
  const columns: ColumnDefinition[] = []
  const viewRow = {
    id: 'view-1',
    tableId: 'table-1',
    workspaceId: 'ws-1',
    name: 'My View',
    config: {},
    isDefault: false,
    createdBy: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('createTableView signals the table after inserting', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([viewRow])

    await createTableView({
      tableId: 'table-1',
      workspaceId: 'ws-1',
      name: 'My View',
      config: {},
      userId: 'user-1',
      columns,
    })

    expect(mockSignalTableViewsChanged).toHaveBeenCalledTimes(1)
    expect(mockSignalTableViewsChanged).toHaveBeenCalledWith('table-1')
  })

  it('updateTableView signals when the target view exists', async () => {
    queueTableRows(tableViews, [{ id: 'view-1' }]) // the in-transaction existence pre-check
    dbChainMockFns.returning.mockResolvedValueOnce([viewRow]) // the update returning

    const result = await updateTableView({
      viewId: 'view-1',
      tableId: 'table-1',
      name: 'Renamed',
      columns,
    })

    expect(result).not.toBeNull()
    expect(mockSignalTableViewsChanged).toHaveBeenCalledTimes(1)
    expect(mockSignalTableViewsChanged).toHaveBeenCalledWith('table-1')
  })

  it('updateTableView does NOT signal a no-op update on a missing view', async () => {
    // No queued existence row → the pre-check finds nothing → returns null before any write.
    const result = await updateTableView({
      viewId: 'missing',
      tableId: 'table-1',
      name: 'Renamed',
      columns,
    })

    expect(result).toBeNull()
    expect(mockSignalTableViewsChanged).not.toHaveBeenCalled()
  })

  it('deleteTableView signals when a row was actually deleted', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'view-1' }])

    const deleted = await deleteTableView('view-1', 'table-1')

    expect(deleted).toBe(true)
    expect(mockSignalTableViewsChanged).toHaveBeenCalledTimes(1)
    expect(mockSignalTableViewsChanged).toHaveBeenCalledWith('table-1')
  })

  it('deleteTableView does NOT signal when nothing was deleted', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const deleted = await deleteTableView('missing', 'table-1')

    expect(deleted).toBe(false)
    expect(mockSignalTableViewsChanged).not.toHaveBeenCalled()
  })
})
