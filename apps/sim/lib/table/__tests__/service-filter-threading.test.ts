/**
 * @vitest-environment node
 *
 * Integration test asserting that `table.schema.columns` is forwarded to
 * `buildFilterClause` from each service function that filters rows. This
 * guards the contract that type-aware JSONB casts (numeric for numbers,
 * timestamp for dates) are always available at the SQL builder layer — the
 * latent bug that PR #4657 was originally fixing.
 */
import { dbChainMockFns, resetDbChainMock, setEnv } from '@sim/testing'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TABLE_LIMITS } from '@/lib/table/constants'
import { decodeCursor } from '@/lib/table/rows/cursor'
import { buildFilterClause, buildSortClause } from '@/lib/table/sql'
import type { ColumnDefinition, TableDefinition } from '@/lib/table/types'

const { mockFireTableTrigger } = vi.hoisted(() => ({ mockFireTableTrigger: vi.fn() }))

vi.mock('@/lib/table/sql', () => ({
  buildFilterClause: vi.fn(() => sql`true`),
  buildSortClause: vi.fn(() => sql`true`),
  buildPredicateClause: vi.fn(() => sql`true`),
  TableQueryValidationError: class TableQueryValidationError extends Error {},
}))

vi.mock('@/lib/table/trigger', () => ({
  fireTableTrigger: mockFireTableTrigger,
}))

vi.mock('@/lib/table/workflow-group-deps', () => ({
  stripGroupDeps: vi.fn(),
}))
vi.mock('@/lib/table/workflow-columns', () => ({
  assertValidSchema: vi.fn(),
  scheduleRunsForRows: vi.fn(),
  scheduleRunsForTable: vi.fn(),
  stripGroupDeps: vi.fn(),
}))

const { mockLoadExecutionsByRow } = vi.hoisted(() => ({
  mockLoadExecutionsByRow: vi.fn(async () => new Map()),
}))

vi.mock('@/lib/table/rows/executions', () => ({
  applyExecutionsPatch: vi.fn((existing: unknown) => existing),
  deriveExecClearsForDataPatch: vi.fn(() => ({
    executionsPatch: undefined,
    inFlightDownstreamGroups: [],
  })),
  loadExecutionsByRow: mockLoadExecutionsByRow,
  loadExecutionsForRow: vi.fn(async () => ({})),
  writeExecutionsPatch: vi.fn(async () => 'wrote'),
}))

vi.mock('@/lib/table/validation', () => ({
  validateRowSize: vi.fn(() => ({ valid: true, errors: [] })),
  validateRowAgainstSchema: vi.fn(() => ({ valid: true, errors: [] })),
  coerceRowToSchema: vi.fn(() => ({ valid: true, errors: [] })),
  coerceRowValues: vi.fn(),
  validateTableName: vi.fn(() => ({ valid: true, errors: [] })),
  validateTableSchema: vi.fn(() => ({ valid: true, errors: [] })),
  getUniqueColumns: vi.fn(() => []),
  checkUniqueConstraintsDb: vi.fn(async () => ({ valid: true, errors: [] })),
  checkBatchUniqueConstraintsDb: vi.fn(async () => ({ valid: true, errors: [] })),
}))

import {
  deleteRow,
  deleteRowsByFilter,
  deleteRowsByIds,
  queryRows,
  requireTableRowIds,
  updateRowsByFilter,
} from '@/lib/table/rows/service'

const COLUMNS: ColumnDefinition[] = [
  { name: 'name', type: 'string' },
  { name: 'birthDate', type: 'date' },
  { name: 'score', type: 'number' },
]

const TABLE: TableDefinition = {
  id: 'tbl-1',
  name: 'People',
  description: null,
  schema: { columns: COLUMNS },
  metadata: null,
  rowCount: 0,
  maxRows: 1000,
  workspaceId: 'ws-1',
  createdBy: 'user-1',
  locks: { schemaLocked: false, insertLocked: false, updateLocked: false, deleteLocked: false },
  archivedAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

describe('service filter threading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('queryRows forwards table.schema.columns to buildFilterClause', async () => {
    await queryRows(
      TABLE,
      { filter: { birthDate: { $gte: '2024-01-01' } }, includeTotal: false },
      'req-1'
    ).catch(() => {})

    expect(buildFilterClause).toHaveBeenCalledTimes(1)
    expect(buildFilterClause).toHaveBeenCalledWith(
      { birthDate: { $gte: '2024-01-01' } },
      expect.any(String),
      COLUMNS
    )
  })

  it('queryRows forwards columns to buildSortClause as well', async () => {
    await queryRows(TABLE, { sort: { birthDate: 'asc' }, includeTotal: false }, 'req-1').catch(
      () => {}
    )

    expect(buildSortClause).toHaveBeenCalledWith({ birthDate: 'asc' }, expect.any(String), COLUMNS)
  })

  it('updateRowsByFilter forwards table.schema.columns to buildFilterClause', async () => {
    await updateRowsByFilter(
      TABLE,
      { filter: { birthDate: { $lt: '2024-06-01' } }, data: { name: 'x' } },
      'req-1'
    )

    expect(buildFilterClause).toHaveBeenCalledTimes(1)
    expect(buildFilterClause).toHaveBeenCalledWith(
      { birthDate: { $lt: '2024-06-01' } },
      expect.any(String),
      COLUMNS
    )
  })

  it('treats an empty bulk patch as a no-op before selecting rows', async () => {
    const result = await updateRowsByFilter(
      TABLE,
      { filter: { score: { $gt: 0 } }, data: {} },
      'req-1'
    )

    expect(result).toEqual({ affectedCount: 0, affectedRowIds: [] })
    expect(buildFilterClause).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('deleteRowsByFilter forwards table.schema.columns to buildFilterClause', async () => {
    await deleteRowsByFilter(TABLE, { filter: { score: { $gt: 90 } } }, 'req-1')

    expect(buildFilterClause).toHaveBeenCalledTimes(1)
    expect(buildFilterClause).toHaveBeenCalledWith(
      { score: { $gt: 90 } },
      expect.any(String),
      COLUMNS
    )
  })

  it('verifies explicit row selections in bounded canonical-scope chunks', async () => {
    const rowIds = Array.from(
      { length: TABLE_LIMITS.DELETE_BATCH_SIZE + 1 },
      (_, index) => `row-${index}`
    )
    dbChainMockFns.where
      .mockResolvedValueOnce([{ count: TABLE_LIMITS.DELETE_BATCH_SIZE }])
      .mockResolvedValueOnce([{ count: 1 }])

    await expect(requireTableRowIds(TABLE.id, TABLE.workspaceId, rowIds)).resolves.toBeUndefined()
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.where).toHaveBeenCalledTimes(2)
  })

  it('conceals a missing explicit row selection', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([{ count: 0 }])

    await expect(
      requireTableRowIds(TABLE.id, TABLE.workspaceId, ['missing-row'])
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('delete trigger dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('fires with the committed snapshot after deleting one row', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'row-1', data: { name: 'Ada' } }])

    await deleteRow(TABLE, 'row-1', 'req-delete-one')

    expect(mockFireTableTrigger).toHaveBeenCalledWith(
      TABLE.id,
      TABLE.workspaceId,
      TABLE.name,
      'delete',
      [{ id: 'row-1', data: { name: 'Ada' } }],
      null,
      TABLE.schema,
      'req-delete-one'
    )
  })

  it('returns after deleting one row without waiting for trigger dispatch', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'row-1', data: { name: 'Ada' } }])
    let releaseTrigger: (() => void) | undefined
    const triggerPending = new Promise<void>((resolve) => {
      releaseTrigger = resolve
    })
    mockFireTableTrigger.mockReturnValueOnce(triggerPending)
    const deletion = deleteRow(TABLE, 'row-1', 'req-delete-one')
    const onDeleteSettled = vi.fn()
    void deletion.then(onDeleteSettled)

    await vi.waitFor(() => expect(mockFireTableTrigger).toHaveBeenCalledTimes(1))
    await Promise.resolve()

    try {
      expect(onDeleteSettled).toHaveBeenCalledTimes(1)
    } finally {
      releaseTrigger?.()
      await deletion
    }
  })

  it('fires once with every committed snapshot in an ID batch', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'row-1', data: { name: 'Ada' } },
      { id: 'row-2', data: { name: 'Grace' } },
    ])

    await deleteRowsByIds(
      TABLE,
      { tableId: TABLE.id, workspaceId: TABLE.workspaceId, rowIds: ['row-1', 'row-2'] },
      'req-delete-many'
    )

    expect(mockFireTableTrigger).toHaveBeenCalledWith(
      TABLE.id,
      TABLE.workspaceId,
      TABLE.name,
      'delete',
      [
        { id: 'row-1', data: { name: 'Ada' } },
        { id: 'row-2', data: { name: 'Grace' } },
      ],
      null,
      TABLE.schema,
      'req-delete-many'
    )
  })

  it('dispatches byte-bounded ID-delete snapshots before loading the next batch', async () => {
    setEnv({
      TABLE_MAX_ROW_SIZE_BYTES: TABLE_LIMITS.DELETE_SNAPSHOT_BATCH_MAX_BYTES * 2,
    })
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ id: 'row-1', data: { name: 'Ada' } }])
      .mockResolvedValueOnce([{ id: 'row-2', data: { name: 'Grace' } }])

    try {
      await deleteRowsByIds(
        TABLE,
        { tableId: TABLE.id, workspaceId: TABLE.workspaceId, rowIds: ['row-1', 'row-2'] },
        'req-delete-bounded'
      )
    } finally {
      setEnv({ TABLE_MAX_ROW_SIZE_BYTES: undefined })
    }

    expect(mockFireTableTrigger).toHaveBeenCalledTimes(2)
    expect(mockFireTableTrigger.mock.calls[0][4]).toEqual([{ id: 'row-1', data: { name: 'Ada' } }])
    expect(mockFireTableTrigger.mock.calls[1][4]).toEqual([
      { id: 'row-2', data: { name: 'Grace' } },
    ])
  })
})

describe('bulk update/delete limited-subset ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('orders the match query when updateRowsByFilter has a limit', async () => {
    await updateRowsByFilter(
      TABLE,
      { filter: { score: { $gt: 0 } }, data: { name: 'x' }, limit: 5 },
      'req-1'
    )
    expect(dbChainMockFns.orderBy).toHaveBeenCalled()
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(5)
  })

  it('walks every update match in bounded pages when no operation limit is supplied', async () => {
    await updateRowsByFilter(TABLE, { filter: { score: { $gt: 0 } }, data: { name: 'x' } }, 'req-1')
    expect(dbChainMockFns.orderBy).toHaveBeenCalled()
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(TABLE_LIMITS.UPDATE_BATCH_SIZE)
  })

  it('orders the match query when deleteRowsByFilter has a limit', async () => {
    await deleteRowsByFilter(TABLE, { filter: { score: { $gt: 0 } }, limit: 3 }, 'req-1')
    expect(dbChainMockFns.orderBy).toHaveBeenCalled()
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(3)
  })

  it('walks every delete match in bounded pages when no operation limit is supplied', async () => {
    await deleteRowsByFilter(TABLE, { filter: { score: { $gt: 0 } } }, 'req-1')
    expect(dbChainMockFns.orderBy).toHaveBeenCalled()
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(TABLE_LIMITS.DELETE_PAGE_SIZE)
  })
})

describe('queryRows byte budget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnv({ TABLE_MAX_PAGE_BYTES: undefined })
  })

  const row = (i: number, blobBytes: number) => ({
    id: `row_${i}`,
    data: { blob: 'x'.repeat(blobBytes) },
    position: i,
    orderKey: `a${i}`,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  })

  const mockRowsPastFormerBatchSafetyLimit = () => {
    const largeRow = row(1, TABLE_LIMITS.MAX_ROW_SIZE_BYTES)
    const smallRow = row(2, 0)
    const state = { drainBatch: 0 }
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockImplementation(async (ask: number) => {
      state.drainBatch++
      if (state.drainBatch > 1001) return []
      const rows = Array.from({ length: ask }, () => smallRow)
      if (state.drainBatch === 1) rows[0] = largeRow
      return rows
    })
    return state
  }

  it('returns an empty page with a null cursor', async () => {
    const result = await queryRows(TABLE, { includeTotal: false, withExecutions: false }, 'req-1')
    expect(result.rows).toEqual([])
    expect(result.nextCursor).toBeNull()
  })

  it('fails fast when an UNBOUNDED query exceeds the byte budget (no partial page)', async () => {
    const perRow = Math.floor(TABLE_LIMITS.MAX_QUERY_RESULT_BYTES * 0.6)
    // First .limit() call is pendingDeleteMask's job probe; the second is the drain batch.
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([row(1, perRow), row(2, perRow)])

    await expect(
      queryRows(TABLE, { includeTotal: false, withExecutions: false }, 'req-1')
    ).rejects.toThrow(/exceeds the 5MB limit/)
  })

  it('returns the entire result when an unbounded query fits the budget', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([row(1, 8), row(2, 8)])

    const result = await queryRows(TABLE, { includeTotal: false, withExecutions: false }, 'req-1')

    expect(result.rows).toHaveLength(2)
    expect(result.nextCursor).toBeNull()
  })

  /**
   * The sidecar is a second, unbounded read: its `blockErrors` are jsonb with no
   * ceiling of its own, so the drain has to carry a byte budget rather than have
   * one measured over an already-materialized result.
   */
  it('hands the run-state drain the budget its caller asked for', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([row(1, 8), row(2, 8)])

    await queryRows(
      TABLE,
      {
        limit: 5,
        includeTotal: false,
        withExecutions: true,
        runStateBudgetBytes: TABLE_LIMITS.MAX_ROW_RUN_STATE_BYTES,
      },
      'req-1'
    )

    expect(mockLoadExecutionsByRow).toHaveBeenCalledWith(expect.anything(), ['row_1', 'row_2'], {
      budgetBytes: TABLE_LIMITS.MAX_ROW_RUN_STATE_BYTES,
    })
  })

  /**
   * Only the public reads publish a `413` for the sidecar. The first-party grid
   * reads run state at five times the row limit with no such contract, so a
   * budget there turns a large page into a hard failure where it used to render.
   */
  it('leaves the drain unbounded for a caller that asked for no budget', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([row(1, 8), row(2, 8)])

    await queryRows(TABLE, { limit: 5, includeTotal: false, withExecutions: true }, 'req-1')

    expect(mockLoadExecutionsByRow).toHaveBeenCalledWith(
      expect.anything(),
      ['row_1', 'row_2'],
      undefined
    )
  })

  it('returns an entire under-budget result past the former batch safety limit', async () => {
    const state = mockRowsPastFormerBatchSafetyLimit()

    const result = await queryRows(TABLE, { includeTotal: false, withExecutions: false }, 'req-1')

    expect(state.drainBatch).toBe(1002)
    expect(result.rows.length).toBeGreaterThan(TABLE_LIMITS.MAX_QUERY_LIMIT)
    expect(result.nextCursor).toBeNull()
  })

  it('byte-cuts a BOUNDED page and returns a resume cursor instead of throwing', async () => {
    const perRow = Math.floor(TABLE_LIMITS.MAX_QUERY_RESULT_BYTES * 0.6)
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([row(1, perRow), row(2, perRow)])

    const result = await queryRows(
      TABLE,
      { limit: 5, includeTotal: false, withExecutions: false },
      'req-1'
    )

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].id).toBe('row_1')
    // Fractional ordering is on (global flag mock) → keyset cursor resuming
    // after the last included row.
    expect(decodeCursor(result.nextCursor as string)).toEqual({
      after: { orderKey: 'a1', id: 'row_1' },
    })
  })

  it('honors a smaller bounded-page byte override', async () => {
    setEnv({ TABLE_MAX_PAGE_BYTES: 3 * 1024 * 1024 })
    const perRow = 2 * 1024 * 1024
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([row(1, perRow), row(2, perRow)])

    const result = await queryRows(
      TABLE,
      { limit: 5, includeTotal: false, withExecutions: false },
      'req-1'
    )

    expect(result.rows).toHaveLength(1)
    expect(result.nextCursor).not.toBeNull()
  })

  it('still fails fast on an UNBOUNDED query with TABLE_MAX_PAGE_BYTES unset', async () => {
    setEnv({ TABLE_MAX_PAGE_BYTES: undefined })
    const perRow = Math.floor(TABLE_LIMITS.MAX_QUERY_RESULT_BYTES * 0.6)
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([row(1, perRow), row(2, perRow)])

    await expect(
      queryRows(TABLE, { includeTotal: false, withExecutions: false }, 'req-1')
    ).rejects.toThrow(/exceeds the 5MB limit/)
  })

  it('returns a single over-budget row alone on a bounded page', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([
      row(1, TABLE_LIMITS.MAX_QUERY_RESULT_BYTES + 1024),
      row(2, 8),
    ])

    const result = await queryRows(
      TABLE,
      { limit: 2, includeTotal: false, withExecutions: false },
      'req-1'
    )

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].id).toBe('row_1')
    expect(result.nextCursor).not.toBeNull()
  })

  // First-batch worst-case bytes stay within ~4× the budget at the max row size.
  const FIRST_BATCH_CAP = Math.max(
    1,
    Math.floor((4 * TABLE_LIMITS.MAX_QUERY_RESULT_BYTES) / TABLE_LIMITS.MAX_ROW_SIZE_BYTES)
  )

  /**
   * The seek predicate that pages the drain. `order_key` is nullable (rows
   * predating the backfill, forked rows), and a bare
   * `(order_key, id) > (:k, :i)` evaluates to NULL for those rows, so WHERE drops
   * them. Because NULLs sort last, the whole unkeyed tail then becomes
   * unreachable and the drain reports `hasMore: false` — 52 of 121 rows returned
   * with no error, reproduced against a real table.
   */
  it('seeks with a NULL-admitting comparison so unkeyed rows stay reachable', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await queryRows(
      TABLE,
      {
        after: { orderKey: 'a5', id: 'row_5' },
        limit: 10,
        includeTotal: false,
        withExecutions: false,
      },
      'req-1'
    )

    const seekWhere = JSON.stringify(dbChainMockFns.where.mock.calls.at(-1))
    expect(seekWhere).toMatch(/is null/i)
    expect(seekWhere).toContain('a5')
    expect(seekWhere).toContain('row_5')
  })

  it('resumes exactly at the last returned row when the cursor is fed back', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    // limit 2 + witness row_3 → page ends at row_2 with a resume cursor.
    dbChainMockFns.limit.mockResolvedValueOnce([row(1, 8), row(2, 8), row(3, 8)])

    const page1 = await queryRows(
      TABLE,
      { limit: 2, includeTotal: false, withExecutions: false },
      'req-1'
    )
    expect(page1.rows.map((r) => r.id)).toEqual(['row_1', 'row_2'])

    const cursor = decodeCursor(page1.nextCursor as string)
    expect(cursor).toEqual({ after: { orderKey: 'a2', id: 'row_2' } })

    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([row(3, 8), row(4, 8)])

    const page2 = await queryRows(
      TABLE,
      { ...cursor, limit: 2, includeTotal: false, withExecutions: false },
      'req-2'
    )

    // No gap (row_3 is the first row past the anchor) and no duplicate of row_2.
    expect(page2.rows.map((r) => r.id)).toEqual(['row_3', 'row_4'])
    const seekWhere = JSON.stringify(dbChainMockFns.where.mock.calls.at(-1))
    expect(seekWhere).toContain('a2')
    expect(seekWhere).toContain('row_2')
  })

  it('caps the first unbounded batch and asks limit+1 when a limit is set', async () => {
    await queryRows(TABLE, { includeTotal: false, withExecutions: false }, 'req-1')
    // Call 1 = pendingDeleteMask probe (limit 1); call 2 = first drain batch.
    expect(dbChainMockFns.limit).toHaveBeenNthCalledWith(2, FIRST_BATCH_CAP + 1)

    vi.clearAllMocks()
    resetDbChainMock()
    await queryRows(TABLE, { limit: 5, includeTotal: false, withExecutions: false }, 'req-1')
    expect(dbChainMockFns.limit).toHaveBeenNthCalledWith(2, 6)
  })

  it('limit-cut with a witness row emits a cursor; exact-boundary page does not', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([row(1, 8), row(2, 8), row(3, 8)])
    const cut = await queryRows(
      TABLE,
      { limit: 2, includeTotal: false, withExecutions: false },
      'req-1'
    )
    expect(cut.rows.map((r) => r.id)).toEqual(['row_1', 'row_2'])
    expect(cut.nextCursor).not.toBeNull()

    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([row(1, 8), row(2, 8)])
    const exact = await queryRows(
      TABLE,
      { limit: 2, includeTotal: false, withExecutions: false },
      'req-1'
    )
    expect(exact.rows).toHaveLength(2)
    // The +1 peek proved the data ended exactly at the limit — no dead cursor.
    expect(exact.nextCursor).toBeNull()
  })

  it('drains across multiple batches and grows the batch size adaptively', async () => {
    const firstAsk = FIRST_BATCH_CAP + 1
    const batch1 = Array.from({ length: firstAsk }, (_, i) => row(i, 8))
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce(batch1)
    dbChainMockFns.limit.mockResolvedValueOnce([row(firstAsk, 8)])

    const result = await queryRows(TABLE, { includeTotal: false, withExecutions: false }, 'req-1')

    expect(result.rows).toHaveLength(firstAsk + 1)
    expect(result.nextCursor).toBeNull()
    const firstBatchAsk = (dbChainMockFns.limit.mock.calls[1] ?? [])[0] as number
    const secondBatchAsk = (dbChainMockFns.limit.mock.calls[2] ?? [])[0] as number
    expect(secondBatchAsk).toBeGreaterThan(firstBatchAsk)
  })

  it('sort path advances by offset and emits an offset cursor with inbound offset applied', async () => {
    const perRow = Math.floor(TABLE_LIMITS.MAX_QUERY_RESULT_BYTES * 0.6)
    dbChainMockFns.limit.mockResolvedValueOnce([])
    // Sorted batch with inbound offset 40 terminates at .offset(40).
    dbChainMockFns.offset.mockResolvedValueOnce([row(1, perRow), row(2, perRow)])

    const result = await queryRows(
      TABLE,
      { sort: { name: 'asc' }, offset: 40, limit: 5, includeTotal: false, withExecutions: false },
      'req-1'
    )

    expect(dbChainMockFns.offset).toHaveBeenCalledWith(40)
    expect(result.rows).toHaveLength(1)
    // The offset cursor is stamped with the sort it was minted under, so a
    // replay against a different ordering is rejected instead of paging wrong.
    expect(decodeCursor(result.nextCursor as string)).toEqual({
      offset: 41,
      sortKey: JSON.stringify([['name', 'asc']]),
    })
  })

  it('emits a compound cursor when rows past the inbound anchor are unkeyed', async () => {
    const unkeyedRow = (i: number, blobBytes: number) => ({ ...row(i, blobBytes), orderKey: null })
    const perRow = Math.floor(TABLE_LIMITS.MAX_QUERY_RESULT_BYTES * 0.4)
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([
      unkeyedRow(6, perRow),
      unkeyedRow(7, perRow),
      unkeyedRow(8, perRow),
    ])

    const result = await queryRows(
      TABLE,
      {
        after: { orderKey: 'a5', id: 'row_5' },
        limit: 10,
        includeTotal: false,
        withExecutions: false,
      },
      'req-1'
    )

    expect(result.rows.map((r) => r.id)).toEqual(['row_6', 'row_7'])
    expect(decodeCursor(result.nextCursor as string)).toEqual({
      after: { orderKey: 'a5', id: 'row_5' },
      offset: 2,
    })
  })
})
