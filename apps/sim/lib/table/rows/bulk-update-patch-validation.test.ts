/**
 * A bulk update's patch must be judged on its own: an uncoercible value is a
 * property of the request, so it has to be answered identically whether the
 * filter matches rows or none.
 */
import { resetDbChainMock } from '@sim/testing'
import {
  tableRowsSecretProvenanceMock,
  tableRowsSecretProvenanceMockFns,
} from '@sim/testing/mocks/table-rows-secret-provenance.mock'
import { tableTriggerMock } from '@sim/testing/mocks/table-trigger.mock'
import { tableWorkflowColumnsMock } from '@sim/testing/mocks/table-workflow-columns.mock'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RowData, TableDefinition } from '@/lib/table/types'

const hoisted = vi.hoisted(() => ({
  selectRowDataPage: vi.fn(),
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

vi.mock('@/lib/table/workflow-columns', () => tableWorkflowColumnsMock)

import { updateRowsByFilter } from '@/lib/table/rows/service'

const mocks = {
  ...hoisted,
  mutateTableRowsWithSecretProvenance:
    tableRowsSecretProvenanceMockFns.mockMutateTableRowsWithSecretProvenance,
}

const TABLE: TableDefinition = {
  id: 'table-1',
  name: 'People',
  description: null,
  schema: {
    columns: [
      { id: 'name', name: 'Name', type: 'string' },
      { id: 'age', name: 'Age', type: 'number' },
    ],
  },
  metadata: null,
  rowCount: 1,
  maxRows: 10_000,
  workspaceId: 'workspace-1',
  createdBy: 'user-1',
  locks: { schemaLocked: false, insertLocked: false, updateLocked: false, deleteLocked: false },
  archivedAt: null,
  createdAt: new Date('2026-08-12T00:00:00.000Z'),
  updatedAt: new Date('2026-08-12T00:00:00.000Z'),
}

function row(id: string, data: RowData): { id: string; data: RowData } {
  return { id, data }
}

describe('bulk update patch validation', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.selectRowDataPage.mockResolvedValue([])
    mocks.mutateTableRowsWithSecretProvenance.mockImplementation(
      async (_trx: unknown, options: { mutate: () => Promise<{ value: string[] }> }) => {
        const outcome = await options.mutate()
        return outcome.value
      }
    )
  })

  it('rejects an uncoercible patch value when the filter matches nothing', async () => {
    await expect(
      updateRowsByFilter(
        TABLE,
        { filter: { name: { eq: 'nobody' } }, data: { age: 'abc' } },
        'request-1',
        { uncoercibleValues: 'reject' }
      )
    ).rejects.toMatchObject({ code: 'validation' })
  })

  it('rejects the same uncoercible patch value when the filter matches rows', async () => {
    mocks.selectRowDataPage.mockResolvedValueOnce([row('row-1', { name: 'somebody', age: 30 })])

    await expect(
      updateRowsByFilter(
        TABLE,
        { filter: { name: { eq: 'somebody' } }, data: { age: 'abc' } },
        'request-1',
        { uncoercibleValues: 'reject' }
      )
    ).rejects.toMatchObject({ code: 'validation' })
  })

  it('still reports zero matches for a valid patch that matches nothing', async () => {
    const result = await updateRowsByFilter(
      TABLE,
      { filter: { name: { eq: 'nobody' } }, data: { age: 41 } },
      'request-1',
      { uncoercibleValues: 'reject' }
    )

    expect(result).toEqual({ affectedCount: 0, affectedRowIds: [] })
  })

  it('accepts a valid patch over a row whose pre-existing stored value is uncoercible', async () => {
    mocks.selectRowDataPage.mockResolvedValue([
      row('row-1', { name: 'somebody', age: 'legacy junk' }),
    ])

    const result = await updateRowsByFilter(
      TABLE,
      { filter: { name: { eq: 'somebody' } }, data: { name: 'renamed' } },
      'request-1',
      { uncoercibleValues: 'reject' }
    )

    expect(result.affectedCount).toBe(0)
    expect(mocks.mutateTableRowsWithSecretProvenance).toHaveBeenCalled()
  })
})
