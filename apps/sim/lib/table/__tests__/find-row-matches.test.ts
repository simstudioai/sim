/**
 * @vitest-environment node
 *
 * Unit-tests the result mapping and truncation logic of `findRowMatches`. The
 * SQL itself runs against a mocked `db.execute`, so these assertions cover the
 * JS-side shaping (ordinal coercion, column rename, LIMIT+1 truncation), not
 * the query semantics — those need a real Postgres.
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ColumnDefinition, TableDefinition } from '@/lib/table/types'

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/table/sql', () => ({
  buildFilterClause: vi.fn(() => sql`true`),
  buildSortClause: vi.fn(() => sql`true`),
  escapeLikePattern: vi.fn((s: string) => s),
}))

vi.mock('@/lib/table/trigger', () => ({ fireTableTrigger: vi.fn() }))
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

import { findRowMatches } from '@/lib/table/rows/service'
import { buildFilterClause, buildSortClause } from '@/lib/table/sql'

const COLUMNS: ColumnDefinition[] = [
  { name: 'name', type: 'string' },
  { name: 'email', type: 'string' },
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

describe('findRowMatches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns empty without querying when the table has no columns', async () => {
    const result = await findRowMatches({ ...TABLE, schema: { columns: [] } }, { q: 'x' }, 'req')
    expect(result).toEqual({ matches: [], truncated: false })
    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
  })

  it('maps rows to matches, coercing the bigint ordinal and renaming the column', async () => {
    dbChainMockFns.execute.mockResolvedValue([
      { ordinal: '2', id: 'r2', column_name: 'name' },
      { ordinal: 5, id: 'r5', column_name: 'email' },
    ])
    const result = await findRowMatches(TABLE, { q: 'a' }, 'req')
    expect(result.truncated).toBe(false)
    expect(result.matches).toEqual([
      { ordinal: 2, rowId: 'r2', column: 'name' },
      { ordinal: 5, rowId: 'r5', column: 'email' },
    ])
  })

  it('flags truncation and caps the result when the DB returns LIMIT+1 rows', async () => {
    const over = Array.from({ length: 1001 }, (_, i) => ({
      ordinal: i,
      id: `r${i}`,
      column_name: 'name',
    }))
    dbChainMockFns.execute.mockResolvedValue(over)
    const result = await findRowMatches(TABLE, { q: 'a' }, 'req')
    expect(result.truncated).toBe(true)
    expect(result.matches).toHaveLength(1000)
  })

  it('threads filter and sort through the SQL builders', async () => {
    dbChainMockFns.execute.mockResolvedValue([])
    await findRowMatches(
      TABLE,
      { q: 'a', filter: { name: { $contains: 'a' } }, sort: { name: 'asc' } },
      'req'
    )
    expect(buildFilterClause).toHaveBeenCalledWith(
      { name: { $contains: 'a' } },
      expect.any(String),
      COLUMNS
    )
    expect(buildSortClause).toHaveBeenCalledWith({ name: 'asc' }, expect.any(String), COLUMNS)
  })
})
