/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import type { TableSchema } from '@/lib/table/types'

vi.mock('@/lib/realtime/notify', () => ({
  notifyWorkspaceTablesChanged: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/table/billing', () => ({
  assertRowCapacity: vi.fn().mockResolvedValue(undefined),
  notifyTableRowUsage: vi.fn(),
}))

import { createTable, getTableById } from '@/lib/table/service'

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

  it('creates an ordinary group-free table with a persisted default view', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [{ count: 0 }])

    const table = await create({ columns: [{ name: 'email', type: 'string' }] } as TableSchema)

    expect(table.name).toBe('contacts')
    expect(table.schema.columns[0].id).toEqual(expect.any(String))
    expect(dbChainMockFns.insert).toHaveBeenCalledWith(schemaMock.userTableDefinitions)
    expect(dbChainMockFns.insert).toHaveBeenCalledWith(schemaMock.tableViews)
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: table.id,
        workspaceId: WORKSPACE_ID,
        name: 'Default',
        config: {},
        isDefault: true,
        createdBy: 'user-1',
      })
    )
  })
})

const TABLE_ID = '0f2b1a4a-1e0e-4b4a-9a0f-0a2b3c4d5e6f'

/** A `user_table_definitions` row as the folded SELECT returns it. */
function definitionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TABLE_ID,
    name: 'contacts',
    description: null,
    schema: { columns: [{ id: 'col_email', name: 'email', type: 'string' }] },
    metadata: null,
    maxRows: 10000,
    workspaceId: WORKSPACE_ID,
    folderId: null,
    createdBy: 'user-1',
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    rowCount: 100,
    latestJob: null,
    schemaLocked: false,
    insertLocked: false,
    updateLocked: false,
    deleteLocked: false,
    ...overrides,
  }
}

/**
 * The job row is folded into the table SELECT as a lateral, so these cover both that
 * one query still carries every job field and that `rowCount` stays adjusted by a
 * running delete — the reason the two reads cannot be split apart.
 */
describe('getTableById job derivation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('reads the table and its latest job in a single query', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [definitionRow()])

    const table = await getTableById(TABLE_ID)

    expect(table).toMatchObject({ id: TABLE_ID, rowCount: 100 })
    expect(table).toMatchObject({
      jobStatus: null,
      jobId: null,
      jobType: null,
      jobError: null,
      jobRowsProcessed: 0,
    })
    expect(table).not.toHaveProperty('pendingDeleteRemaining')
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
    // double-cast-allowed: the mocked drizzle `sql` tag exposes the raw template parts
    const projected = dbChainMockFns.select.mock.calls[0][0] as unknown as {
      latestJob?: { strings: string[]; values: unknown[] }
    }
    expect(projected.latestJob?.strings.join(' ? ')).toContain("<> 'export'")
    expect(projected.latestJob?.values).toContain(schemaMock.userTableDefinitions.id)
  })

  it("reduces rowCount by a running delete job's remaining doomed rows", async () => {
    queueTableRows(schemaMock.userTableDefinitions, [
      definitionRow({
        latestJob: {
          id: 'job-1',
          type: 'delete',
          status: 'running',
          rowsProcessed: 4,
          error: null,
          doomedCount: 10,
        },
      }),
    ])

    const table = await getTableById(TABLE_ID)

    expect(table).toMatchObject({
      rowCount: 94,
      jobId: 'job-1',
      jobType: 'delete',
      jobStatus: 'running',
      jobRowsProcessed: 4,
    })
  })

  it('leaves rowCount alone for a running job that is not a delete', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [
      definitionRow({
        latestJob: {
          id: 'job-2',
          type: 'import',
          status: 'running',
          rowsProcessed: 4,
          error: null,
          doomedCount: 10,
        },
      }),
    ])

    expect(await getTableById(TABLE_ID)).toMatchObject({ rowCount: 100, jobType: 'import' })
  })

  it('leaves rowCount alone once the delete job is terminal', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [
      definitionRow({
        latestJob: {
          id: 'job-3',
          type: 'delete',
          status: 'ready',
          rowsProcessed: 4,
          error: null,
          doomedCount: 10,
        },
      }),
    ])

    expect(await getTableById(TABLE_ID)).toMatchObject({ rowCount: 100, jobStatus: 'ready' })
  })

  it('filters out archived tables unless includeArchived is set', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [definitionRow()])
    await getTableById(TABLE_ID)
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls[0][0],
        (node) =>
          node.type === 'isNull' && node.column === schemaMock.userTableDefinitions.archivedAt
      )
    ).toBe(true)

    const archivedAt = new Date('2026-01-03T00:00:00Z')
    queueTableRows(schemaMock.userTableDefinitions, [definitionRow({ archivedAt })])
    const archived = await getTableById(TABLE_ID, { includeArchived: true })

    expect(archived).toMatchObject({ archivedAt })
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls[1][0],
        (node) =>
          node.type === 'isNull' && node.column === schemaMock.userTableDefinitions.archivedAt
      )
    ).toBe(false)
  })

  it('runs the single query on a supplied transaction executor', async () => {
    const limit = vi.fn().mockResolvedValue([
      definitionRow({
        latestJob: {
          id: 'job-4',
          type: 'delete',
          status: 'running',
          rowsProcessed: 1,
          error: null,
          doomedCount: 5,
        },
      }),
    ])
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }))
    const tx = { select } as unknown as DbOrTx

    const table = await getTableById(TABLE_ID, { tx })

    expect(table).toMatchObject({ rowCount: 96, jobId: 'job-4' })
    expect(select).toHaveBeenCalledTimes(1)
    expect(limit).toHaveBeenCalledWith(1)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
