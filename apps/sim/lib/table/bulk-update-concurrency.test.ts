import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import {
  tableRowsSecretProvenanceMock,
  tableRowsSecretProvenanceMockFns,
} from '@sim/testing/mocks/table-rows-secret-provenance.mock'
import { tableTriggerMock } from '@sim/testing/mocks/table-trigger.mock'
import { tableWorkflowColumnsMock } from '@sim/testing/mocks/table-workflow-columns.mock'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TABLE_LIMITS } from '@/lib/table/constants'
import type { RowData, TableDefinition } from '@/lib/table/types'

const hoisted = vi.hoisted(() => ({
  selectRowDataPage: vi.fn(),
  validateRowSize: vi.fn(),
  coerceRowToSchema: vi.fn(),
}))

vi.mock('@/lib/table/rows/ordering', () => ({
  selectRowDataPage: hoisted.selectRowDataPage,
}))

vi.mock('@/lib/table/rows/secret-provenance', () => tableRowsSecretProvenanceMock)

vi.mock('@/lib/table/sql', () => ({
  buildFilterClause: vi.fn(() => sql`true`),
  buildPredicateClause: vi.fn(() => sql`true`),
  buildSortClause: vi.fn(() => sql`true`),
  escapeLikePattern: vi.fn((value: string) => value),
  fieldPredicate: vi.fn(() => sql`true`),
}))

vi.mock('@/lib/table/trigger', () => tableTriggerMock)

vi.mock('@/lib/table/validation', () => ({
  validateRowSize: hoisted.validateRowSize,
  coerceRowToSchema: hoisted.coerceRowToSchema,
  coerceRowValues: vi.fn(),
  getUniqueColumns: vi.fn(() => []),
  checkUniqueConstraintsDb: vi.fn(async () => ({ valid: true, errors: [] })),
  checkBatchUniqueConstraintsDb: vi.fn(async () => ({ valid: true, errors: [] })),
}))

vi.mock('@/lib/table/workflow-columns', () => tableWorkflowColumnsMock)

import { updateRowsByFilter } from '@/lib/table/rows/service'

const mocks = {
  ...hoisted,
  mutateTableRowsWithSecretProvenance:
    tableRowsSecretProvenanceMockFns.mockMutateTableRowsWithSecretProvenance,
}

const TABLE: TableDefinition = {
  id: 'table-1',
  name: 'Contacts',
  description: null,
  schema: { columns: [{ id: 'name', name: 'Name', type: 'string' }] },
  metadata: null,
  rowCount: TABLE_LIMITS.UPDATE_BATCH_SIZE + 1,
  maxRows: 10_000,
  workspaceId: 'workspace-1',
  createdBy: 'user-1',
  locks: { schemaLocked: false, insertLocked: false, updateLocked: false, deleteLocked: false },
  archivedAt: null,
  createdAt: new Date('2026-08-11T00:00:00.000Z'),
  updatedAt: new Date('2026-08-11T00:00:00.000Z'),
}

function row(id: string, data: RowData = { name: id }): { id: string; data: RowData } {
  return { id, data }
}

describe('bulk update concurrency', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.validateRowSize.mockImplementation((data: RowData) =>
      data.concurrentlyInvalid
        ? { valid: false, errors: ['row is no longer valid'] }
        : { valid: true, errors: [] }
    )
    mocks.coerceRowToSchema.mockReturnValue({ valid: true, errors: [] })
    mocks.mutateTableRowsWithSecretProvenance.mockImplementation(
      async (_trx, options: { mutate: () => Promise<{ value: string[] }> }) => {
        const outcome = await options.mutate()
        return outcome.value
      }
    )
  })

  it('fails preflight before opening a mutation transaction for an invalid selected row', async () => {
    mocks.selectRowDataPage.mockResolvedValueOnce([
      row('invalid-row', { name: 'invalid', concurrentlyInvalid: true }),
    ])

    await expect(
      updateRowsByFilter(
        TABLE,
        { filter: { status: 'active' }, data: { name: 'updated' } },
        'request-1'
      )
    ).rejects.toThrow('Row invalid-row: row is no longer valid')

    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('skips a later page invalidated after preflight without returning a partial failure', async () => {
    const firstPage = Array.from({ length: TABLE_LIMITS.UPDATE_BATCH_SIZE }, (_, index) =>
      row(`row-${index.toString().padStart(4, '0')}`)
    )
    const lastRow = row('row-last')

    mocks.selectRowDataPage
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([lastRow])
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([lastRow])

    queueTableRows(schemaMock.userTableRows, firstPage)
    queueTableRows(schemaMock.userTableRows, [
      row(lastRow.id, { name: 'changed concurrently', concurrentlyInvalid: true }),
    ])
    dbChainMockFns.returning.mockResolvedValueOnce(firstPage.map(({ id }) => ({ id })))

    const result = await updateRowsByFilter(
      TABLE,
      { filter: { status: 'active' }, data: { name: 'updated' } },
      'request-1'
    )

    expect(result).toEqual({
      affectedCount: firstPage.length,
      affectedRowIds: firstPage.map(({ id }) => id),
    })
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(mocks.mutateTableRowsWithSecretProvenance).toHaveBeenCalledTimes(2)
  })
})
