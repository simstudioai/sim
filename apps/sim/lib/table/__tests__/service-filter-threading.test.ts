/**
 * @vitest-environment node
 *
 * Integration test asserting that `table.schema.columns` is forwarded to
 * `buildFilterClause` from each service function that filters rows. This
 * guards the contract that type-aware JSONB casts (numeric for numbers,
 * timestamp for dates) are always available at the SQL builder layer — the
 * latent bug that PR #4657 was originally fixing.
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TABLE_LIMITS } from '@/lib/table/constants'
import { decodeCursor } from '@/lib/table/rows/cursor'
import { buildFilterClause, buildSortClause } from '@/lib/table/sql'
import type { ColumnDefinition, TableDefinition } from '@/lib/table/types'

const { mockIsFeatureEnabled } = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(async () => true),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))

vi.mock('@/lib/table/sql', () => ({
  buildFilterClause: vi.fn(() => sql`true`),
  buildSortClause: vi.fn(() => sql`true`),
  buildPredicateClause: vi.fn(() => sql`true`),
  TableQueryValidationError: class TableQueryValidationError extends Error {},
}))

vi.mock('@/lib/table/trigger', () => ({
  fireTableTrigger: vi.fn(),
}))

vi.mock('@/lib/table/workflow-columns', () => ({
  assertValidSchema: vi.fn(),
  scheduleRunsForRows: vi.fn(),
  scheduleRunsForTable: vi.fn(),
  stripGroupDeps: vi.fn(),
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

import { deleteRowsByFilter, queryRows, updateRowsByFilter } from '@/lib/table/rows/service'

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
    dbChainMockFns.where.mockResolvedValueOnce([])
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

  it('deleteRowsByFilter forwards table.schema.columns to buildFilterClause', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([])
    await deleteRowsByFilter(TABLE, { filter: { score: { $gt: 90 } } }, 'req-1')

    expect(buildFilterClause).toHaveBeenCalledTimes(1)
    expect(buildFilterClause).toHaveBeenCalledWith(
      { score: { $gt: 90 } },
      expect.any(String),
      COLUMNS
    )
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

  it('does not order an unbounded updateRowsByFilter', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([])
    await updateRowsByFilter(TABLE, { filter: { score: { $gt: 0 } }, data: { name: 'x' } }, 'req-1')
    expect(dbChainMockFns.orderBy).not.toHaveBeenCalled()
  })

  it('orders the match query when deleteRowsByFilter has a limit', async () => {
    await deleteRowsByFilter(TABLE, { filter: { score: { $gt: 0 } }, limit: 3 }, 'req-1')
    expect(dbChainMockFns.orderBy).toHaveBeenCalled()
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(3)
  })
})

describe('queryRows byte budget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  const row = (i: number, blobBytes: number) => ({
    id: `row_${i}`,
    data: { blob: 'x'.repeat(blobBytes) },
    position: i,
    orderKey: `a${i}`,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  })

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
    expect(decodeCursor(result.nextCursor as string)).toEqual({ offset: 41 })
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
