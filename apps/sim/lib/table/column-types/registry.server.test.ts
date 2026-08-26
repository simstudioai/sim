/**
 * @vitest-environment node
 */

import { hasMockCondition, schemaMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import { assertColumnReferencesInWorkspace } from '@/lib/table/column-types/registry.server'
import type { DbTransaction } from '@/lib/table/planner'

function transactionWithTargets(targetIds: string[]) {
  const where = vi.fn().mockResolvedValue(targetIds.map((id) => ({ id })))
  const from = vi.fn(() => ({ where }))
  const select = vi.fn(() => ({ from }))
  return {
    trx: { select } as unknown as DbTransaction,
    select,
    where,
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
    const { trx, select, where } = transactionWithTargets(['tbl_accounts', 'tbl_companies'])

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
    expect(
      hasMockCondition(
        condition,
        (node) =>
          node.type === 'isNull' && node.column === schemaMock.userTableDefinitions.archivedAt
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
