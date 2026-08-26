/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_REFERENCE_TABLE_ID_LENGTH } from '@/lib/table/constants'
import type { TableDefinition } from '@/lib/table/types'

const mocks = vi.hoisted(() => ({
  withLockedTable: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
}))

vi.mock('@/lib/table/service', () => ({ withLockedTable: mocks.withLockedTable }))

import {
  addTableColumn,
  updateColumnReference,
  updateColumnType,
} from '@/lib/table/columns/service'

const BASE_TABLE = {
  id: 'tbl_people',
  name: 'People',
  workspaceId: 'ws_1',
  schema: {
    columns: [{ id: 'col_name', name: 'Name', type: 'string' }],
  },
  metadata: null,
  rowCount: 0,
} as unknown as TableDefinition

function tableWithReference(referenceTableId = 'tbl_accounts'): TableDefinition {
  return {
    ...BASE_TABLE,
    schema: {
      columns: [
        {
          id: 'col_account',
          name: 'Account',
          type: 'reference',
          referenceTableId,
        },
      ],
    },
  }
}

describe('reference column metadata persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.where.mockResolvedValue(undefined)
    mocks.set.mockReturnValue({ where: mocks.where })
  })

  function useTable(table: TableDefinition) {
    const trx = {
      execute: vi.fn().mockResolvedValue([]),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
          })),
        })),
      })),
      update: vi.fn(() => ({ set: mocks.set })),
    }
    mocks.withLockedTable.mockImplementationOnce(
      async (_tableId, mutate: (locked: TableDefinition, tx: typeof trx) => Promise<unknown>) =>
        mutate(table, trx)
    )
    return trx
  }

  it('retains referenceTableId when adding a reference column', async () => {
    useTable(BASE_TABLE)

    const updated = await addTableColumn(
      'tbl_people',
      { name: 'Account', type: 'reference', referenceTableId: 'tbl_accounts' },
      'req_1'
    )

    expect(updated.schema.columns.at(-1)).toMatchObject({
      name: 'Account',
      type: 'reference',
      referenceTableId: 'tbl_accounts',
    })
  })

  it('retains the supplied target when converting a column to reference', async () => {
    useTable(BASE_TABLE)

    const updated = await updateColumnType(
      {
        tableId: 'tbl_people',
        columnName: 'col_name',
        newType: 'reference',
        referenceTableId: 'tbl_accounts',
      },
      'req_1'
    )

    expect(updated.schema.columns[0]).toMatchObject({
      id: 'col_name',
      type: 'reference',
      referenceTableId: 'tbl_accounts',
    })
  })

  it('changes a reference target without reading or rewriting rows', async () => {
    const trx = useTable(tableWithReference())

    const updated = await updateColumnReference(
      {
        tableId: 'tbl_people',
        columnName: 'col_account',
        referenceTableId: 'tbl_companies',
      },
      'req_1'
    )

    expect(updated.schema.columns[0]).toMatchObject({ referenceTableId: 'tbl_companies' })
    expect(trx.select).not.toHaveBeenCalled()
    expect(trx.execute).not.toHaveBeenCalled()
    expect(trx.update).toHaveBeenCalledOnce()
  })

  it('rejects reference metadata on a non-reference column', async () => {
    const trx = useTable(BASE_TABLE)

    await expect(
      updateColumnReference(
        {
          tableId: 'tbl_people',
          columnName: 'col_name',
          referenceTableId: 'tbl_accounts',
        },
        'req_1'
      )
    ).rejects.toMatchObject({ code: 'validation' })

    expect(trx.update).not.toHaveBeenCalled()
  })

  it('returns the locked table unchanged when the target is already set', async () => {
    const table = tableWithReference()
    const trx = useTable(table)

    const updated = await updateColumnReference(
      {
        tableId: 'tbl_people',
        columnName: 'col_account',
        referenceTableId: 'tbl_accounts',
      },
      'req_1'
    )

    expect(updated).toBe(table)
    expect(trx.update).not.toHaveBeenCalled()
  })

  it('does not rewrite the schema when the target and supplied constraints are unchanged', async () => {
    const table = tableWithReference()
    table.schema.columns[0] = { ...table.schema.columns[0], required: true, unique: true }
    const trx = useTable(table)

    const updated = await updateColumnReference(
      {
        tableId: 'tbl_people',
        columnName: 'col_account',
        referenceTableId: 'tbl_accounts',
        required: true,
        unique: true,
      },
      'req_1'
    )

    expect(updated).toBe(table)
    expect(trx.update).not.toHaveBeenCalled()
  })

  it('accepts a reference table ID at the standard identifier length', async () => {
    const maximumId = 't'.repeat(MAX_REFERENCE_TABLE_ID_LENGTH)
    useTable(tableWithReference())

    const updated = await updateColumnReference(
      {
        tableId: 'tbl_people',
        columnName: 'col_account',
        referenceTableId: maximumId,
      },
      'req_1'
    )

    expect(updated.schema.columns[0]).toMatchObject({ referenceTableId: maximumId })
    expect(mocks.set).toHaveBeenCalledOnce()
  })

  it('rejects a reference table ID longer than the standard identifier length', async () => {
    const oversizedId = 't'.repeat(MAX_REFERENCE_TABLE_ID_LENGTH + 1)
    const trx = useTable(tableWithReference())

    await expect(
      updateColumnReference(
        {
          tableId: 'tbl_people',
          columnName: 'col_account',
          referenceTableId: oversizedId,
        },
        'req_1'
      )
    ).rejects.toMatchObject({ code: 'validation' })

    expect(trx.update).not.toHaveBeenCalled()
  })
})
