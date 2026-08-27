/**
 * @vitest-environment node
 */
import { tableViews } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TABLE_LIMITS } from '@/lib/table/constants'
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
  getTableView,
  getTableViewTableId,
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

  /**
   * `config` is a schemaless JSONB blob and the config schemas are `.strict()`,
   * so anything the stored row carries beyond the declared shape would fail the
   * response parse and turn a legacy row into a 500. The read projects onto the
   * canonical keys instead.
   */
  it('drops a stored key the current config shape does not declare', () => {
    const out = normalizeStoredViewConfig({ columnOrder: ['col_a'], groupBy: 'col_a' })
    expect(out).toEqual({ columnOrder: ['col_a'] })
  })

  it('drops a stored per-sort option the sort spec does not declare', () => {
    const out = normalizeStoredViewConfig({
      sort: [{ field: 'col_a', direction: 'asc', nulls: 'last' }],
    })
    expect(out.sort).toEqual([{ field: 'col_a', direction: 'asc' }])
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

  it.each([
    { existingTotal: 0, isDefault: true },
    { existingTotal: 1, isDefault: false },
  ])(
    'creates a view with isDefault=$isDefault when $existingTotal views already exist',
    async ({ existingTotal, isDefault }) => {
      queueTableRows(tableViews, [{ total: existingTotal }])
      dbChainMockFns.returning.mockResolvedValueOnce([{ ...viewRow, isDefault }])

      await createTableView({
        tableId: 'table-1',
        workspaceId: 'ws-1',
        name: 'My View',
        config: {},
        userId: 'user-1',
        columns,
      })

      expect(dbChainMockFns.values).toHaveBeenCalledWith(expect.objectContaining({ isDefault }))
    }
  )

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

    expect(dbChainMockFns.set).toHaveBeenCalledWith({ isDefault: false })
    expect(dbChainMockFns.values).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }))
  })

  it('createTableView without isDefault never demotes, even on a first view (which is default anyway)', async () => {
    queueTableRows(tableViews, [{ total: 0 }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ ...viewRow, isDefault: true }])

    await createTableView({
      tableId: 'table-1',
      workspaceId: 'ws-1',
      name: 'My View',
      config: {},
      userId: 'user-1',
      columns,
      isDefault: false,
    })

    expect(dbChainMockFns.set).not.toHaveBeenCalled()
    expect(dbChainMockFns.values).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }))
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

  it('deleteTableView signals when a row was actually deleted', async () => {
    queueTableRows(tableViews, [{ id: 'view-1' }, { id: 'view-2' }]) // the in-lock sibling check
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'view-1' }])

    const deleted = await deleteTableView('view-1', 'table-1')

    expect(deleted).toBe(true)
    expect(mockSignalTableViewsChanged).toHaveBeenCalledTimes(1)
    expect(mockSignalTableViewsChanged).toHaveBeenCalledWith('table-1')
  })

  it('deleteTableView does NOT signal when nothing was deleted', async () => {
    queueTableRows(tableViews, [{ id: 'view-1' }])

    const deleted = await deleteTableView('missing', 'table-1')

    expect(deleted).toBe(false)
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
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
    vi.clearAllMocks()
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

  it('returns null for a view id that is not on this table', async () => {
    expect(await getTableView('view-elsewhere', 'table-1', columns)).toBeNull()
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
    vi.clearAllMocks()
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

  it('allows the create that lands exactly on the ceiling', async () => {
    queueTableRows(tableViews, [{ total: TABLE_LIMITS.MAX_VIEWS_PER_TABLE - 1 }])
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        id: 'view-100',
        tableId: 'table-1',
        workspaceId: 'ws-1',
        name: 'Another View',
        config: {},
        isDefault: false,
        createdBy: 'user-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])

    await expect(create()).resolves.toMatchObject({ id: 'view-100' })
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
    vi.clearAllMocks()
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

  it('leaves an already id-keyed config untouched', async () => {
    queueTableRows(tableViews, [{ total: 0 }])
    dbChainMockFns.returning.mockResolvedValueOnce([storedRow])

    await create({
      sort: [{ field: 'col_b', direction: 'asc' }],
      filter: { all: [{ field: 'col_a', op: 'eq', value: 'x' }] },
    })

    expect(insertedConfig()).toEqual({
      sort: [{ field: 'col_b', direction: 'asc' }],
      filter: { all: [{ field: 'col_a', op: 'eq', value: 'x' }] },
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

  /**
   * The layout half used to answer 200 and store a name no read ever shows,
   * while the same unknown name in `filter` answered 400 — one request, two
   * policies.
   */
  it('refuses a hidden column that does not exist for a strict caller', async () => {
    queueTableRows(tableViews, [{ total: 0 }])
    dbChainMockFns.returning.mockResolvedValueOnce([storedRow])

    await expect(create({ hiddenColumns: ['ghost'] })).rejects.toMatchObject({
      name: 'TableViewValidationError',
    })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('refuses an unknown column in every other layout key too', async () => {
    for (const config of [
      { columnOrder: ['ghost'] },
      { pinnedColumns: ['ghost'] },
      { columnWidths: { ghost: 120 } },
    ]) {
      queueTableRows(tableViews, [{ total: 0 }])
      await expect(create(config)).rejects.toMatchObject({ name: 'TableViewValidationError' })
    }
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('keeps storing a first-party layout reference that no longer resolves', async () => {
    queueTableRows(tableViews, [{ total: 0 }])
    dbChainMockFns.returning.mockResolvedValueOnce([storedRow])

    await create({ hiddenColumns: ['col_gone'] }, false)

    expect(insertedConfig().hiddenColumns).toEqual(['col_gone'])
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
   * "Save as view" hands back the filter the grid is displaying, dangling leaf
   * and all — the same slice the Save chip sends to the update path, which has
   * always tolerated it. Refusing one and accepting the other would 400 the two
   * menu items against each other.
   */
  it('stores the same dangling reference for a first-party caller', async () => {
    queueTableRows(tableViews, [{ total: 0 }])
    dbChainMockFns.returning.mockResolvedValueOnce([storedRow])

    await create(
      { filter: { all: [{ field: 'col_gone', op: 'eq', value: 'x' }] }, sort: [] },
      false
    )

    expect(insertedConfig().filter).toEqual({
      all: [{ field: 'col_gone', op: 'eq', value: 'x' }],
    })
  })

  /**
   * A user column may legally be named `createdAt`. The name→id rewrite would
   * otherwise point the stored ref at that column's JSONB cell while every read
   * still resolves the literal to `user_table_rows.created_at`.
   */
  it('leaves a system field alone even when a user column carries its name', async () => {
    queueTableRows(tableViews, [{ total: 0 }])
    dbChainMockFns.returning.mockResolvedValueOnce([storedRow])

    await createTableView({
      tableId: 'table-1',
      workspaceId: 'ws-1',
      name: 'My View',
      config: { sort: [{ field: 'createdAt', direction: 'desc' }] },
      userId: 'user-1',
      columns: [...columns, { id: 'col_c', name: 'createdAt', type: 'string' }],
      strictRefs: true,
    })

    expect(insertedConfig().sort).toEqual([{ field: 'createdAt', direction: 'desc' }])
  })

  it('refuses a nonexistent filter column on a configPatch too', async () => {
    queueTableRows(tableViews, [{ id: 'view-1' }])

    await expect(
      updateTableView({
        viewId: 'view-1',
        tableId: 'table-1',
        configPatch: { filter: { all: [{ field: 'ghost', op: 'eq', value: 'x' }] } },
        columns,
        strictRefs: true,
      })
    ).rejects.toMatchObject({ name: 'TableViewValidationError' })
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

  it('still lets a strict save carry the stale filter reference forward with a valid layout', async () => {
    const stale = { all: [{ field: 'col_gone', op: 'eq' as const, value: 'x' }] }
    queueTableRows(tableViews, [{ ...storedRow, config: { filter: stale } }])
    dbChainMockFns.returning.mockResolvedValueOnce([storedRow])

    await expect(
      updateTableView({
        viewId: 'view-1',
        tableId: 'table-1',
        config: { filter: stale, hiddenColumns: ['col_a'] },
        columns,
        strictRefs: true,
      })
    ).resolves.not.toBeNull()
  })

  it('leaves the non-strict grid path free to save that same layout reference', async () => {
    const stale = { all: [{ field: 'col_gone', op: 'eq' as const, value: 'x' }] }
    queueTableRows(tableViews, [{ ...storedRow, config: { filter: stale } }])
    dbChainMockFns.returning.mockResolvedValueOnce([storedRow])

    await expect(
      updateTableView({
        viewId: 'view-1',
        tableId: 'table-1',
        config: { filter: stale, hiddenColumns: ['col_gone'] },
        columns,
      })
    ).resolves.not.toBeNull()
  })

  it('accepts that same new reference from a first-party caller', async () => {
    const stale = { all: [{ field: 'col_gone', op: 'eq' as const, value: 'x' }] }
    queueTableRows(tableViews, [{ ...storedRow, config: { filter: stale } }])
    dbChainMockFns.returning.mockResolvedValueOnce([storedRow])

    await expect(
      updateTableView({
        viewId: 'view-1',
        tableId: 'table-1',
        config: { filter: { all: [{ field: 'col_other_ghost', op: 'eq', value: 'x' }] } },
        columns,
      })
    ).resolves.not.toBeNull()
  })

  it('keeps a sort on a system row column, which is sortable but not in schema.columns', () => {
    expect(
      pruneViewConfig({ sort: [{ field: 'createdAt', direction: 'desc' }] }, columns).sort
    ).toEqual([{ field: 'createdAt', direction: 'desc' }])
  })
})

describe('getTableViewTableId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('names the table a view belongs to', async () => {
    queueTableRows(tableViews, [{ tableId: 'table-1' }])
    expect(await getTableViewTableId('view-1', 'ws-1')).toBe('table-1')
  })

  it('reads a view outside the asserted workspace as missing', async () => {
    expect(await getTableViewTableId('view-elsewhere', 'ws-1')).toBeNull()
  })
})
