/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableSchema } from '@/lib/table/types'

vi.mock('@/lib/realtime/notify', () => ({
  notifyWorkspaceTablesChanged: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/table/billing', () => ({
  assertRowCapacity: vi.fn().mockResolvedValue(undefined),
  notifyTableRowUsage: vi.fn(),
}))

import { createTable } from '@/lib/table/service'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'

/** A column produced by a workflow group, and the group that declares it. */
function groupedSchema(overrides: { columnGroupId: string; groupId: string }): TableSchema {
  return {
    columns: [
      { id: 'col_email', name: 'email', type: 'string' },
      {
        id: 'col_summary',
        name: 'summary',
        type: 'string',
        workflowGroupId: overrides.columnGroupId,
      },
    ],
    workflowGroups: [
      {
        id: overrides.groupId,
        workflowId: 'workflow-1',
        outputs: [{ blockId: 'block-1', path: 'out', columnName: 'col_summary' }],
      },
    ],
  } as TableSchema
}

function create(schema: TableSchema) {
  return createTable(
    { name: 'contacts', schema, workspaceId: WORKSPACE_ID, userId: 'user-1' },
    'request-1'
  )
}

describe('createTable schema invariants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  /**
   * `POST /api/table` and `POST /api/v1/tables` both forward caller-supplied
   * columns into this function, and their bodies carry no `workflowGroups`, so
   * any group id they carry names a group that cannot exist. Stored, it fails
   * every later add-column and add-group with a 400 that nothing can clear.
   */
  it('rejects a column naming a workflow group the schema does not declare', async () => {
    await expect(
      create({
        columns: [
          { id: 'col_email', name: 'email', type: 'string', workflowGroupId: 'wfg_missing' },
        ],
      } as TableSchema)
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('references missing workflow group "wfg_missing"'),
    })

    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('still creates a table whose columns name a group the same schema declares', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [{ count: 0 }])

    const table = await create(groupedSchema({ columnGroupId: 'group-1', groupId: 'group-1' }))

    expect(table.schema.columns.map((column) => column.workflowGroupId)).toEqual([
      undefined,
      'group-1',
    ])
    expect(dbChainMockFns.insert).toHaveBeenCalled()
  })

  it('creates an ordinary group-free table unchanged', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [{ count: 0 }])

    const table = await create({ columns: [{ name: 'email', type: 'string' }] } as TableSchema)

    expect(table.name).toBe('contacts')
    expect(table.schema.columns[0].id).toEqual(expect.any(String))
    expect(dbChainMockFns.insert).toHaveBeenCalled()
  })
})
