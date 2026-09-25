import { tableViews } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { tableEventsMock, tableEventsMockFns } from '@sim/testing/mocks/table-events.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TABLE_LIMITS } from '@/lib/table/constants'
import type { ColumnDefinition, TableViewConfig } from '@/lib/table/types'

vi.mock('@/lib/table/events', () => tableEventsMock)

import {
  createTableView,
  deleteTableView,
  getTableView,
  normalizeStoredViewConfig,
  pruneViewConfig,
  updateTableView,
} from '@/lib/table/views/service'

const mockSignalTableViewsChanged = tableEventsMockFns.mockSignalTableViewsChanged

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
    resetDbChainMock()
  })

  it('createTableView with isDefault demotes the current default in the same transaction', async () => {
    queueTableRows(tableViews, [{ total: 2 }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ ...viewRow, isDefault: true }])

    await createTableView({
      tableId: 'table-1',
      workspaceId: 'ws-1',
      name: 'My View',
      config: {},
      userId: 'user-1',
      columns,
      isDefault: true,
    })

    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      isDefault: false,
      updatedAt: expect.any(Date),
    })
    expect(dbChainMockFns.values).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }))
  })

  it('updateTableView returns the canonical view without writing or signaling on a true no-op', async () => {
    queueTableRows(tableViews, [viewRow])

    const result = await updateTableView({
      viewId: 'view-1',
      tableId: 'table-1',
      workspaceId: 'ws-1',
      name: viewRow.name,
      config: viewRow.config,
      isDefault: viewRow.isDefault,
      columns,
    })

    expect(result).toMatchObject({ id: 'view-1', name: 'My View', isDefault: false })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockSignalTableViewsChanged).not.toHaveBeenCalled()
  })

  it('deleteTableView refuses to delete the last remaining view', async () => {
    queueTableRows(tableViews, [{ id: 'view-1' }])

    await expect(deleteTableView('view-1', 'table-1')).rejects.toThrow(
      'A table must keep at least one saved view'
    )
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(mockSignalTableViewsChanged).not.toHaveBeenCalled()
  })
})

describe('getTableView', () => {
  const columns: ColumnDefinition[] = [{ id: 'col_a', name: 'Name', type: 'text' }]

  beforeEach(() => {
    resetDbChainMock()
  })

  it('prunes stale column references the same way the list read does', async () => {
    queueTableRows(tableViews, [
      {
        id: 'view-1',
        tableId: 'table-1',
        workspaceId: 'ws-1',
        name: 'My View',
        config: { columnOrder: ['col_a', 'col_gone'], hiddenColumns: ['col_gone'] },
        isDefault: false,
        createdBy: 'user-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])

    const view = await getTableView('view-1', 'table-1', columns)

    expect(view?.config.columnOrder).toEqual(['col_a'])
    expect(view?.config.hiddenColumns).toEqual([])
  })
})

describe('view config name/id translation', () => {
  const columns = [
    { id: 'col_a', name: 'status', type: 'string' },
    { id: 'col_b', name: 'due', type: 'date' },
  ] as never[]

  it('round-trips a config between id and name domains', async () => {
    const { viewConfigIdsToNames, viewConfigNamesToIds } = await import('@/lib/table/views/service')
    const stored = {
      filter: {
        any: [
          { field: 'col_a', op: 'eq', value: 'Open' },
          { all: [{ field: 'col_b', op: 'isNotNull' }] },
        ],
      },
      sort: [{ field: 'col_b', direction: 'desc' }],
      hiddenColumns: ['col_a'],
    } as never
    const named = viewConfigIdsToNames(stored, columns as never)
    expect(named.filter).toEqual({
      any: [
        { field: 'status', op: 'eq', value: 'Open' },
        { all: [{ field: 'due', op: 'isNotNull' }] },
      ],
    })
    expect(named.sort).toEqual([{ field: 'due', direction: 'desc' }])
    expect(named.hiddenColumns).toEqual(['status'])
    expect(viewConfigNamesToIds(named, columns as never)).toEqual(stored)
  })

  it('passes stale ids through on read but rejects unknown names on write', async () => {
    const { viewConfigIdsToNames, viewConfigNamesToIds } = await import('@/lib/table/views/service')
    const withStale = { filter: { all: [{ field: 'col_gone', op: 'isNull' }] } } as never
    expect(
      (
        viewConfigIdsToNames(withStale, columns as never).filter as never as {
          all: { field: string }[]
        }
      ).all[0].field
    ).toBe('col_gone')
    expect(() =>
      viewConfigNamesToIds(
        { filter: { all: [{ field: 'nope', op: 'isNull' }] } } as never,
        columns as never
      )
    ).toThrow(/Unknown column/)
  })
})

describe('saved-view ceiling', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  function create() {
    return createTableView({
      tableId: 'table-1',
      workspaceId: 'ws-1',
      name: 'Another View',
      config: {},
      userId: 'user-1',
      columns: [],
    })
  }

  it('refuses a create that would cross MAX_VIEWS_PER_TABLE', async () => {
    queueTableRows(tableViews, [{ total: TABLE_LIMITS.MAX_VIEWS_PER_TABLE }])

    await expect(create()).rejects.toMatchObject({ name: 'TableViewValidationError' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mockSignalTableViewsChanged).not.toHaveBeenCalled()
  })
})

describe('view config column-reference normalization', () => {
  const columns: ColumnDefinition[] = [
    { id: 'col_a', name: 'Name', type: 'text' },
    { id: 'col_b', name: 'Email', type: 'text' },
  ]
  const storedRow = {
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
    resetDbChainMock()
  })

  function insertedConfig(): TableViewConfig {
    const [values] = dbChainMockFns.values.mock.calls.at(-1) as [{ config: TableViewConfig }]
    return values.config
  }

  function create(config: TableViewConfig, strictRefs = true) {
    return createTableView({
      tableId: 'table-1',
      workspaceId: 'ws-1',
      name: 'My View',
      config,
      userId: 'user-1',
      columns,
      strictRefs,
    })
  }

  it('stores a name-keyed sort as column ids instead of discarding it', async () => {
    queueTableRows(tableViews, [{ total: 0 }])
    dbChainMockFns.returning.mockResolvedValueOnce([storedRow])

    await create({ sort: [{ field: 'Name', direction: 'desc' }] })

    expect(insertedConfig().sort).toEqual([{ field: 'col_a', direction: 'desc' }])
  })

  it('stores a name-keyed filter and layout as column ids', async () => {
    queueTableRows(tableViews, [{ total: 0 }])
    dbChainMockFns.returning.mockResolvedValueOnce([storedRow])

    await create({
      filter: { all: [{ field: 'Email', op: 'eq', value: 'x@example.com' }] },
      columnOrder: ['Email', 'Name'],
      hiddenColumns: ['Name'],
      pinnedColumns: ['Email'],
      columnWidths: { Name: 200 },
    })

    expect(insertedConfig()).toEqual({
      filter: { all: [{ field: 'col_b', op: 'eq', value: 'x@example.com' }] },
      columnOrder: ['col_b', 'col_a'],
      hiddenColumns: ['col_a'],
      pinnedColumns: ['col_b'],
      columnWidths: { col_a: 200 },
    })
  })

  it('refuses a filter on a column that does not exist for a strict caller', async () => {
    queueTableRows(tableViews, [{ total: 0 }])
    dbChainMockFns.returning.mockResolvedValueOnce([storedRow])

    await expect(
      create({ filter: { all: [{ field: 'ghost', op: 'eq', value: 'x' }] } })
    ).rejects.toMatchObject({ name: 'TableViewValidationError' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('refuses a sort on a column that does not exist for a strict caller', async () => {
    queueTableRows(tableViews, [{ total: 0 }])
    dbChainMockFns.returning.mockResolvedValueOnce([storedRow])

    await expect(create({ sort: [{ field: 'ghost', direction: 'asc' }] })).rejects.toMatchObject({
      name: 'TableViewValidationError',
    })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  /**
   * A column delete leaves the referencing views behind, and `pruneViewConfig`
   * deliberately does not prune a filter. The write must therefore let the
   * already-stored reference through — otherwise the first save of anything else
   * on that view (a sort change, a hidden-column change, the Save chip's whole
   * config) 400s on a condition the user did not touch.
   */
  it('lets a save carry forward a stale filter reference the view already stored', async () => {
    const stale = { all: [{ field: 'col_gone', op: 'eq' as const, value: 'x' }] }
    queueTableRows(tableViews, [{ ...storedRow, config: { filter: stale } }])
    dbChainMockFns.returning.mockResolvedValueOnce([storedRow])

    await expect(
      updateTableView({
        viewId: 'view-1',
        tableId: 'table-1',
        config: { filter: stale, sort: [{ field: 'col_a', direction: 'asc' }] },
        columns,
      })
    ).resolves.not.toBeNull()
  })

  it('still refuses a NEW unknown reference on a view that already had a stale one', async () => {
    const stale = { all: [{ field: 'col_gone', op: 'eq' as const, value: 'x' }] }
    queueTableRows(tableViews, [{ ...storedRow, config: { filter: stale } }])

    await expect(
      updateTableView({
        viewId: 'view-1',
        tableId: 'table-1',
        config: { filter: { all: [{ field: 'col_other_ghost', op: 'eq', value: 'x' }] } },
        columns,
        strictRefs: true,
      })
    ).rejects.toMatchObject({ name: 'TableViewValidationError' })
  })

  /**
   * The carried-forward exemption exists so a dangling FILTER ref stays
   * writable, not so it becomes a valid target for a NEW layout ref. Without
   * scoping, a strict caller could store `hiddenColumns: ['col_gone']` purely
   * because `col_gone` survives in the stored filter — a layout entry the very
   * next read drops, which is the asymmetry the strict check closes.
   */
  it('refuses a NEW layout reference that resolves only via a carried-forward filter ref', async () => {
    const stale = { all: [{ field: 'col_gone', op: 'eq' as const, value: 'x' }] }
    queueTableRows(tableViews, [{ ...storedRow, config: { filter: stale } }])
    dbChainMockFns.returning.mockResolvedValueOnce([storedRow])

    await expect(
      updateTableView({
        viewId: 'view-1',
        tableId: 'table-1',
        config: { filter: stale, hiddenColumns: ['col_gone'] },
        columns,
        strictRefs: true,
      })
    ).rejects.toMatchObject({ name: 'TableViewValidationError' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})

describe('default-view writers share the views lock', () => {
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
    resetDbChainMock()
  })

  it('promoting a view takes the per-table advisory lock the create path holds', async () => {
    queueTableRows(tableViews, [{ id: 'view-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ ...viewRow, isDefault: true }])

    await updateTableView({ viewId: 'view-1', tableId: 'table-1', isDefault: true, columns })

    // withTableViewsLock issues its SET LOCAL timeouts and the advisory lock
    // through execute; the plain-transaction path never calls it.
    expect(dbChainMockFns.execute).toHaveBeenCalled()
  })

  it('demoting a view takes the same advisory lock as other default-state writers', async () => {
    queueTableRows(tableViews, [{ ...viewRow, isDefault: true }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ ...viewRow, isDefault: false }])

    await updateTableView({ viewId: 'view-1', tableId: 'table-1', isDefault: false, columns })

    expect(dbChainMockFns.execute).toHaveBeenCalled()
  })
})
