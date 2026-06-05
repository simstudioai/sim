/**
 * @vitest-environment node
 *
 * Flag-ON behavior for fractional ordering. This file mocks
 * `isTablesFractionalOrderingEnabled` to `true`; the existing suites cover the
 * flag-off (default) behavior. Mock-based — asserts which write paths the
 * service does/does not take (the real ordering correctness is the manual
 * large-table check in the PR).
 */
import {
  createMockSql,
  createMockSqlOperators,
  dbChainMock,
  dbChainMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

vi.mock('@sim/db', () => dbChainMock)

// Augment the shared sql mock with `.mapWith` (used by nextRowPosition's
// aggregate projection); provide the operators the service imports.
vi.mock('drizzle-orm', () => {
  const baseSql = createMockSql()
  const sqlFn: any = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const fragment = baseSql(strings, ...values) as Record<string, unknown>
    fragment.mapWith = () => fragment
    return fragment
  }
  sqlFn.raw = baseSql.raw
  sqlFn.join = baseSql.join
  return { sql: sqlFn, ...createMockSqlOperators() }
})

vi.mock('@/lib/core/config/feature-flags', () => ({
  isTablesFractionalOrderingEnabled: true,
  isProd: false,
  isDev: false,
  isHosted: false,
  isBillingEnabled: false,
}))

vi.mock('@/lib/table/sql', () => ({
  buildFilterClause: vi.fn(() => ({ type: 'filter' })),
  buildSortClause: vi.fn(() => ({ type: 'sort' })),
}))

vi.mock('@/lib/table/trigger', () => ({ fireTableTrigger: vi.fn() }))

vi.mock('@/lib/table/workflow-columns', () => ({
  assertValidSchema: vi.fn(),
  cancelWorkflowGroupRuns: vi.fn(),
  runWorkflowColumn: vi.fn(() => Promise.resolve()),
  stripGroupDeps: vi.fn(),
}))

vi.mock('@/lib/table/validation', () => ({
  validateRowSize: vi.fn(() => ({ valid: true, errors: [] })),
  coerceRowToSchema: vi.fn(() => ({ valid: true, errors: [] })),
  coerceRowValues: vi.fn(),
  getUniqueColumns: vi.fn(() => []),
  checkUniqueConstraintsDb: vi.fn(async () => ({ valid: true, errors: [] })),
  checkBatchUniqueConstraintsDb: vi.fn(async () => ({ valid: true, errors: [] })),
}))

import { deleteRow, deleteRowsByIds, insertRow } from '@/lib/table/service'

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

describe('fractional ordering (flag on)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  describe('deleteRow', () => {
    it('does not shift any other row (no positional UPDATE)', async () => {
      // The delete returns the removed row's position; with the flag on the
      // service must NOT run the `position - 1` shift afterwards.
      dbChainMockFns.returning.mockResolvedValueOnce([{ position: 4 }])
      await deleteRow('tbl-1', 'row-x', 'ws-1', 'req-1')
      expect(dbChainMockFns.delete).toHaveBeenCalledTimes(1)
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('throws when the row is missing', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([])
      await expect(deleteRow('tbl-1', 'missing', 'ws-1', 'req-1')).rejects.toThrow(/not found/i)
    })
  })

  describe('deleteRowsByIds', () => {
    it('deletes without recompacting positions', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([
        { id: 'a', position: 1 },
        { id: 'b', position: 3 },
      ])
      const result = await deleteRowsByIds(
        { tableId: 'tbl-1', workspaceId: 'ws-1', rowIds: ['a', 'b'] },
        'req-1'
      )
      expect(result.deletedCount).toBe(2)
      expect(result.deletedRowIds).toEqual(['a', 'b'])
      // The recompaction runs as a raw `trx.execute(UPDATE … ROW_NUMBER())`.
      // With the flag on it must be skipped, leaving only the 3 `SET LOCAL`
      // timeout statements.
      expect(dbChainMockFns.execute).toHaveBeenCalledTimes(3)
    })

    it('no-ops on an empty id list', async () => {
      const result = await deleteRowsByIds(
        { tableId: 'tbl-1', workspaceId: 'ws-1', rowIds: [] },
        'req-1'
      )
      expect(result.deletedCount).toBe(0)
      expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    })
  })

  describe('insertRow (append)', () => {
    it('assigns a fractional order key and never shifts another row', async () => {
      // resolveInsertOrderKey (max order_key) then nextRowPosition (max position).
      dbChainMockFns.where
        .mockResolvedValueOnce([{ maxKey: 'a1' }])
        .mockResolvedValueOnce([{ maxPos: 5 }])
      dbChainMockFns.returning.mockResolvedValueOnce([
        {
          id: 'row-1',
          data: { name: 'x' },
          position: 6,
          orderKey: 'a2',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])

      const row = await insertRow(
        { tableId: 'tbl-1', data: { name: 'x' }, workspaceId: 'ws-1' },
        TABLE,
        'req-1'
      )

      expect(row.orderKey).toBe('a2')
      // Appended via order_key; no `position + 1` shift of existing rows.
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
      const values = dbChainMockFns.values.mock.calls[0][0] as { orderKey?: string }
      expect(typeof values.orderKey).toBe('string')
    })
  })
})
