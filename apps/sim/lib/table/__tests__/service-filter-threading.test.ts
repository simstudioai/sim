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
import { buildFilterClause, buildSortClause } from '@/lib/table/sql'
import type { ColumnDefinition, TableDefinition } from '@/lib/table/types'

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/table/sql', () => ({
  buildFilterClause: vi.fn(() => sql`true`),
  buildSortClause: vi.fn(() => sql`true`),
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

import { deleteRowsByFilter, queryRows, updateRowsByFilter } from '@/lib/table/service'

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
