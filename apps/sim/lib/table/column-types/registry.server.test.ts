/**
 * @vitest-environment node
 */

import { hasMockCondition, schemaMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import {
  assertColumnReferencesInWorkspace,
  findActiveTableReferenceBlockers,
  tableReferenceBlockerMessage,
} from '@/lib/table/column-types/registry.server'
import type { DbTransaction } from '@/lib/table/planner'

function transactionWithTargets(targetIds: string[]) {
  const lock = vi.fn().mockResolvedValue(targetIds.map((id) => ({ id })))
  const where = vi.fn(() => ({ for: lock }))
  const from = vi.fn(() => ({ where }))
  const select = vi.fn(() => ({ from }))
  return {
    trx: { select } as unknown as DbTransaction,
    select,
    where,
    lock,
  }
}

describe('assertColumnReferencesInWorkspace', () => {
  it('skips the database when no column type references a table', async () => {
    const { trx, select } = transactionWithTargets([])

    await assertColumnReferencesInWorkspace(trx, 'ws_1', [
      { id: 'col_name', name: 'Name', type: 'string' },
    ])

    expect(select).not.toHaveBeenCalled()
  })

  it('accepts active Reference targets returned for the workspace', async () => {
    const { trx, select, where, lock } = transactionWithTargets(['tbl_accounts', 'tbl_companies'])

    await assertColumnReferencesInWorkspace(trx, 'ws_1', [
      {
        id: 'col_account',
        name: 'Account',
        type: 'reference',
        referenceTableId: 'tbl_accounts',
      },
      {
        id: 'col_company',
        name: 'Company',
        type: 'reference',
        referenceTableId: 'tbl_companies',
      },
      {
        id: 'col_duplicate',
        name: 'Duplicate',
        type: 'reference',
        referenceTableId: 'tbl_accounts',
      },
    ])

    expect(select).toHaveBeenCalledOnce()
    const condition = where.mock.calls[0][0]
    expect(hasMockCondition(condition, (node) => node.type === 'eq' && node.right === 'ws_1')).toBe(
      true
    )
    expect(
      hasMockCondition(
        condition,
        (node) =>
          node.type === 'inArray' &&
          node.column === schemaMock.userTableDefinitions.id &&
          Array.isArray(node.values) &&
          node.values.length === 2
      )
    ).toBe(true)
    expect(lock).toHaveBeenCalledWith('key share')
    expect(
      hasMockCondition(
        condition,
        (node) =>
          node.type === 'isNull' && node.column === schemaMock.userTableDefinitions.archivedAt
      )
    ).toBe(true)
  })

  it('admits archived targets that are part of the same restore cohort', async () => {
    const { trx, where } = transactionWithTargets(['tbl_accounts', 'tbl_companies'])

    await assertColumnReferencesInWorkspace(
      trx,
      'ws_1',
      [
        {
          id: 'col_account',
          name: 'Account',
          type: 'reference',
          referenceTableId: 'tbl_accounts',
        },
        {
          id: 'col_company',
          name: 'Company',
          type: 'reference',
          referenceTableId: 'tbl_companies',
        },
      ],
      { allowedArchivedTableIds: new Set(['tbl_companies']) }
    )

    const condition = where.mock.calls[0][0]
    expect(
      hasMockCondition(
        condition,
        (node) =>
          node.type === 'or' &&
          Array.isArray(node.conditions) &&
          node.conditions.some(
            (nested) =>
              typeof nested === 'object' &&
              nested !== null &&
              'type' in nested &&
              nested.type === 'inArray' &&
              'column' in nested &&
              nested.column === schemaMock.userTableDefinitions.id &&
              'values' in nested &&
              Array.isArray(nested.values) &&
              nested.values.length === 1 &&
              nested.values[0] === 'tbl_companies'
          )
      )
    ).toBe(true)
  })

  it('conceals missing, archived, and cross-workspace targets as not found', async () => {
    const { trx } = transactionWithTargets(['tbl_accounts'])

    await expect(
      assertColumnReferencesInWorkspace(trx, 'ws_1', [
        {
          id: 'col_account',
          name: 'Account',
          type: 'reference',
          referenceTableId: 'tbl_accounts',
        },
        {
          id: 'col_company',
          name: 'Company',
          type: 'reference',
          referenceTableId: 'tbl_unavailable',
        },
      ])
    ).rejects.toMatchObject({
      code: 'not_found',
      message: 'Reference table "tbl_unavailable" not found in this workspace',
    })
  })
})

describe('findActiveTableReferenceBlockers', () => {
  const activeTables = [
    {
      id: 'tbl_customers',
      name: 'Customers',
      folderId: 'folder_sales',
      schema: { columns: [{ id: 'name', name: 'Name', type: 'string' }] },
    },
    {
      id: 'tbl_orders',
      name: 'Orders',
      folderId: null,
      schema: {
        columns: [
          {
            id: 'customer',
            name: 'Customer',
            type: 'reference',
            referenceTableId: 'tbl_customers',
          },
        ],
      },
    },
  ]

  function executorWithTables(tables = activeTables) {
    const where = vi.fn().mockResolvedValue(tables)
    const from = vi.fn(() => ({ where }))
    return { select: vi.fn(() => ({ from })) } as unknown as DbOrTx
  }

  it('names the referring table for a selected target table', async () => {
    await expect(
      findActiveTableReferenceBlockers(executorWithTables(), 'ws_1', {
        tableIds: ['tbl_customers'],
      })
    ).resolves.toEqual([
      {
        targetTableId: 'tbl_customers',
        targetTableName: 'Customers',
        targetFolderId: 'folder_sales',
        referencingTableName: 'Orders',
      },
    ])
  })

  it('finds referenced targets anywhere in a selected folder subtree', async () => {
    const blockers = await findActiveTableReferenceBlockers(executorWithTables(), 'ws_1', {
      folderIds: new Set(['folder_sales']),
    })

    expect(blockers).toHaveLength(1)
    expect(blockers[0]?.targetTableName).toBe('Customers')
  })

  it('allows references between tables in the same deletion selection', async () => {
    await expect(
      findActiveTableReferenceBlockers(executorWithTables(), 'ws_1', {
        tableIds: ['tbl_customers', 'tbl_orders'],
      })
    ).resolves.toEqual([])
  })

  it('does not inspect untraversed selected target schemas', async () => {
    const selectedTarget = {
      id: 'tbl_customers',
      name: 'Customers',
      folderId: 'folder_sales',
      get schema() {
        throw new Error('selected target schema should not be inspected')
      },
    }

    await expect(
      findActiveTableReferenceBlockers(executorWithTables([selectedTarget]), 'ws_1', {
        tableIds: ['tbl_customers'],
      })
    ).resolves.toEqual([])
  })

  it('keeps transitively referenced targets when another selected table cannot be deleted', async () => {
    const tables = [
      ...activeTables,
      {
        id: 'tbl_invoices',
        name: 'Invoices',
        folderId: null,
        schema: {
          columns: [
            {
              id: 'order',
              name: 'Order',
              type: 'reference',
              referenceTableId: 'tbl_orders',
            },
          ],
        },
      },
    ]

    await expect(
      findActiveTableReferenceBlockers(executorWithTables(tables), 'ws_1', {
        tableIds: ['tbl_customers', 'tbl_orders'],
      })
    ).resolves.toEqual([
      {
        targetTableId: 'tbl_customers',
        targetTableName: 'Customers',
        targetFolderId: 'folder_sales',
        referencingTableName: 'Orders',
      },
      {
        targetTableId: 'tbl_orders',
        targetTableName: 'Orders',
        targetFolderId: null,
        referencingTableName: 'Invoices',
      },
    ])
  })

  it('allows a self-referencing table to be deleted', async () => {
    const selfReferencingTable = {
      id: 'tbl_categories',
      name: 'Categories',
      folderId: null,
      schema: {
        columns: [
          {
            id: 'parent',
            name: 'Parent',
            type: 'reference',
            referenceTableId: 'tbl_categories',
          },
        ],
      },
    }

    await expect(
      findActiveTableReferenceBlockers(executorWithTables([selfReferencingTable]), 'ws_1', {
        tableIds: ['tbl_categories'],
      })
    ).resolves.toEqual([])
  })
})

describe('tableReferenceBlockerMessage', () => {
  it('shows the target and every table preventing deletion', () => {
    expect(tableReferenceBlockerMessage('Customers', ['Orders', 'Invoices'])).toBe(
      'Cannot delete table "Customers" because it is referenced by tables "Invoices", "Orders". Remove the reference columns first.'
    )
  })
})
