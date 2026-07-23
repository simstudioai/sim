/**
 * @vitest-environment node
 *
 * Lock-order regression guard: a column-creating CSV import must acquire the
 * per-table row-order advisory lock (`user_table_rows_pos`) BEFORE writing
 * `user_table_definitions`, matching the rows_pos → definitions order that plain
 * inserts take via the row-count trigger. The opposite order deadlocks
 * concurrent inserts on the same table.
 */
import { userTableDefinitions } from '@sim/db/schema'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importAppendRows } from '@/lib/table/import-data'
import type { TableDefinition } from '@/lib/table/types'

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/lib/table/validation', () => ({
  validateRowSize: vi.fn(() => ({ valid: true, errors: [] })),
  validateRowAgainstSchema: vi.fn(() => ({ valid: true, errors: [] })),
  coerceRowToSchema: vi.fn(() => ({ valid: true, errors: [] })),
  coerceRowValues: vi.fn((row) => row),
  validateTableName: vi.fn(() => ({ valid: true, errors: [] })),
  validateTableSchema: vi.fn(() => ({ valid: true, errors: [] })),
  getUniqueColumns: vi.fn(() => []),
  checkUniqueConstraintsDb: vi.fn(async () => ({ valid: true, errors: [] })),
  checkBatchUniqueConstraintsDb: vi.fn(async () => ({ valid: true, errors: [] })),
}))

const TABLE: TableDefinition = {
  id: 'tbl-1',
  name: 'People',
  description: null,
  schema: { columns: [{ name: 'name', type: 'string' }] },
  metadata: null,
  rowCount: 0,
  maxRows: 1000,
  workspaceId: 'ws-1',
  createdBy: 'user-1',
  archivedAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

/**
 * invocationCallOrder of the first `tx.execute(...)` whose SQL contains
 * `substring` — checks the template strings, the interpolated values (the
 * advisory key is passed as a value), and `sql.raw` output.
 */
function executeOrderContaining(substring: string): number {
  const { calls, invocationCallOrder } = dbChainMockFns.execute.mock
  for (let i = 0; i < calls.length; i++) {
    const arg = calls[i][0] as { strings?: unknown; values?: unknown; rawSql?: unknown } | undefined
    const haystacks: string[] = []
    if (Array.isArray(arg?.strings)) {
      haystacks.push(
        ...(arg.strings as unknown[]).filter((s): s is string => typeof s === 'string')
      )
    }
    if (Array.isArray(arg?.values)) {
      haystacks.push(...(arg.values as unknown[]).filter((v): v is string => typeof v === 'string'))
    }
    if (typeof arg?.rawSql === 'string') haystacks.push(arg.rawSql)
    if (haystacks.some((s) => s.includes(substring))) return invocationCallOrder[i]
  }
  return -1
}

/** invocationCallOrder of the first `tx.update(table)` call. */
function updateOrderForTable(table: unknown): number {
  const { calls, invocationCallOrder } = dbChainMockFns.update.mock
  for (let i = 0; i < calls.length; i++) {
    if (calls[i][0] === table) return invocationCallOrder[i]
  }
  return -1
}

describe('table import lock ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('acquires the rows_pos advisory before the user_table_definitions write when adding columns', async () => {
    // The lock pre-acquire and the column-creating write both run at the top of
    // the import, before the batch-insert loop. The loop's order-key aggregates
    // aren't fully wired in this unit mock, so tolerate a downstream error after
    // the locks under test have been recorded.
    await importAppendRows(
      TABLE,
      [{ name: 'new_col', type: 'string' }],
      [{ name: 'Alice', new_col: 'x' }],
      { workspaceId: 'ws-1', userId: 'user-1', requestId: 'req-1' }
    ).catch(() => {})

    const rowsPosLockOrder = executeOrderContaining('user_table_rows_pos')
    const definitionsWriteOrder = updateOrderForTable(userTableDefinitions)

    expect(rowsPosLockOrder).toBeGreaterThan(0)
    expect(definitionsWriteOrder).toBeGreaterThan(0)
    expect(rowsPosLockOrder).toBeLessThan(definitionsWriteOrder)
  })
})
