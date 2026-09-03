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
import { MAX_TABLE_BATCH_ITEMS } from '@/lib/table/constants'
import { TableLockedError } from '@/lib/table/mutation-locks'
import type { TableSchema } from '@/lib/table/types'

const mocks = vi.hoisted(() => ({
  assertColumnReferencesInWorkspace: vi.fn(),
  collectColumnReferencedTableIds: vi.fn(
    (columns: readonly { type: string; referenceTableId?: unknown }[]) => [
      ...new Set(
        columns.flatMap((column) =>
          column.type === 'reference' && typeof column.referenceTableId === 'string'
            ? [column.referenceTableId]
            : []
        )
      ),
    ]
  ),
  findActiveTableReferenceBlockers: vi.fn(),
  assertTableReferenceColumnsEnabled: vi.fn(),
  getWorkspaceWithOwner: vi.fn(),
  tableReferenceBlockerMessage: vi.fn(
    (target: string, blockers: string[]) =>
      `Cannot delete table "${target}" because it is referenced by table "${blockers[0]}". Remove the reference column first.`
  ),
  assertTableRowTtlEnabled: vi.fn(),
}))

vi.mock('@/lib/table/column-types/registry.server', () => ({
  assertColumnReferencesInWorkspace: mocks.assertColumnReferencesInWorkspace,
  collectColumnReferencedTableIds: mocks.collectColumnReferencedTableIds,
  findActiveTableReferenceBlockers: mocks.findActiveTableReferenceBlockers,
  tableReferenceBlockerMessage: mocks.tableReferenceBlockerMessage,
}))

vi.mock('@/lib/table/reference-columns/availability', () => ({
  assertTableReferenceColumnsEnabled: mocks.assertTableReferenceColumnsEnabled,
}))

vi.mock('@/lib/realtime/notify', () => ({
  notifyWorkspaceTablesChanged: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/table/billing', () => ({
  assertRowCapacity: vi.fn().mockResolvedValue(undefined),
  notifyTableRowUsage: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: mocks.getWorkspaceWithOwner,
}))

vi.mock('@/lib/table/ttl-availability', () => ({
  assertTableRowTtlEnabled: mocks.assertTableRowTtlEnabled,
}))

import {
  createTable,
  deleteTable,
  deleteTables,
  getTableById,
  listActiveTableNames,
  restoreTable,
} from '@/lib/table/service'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'

describe('listActiveTableNames', () => {
  beforeEach(() => resetDbChainMock())

  it('returns the name projection without loading table schemas', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [{ id: 'table-1', name: 'Accounts' }])

    await expect(listActiveTableNames(WORKSPACE_ID, ['table-1', 'table-2'])).resolves.toEqual([
      { id: 'table-1', name: 'Accounts' },
    ])
    expect(dbChainMockFns.select).toHaveBeenCalledWith({
      id: schemaMock.userTableDefinitions.id,
      name: schemaMock.userTableDefinitions.name,
    })
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls[0][0],
        (node) =>
          node.type === 'inArray' &&
          node.column === schemaMock.userTableDefinitions.id &&
          JSON.stringify(node.values) === JSON.stringify(['table-1', 'table-2'])
      )
    ).toBe(true)
  })

  it('skips the database when no table IDs are requested', async () => {
    await expect(listActiveTableNames(WORKSPACE_ID, [])).resolves.toEqual([])
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})

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
    mocks.assertColumnReferencesInWorkspace.mockResolvedValue(undefined)
    mocks.assertTableReferenceColumnsEnabled.mockResolvedValue(undefined)
    mocks.assertTableRowTtlEnabled.mockResolvedValue(undefined)
  })

  it('rejects a TTL schema before persistence when the feature is disabled', async () => {
    mocks.assertTableRowTtlEnabled.mockRejectedValue(
      new Error('Expiration columns are not enabled')
    )

    await expect(
      create({ columns: [{ name: 'expires_at', type: 'ttl' }] } as TableSchema)
    ).rejects.toThrow('Expiration columns are not enabled')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
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

  it('validates Reference targets before persisting the new table', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [{ count: 0 }])

    await create({
      columns: [
        {
          name: 'account',
          type: 'reference',
          referenceTableId: 'tbl_accounts',
        },
      ],
    } as TableSchema)

    expect(mocks.assertColumnReferencesInWorkspace).toHaveBeenCalledWith(
      expect.anything(),
      WORKSPACE_ID,
      [expect.objectContaining({ referenceTableId: 'tbl_accounts' })]
    )
  })

  it('rejects a Reference schema before opening a transaction when the feature is disabled', async () => {
    mocks.assertTableReferenceColumnsEnabled.mockRejectedValueOnce({ code: 'forbidden' })

    await expect(
      create({
        columns: [
          {
            name: 'account',
            type: 'reference',
            referenceTableId: 'tbl_accounts',
          },
        ],
      } as TableSchema)
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })

  it('does not insert a table when a Reference target is unavailable', async () => {
    mocks.assertColumnReferencesInWorkspace.mockRejectedValueOnce({ code: 'not_found' })

    await expect(
      create({
        columns: [
          {
            name: 'account',
            type: 'reference',
            referenceTableId: 'tbl_missing',
          },
        ],
      } as TableSchema)
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
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

describe('restoreTable reference validation', () => {
  const referenceSchema = {
    columns: [
      {
        id: 'col_account',
        name: 'account',
        type: 'reference',
        referenceTableId: 'tbl_accounts',
      },
    ],
  } as TableSchema

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.assertColumnReferencesInWorkspace.mockResolvedValue(undefined)
    mocks.getWorkspaceWithOwner.mockResolvedValue({ id: WORKSPACE_ID, archivedAt: null })
  })

  it('validates targets under the row lock and admits the restore cohort', async () => {
    const archived = definitionRow({
      archivedAt: new Date('2026-01-03T00:00:00Z'),
      schema: referenceSchema,
    })
    queueTableRows(schemaMock.userTableDefinitions, [archived])
    queueTableRows(schemaMock.userTableDefinitions, [archived])
    queueTableRows(schemaMock.userTableDefinitions, [])
    const restoringTableIds = new Set(['tbl_accounts'])

    await restoreTable(TABLE_ID, 'request-1', { restoringTableIds })

    expect(mocks.assertColumnReferencesInWorkspace).toHaveBeenCalledWith(
      expect.anything(),
      WORKSPACE_ID,
      referenceSchema.columns,
      { allowedArchivedTableIds: new Set(['tbl_accounts', TABLE_ID]) }
    )
    const advisoryLockCallIndex = dbChainMockFns.execute.mock.calls.findIndex(([query]) =>
      ((query as { strings?: readonly string[] }).strings ?? []).some((part) =>
        part.includes('pg_advisory_xact_lock')
      )
    )
    expect(advisoryLockCallIndex).toBeGreaterThanOrEqual(0)
    expect(dbChainMockFns.execute.mock.invocationCallOrder[advisoryLockCallIndex]).toBeLessThan(
      dbChainMockFns.select.mock.invocationCallOrder[1]
    )
    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.userTableDefinitions)
  })

  it('leaves the table archived when a reference target is unavailable', async () => {
    const archived = definitionRow({
      archivedAt: new Date('2026-01-03T00:00:00Z'),
      schema: referenceSchema,
    })
    queueTableRows(schemaMock.userTableDefinitions, [archived])
    queueTableRows(schemaMock.userTableDefinitions, [archived])
    mocks.assertColumnReferencesInWorkspace.mockRejectedValueOnce({ code: 'not_found' })

    await expect(restoreTable(TABLE_ID, 'request-1')).rejects.toMatchObject({ code: 'not_found' })

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})

describe('deleteTable reference guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.findActiveTableReferenceBlockers.mockResolvedValue([])
  })

  const activeTable = {
    name: 'Customers',
    archivedAt: null,
    deleteLocked: false,
    workspaceId: WORKSPACE_ID,
  }

  it('archives an unreferenced table inside the guarded transaction', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [activeTable])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { name: 'Customers', workspaceId: WORKSPACE_ID },
    ])

    await expect(deleteTable('tbl_customers', 'request-1')).resolves.toEqual({
      archived: { name: 'Customers', workspaceId: WORKSPACE_ID },
    })

    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(mocks.findActiveTableReferenceBlockers).toHaveBeenCalledWith(
      expect.anything(),
      WORKSPACE_ID,
      { tableIds: ['tbl_customers'] }
    )
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
  })

  it('blocks deletion and names the table holding the reference', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [activeTable])
    mocks.findActiveTableReferenceBlockers.mockResolvedValueOnce([
      {
        targetTableId: 'tbl_customers',
        targetTableName: 'Customers',
        targetFolderId: null,
        referencingTableName: 'Orders',
      },
    ])

    await expect(deleteTable('tbl_customers', 'request-1')).rejects.toEqual(
      expect.objectContaining({
        code: 'conflict',
        message:
          'Cannot delete table "Customers" because it is referenced by table "Orders". Remove the reference column first.',
      })
    )
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('keeps the existing delete-lock verdict ahead of the reference check', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [{ ...activeTable, deleteLocked: true }])

    await expect(deleteTable('tbl_customers', 'request-1')).rejects.toMatchObject({
      name: 'TableLockedError',
      lock: 'delete',
    })
    expect(mocks.findActiveTableReferenceBlockers).not.toHaveBeenCalled()
  })
})

function batchTable(
  id: string,
  name: string,
  referencedTableIds: readonly string[] = []
): {
  id: string
  name: string
  schema: TableSchema
  archivedAt: null
  deleteLocked: false
  workspaceId: string
} {
  return {
    id,
    name,
    schema: {
      columns: referencedTableIds.map((referenceTableId, index) => ({
        id: `reference-${index}`,
        name: `Reference ${index}`,
        type: 'reference' as const,
        referenceTableId,
      })),
    },
    archivedAt: null,
    deleteLocked: false,
    workspaceId: WORKSPACE_ID,
  }
}

describe('deleteTables reference guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.findActiveTableReferenceBlockers.mockResolvedValue([])
  })

  it('returns immediately for an empty selection', async () => {
    await expect(
      deleteTables([], 'request-1', {
        expectedWorkspaceId: WORKSPACE_ID,
        skipNotify: true,
      })
    ).resolves.toEqual({ archived: [], failed: [], notFound: [] })

    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(mocks.findActiveTableReferenceBlockers).not.toHaveBeenCalled()
  })

  it('acquires every schema advisory lock in id order before selecting rows for update', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [
      batchTable('tbl_customers', 'Customers'),
      batchTable('tbl_orders', 'Orders'),
    ])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ id: 'tbl_orders', name: 'Orders', workspaceId: WORKSPACE_ID }])
      .mockResolvedValueOnce([
        { id: 'tbl_customers', name: 'Customers', workspaceId: WORKSPACE_ID },
      ])

    await deleteTables(['tbl_orders', 'tbl_customers'], 'request-1', {
      expectedWorkspaceId: WORKSPACE_ID,
      skipNotify: true,
    })

    const advisoryLockCallIndex = dbChainMockFns.execute.mock.calls.findIndex(([query]) =>
      ((query as { strings?: readonly string[] }).strings ?? []).some((part) =>
        part.includes('pg_advisory_xact_lock')
      )
    )
    expect(advisoryLockCallIndex).toBeGreaterThanOrEqual(0)
    const advisoryLockQuery = dbChainMockFns.execute.mock.calls[advisoryLockCallIndex][0] as {
      strings?: readonly string[]
      values?: unknown[]
    }
    expect(advisoryLockQuery.strings?.join('')).toContain('FROM unnest(')
    expect(advisoryLockQuery.values).toContainEqual(['tbl_customers', 'tbl_orders'])
    expect(dbChainMockFns.execute.mock.invocationCallOrder[advisoryLockCallIndex]).toBeLessThan(
      dbChainMockFns.select.mock.invocationCallOrder[0]
    )
  })

  it('checks the complete deletion selection once before archiving each table', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [
      batchTable('tbl_customers', 'Customers'),
      batchTable('tbl_orders', 'Orders'),
    ])
    dbChainMockFns.returning
      .mockResolvedValueOnce([
        { id: 'tbl_customers', name: 'Customers', workspaceId: WORKSPACE_ID },
      ])
      .mockResolvedValueOnce([{ id: 'tbl_orders', name: 'Orders', workspaceId: WORKSPACE_ID }])

    await expect(
      deleteTables(['tbl_customers', 'tbl_orders'], 'request-1', {
        expectedWorkspaceId: WORKSPACE_ID,
        skipNotify: true,
      })
    ).resolves.toMatchObject({
      archived: [
        { id: 'tbl_customers', name: 'Customers', workspaceId: WORKSPACE_ID },
        { id: 'tbl_orders', name: 'Orders', workspaceId: WORKSPACE_ID },
      ],
      failed: [],
      notFound: [],
    })

    expect(mocks.findActiveTableReferenceBlockers).toHaveBeenCalledOnce()
    expect(mocks.findActiveTableReferenceBlockers).toHaveBeenCalledWith(
      expect.anything(),
      WORKSPACE_ID,
      { tableIds: ['tbl_customers', 'tbl_orders'] }
    )
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(2)
  })

  it('archives unreferenced tables while reporting referenced targets', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [
      batchTable('tbl_customers', 'Customers'),
      batchTable('tbl_orders', 'Orders'),
    ])
    mocks.findActiveTableReferenceBlockers.mockResolvedValueOnce([
      {
        targetTableId: 'tbl_customers',
        targetTableName: 'Customers',
        targetFolderId: null,
        referencingTableName: 'Invoices',
      },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'tbl_orders', name: 'Orders', workspaceId: WORKSPACE_ID },
    ])

    await expect(
      deleteTables(['tbl_customers', 'tbl_orders'], 'request-1', {
        expectedWorkspaceId: WORKSPACE_ID,
        skipNotify: true,
      })
    ).resolves.toEqual({
      archived: [{ id: 'tbl_orders', name: 'Orders', workspaceId: WORKSPACE_ID }],
      failed: [
        {
          id: 'tbl_customers',
          name: 'Customers',
          reason:
            'Cannot delete table "Customers" because it is referenced by table "Invoices". Remove the reference column first.',
          code: 'reference',
        },
      ],
      notFound: [],
    })

    expect(mocks.findActiveTableReferenceBlockers).toHaveBeenCalledOnce()
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
  })

  it('rejects a multi-table reference cycle while allowing unrelated tables to archive', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [
      batchTable('tbl_accounts', 'Accounts', ['tbl_contacts']),
      batchTable('tbl_contacts', 'Contacts', ['tbl_accounts']),
      batchTable('tbl_notes', 'Notes'),
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'tbl_notes', name: 'Notes', workspaceId: WORKSPACE_ID },
    ])

    await expect(
      deleteTables(['tbl_accounts', 'tbl_contacts', 'tbl_notes'], 'request-1', {
        expectedWorkspaceId: WORKSPACE_ID,
        skipNotify: true,
      })
    ).resolves.toEqual({
      archived: [{ id: 'tbl_notes', name: 'Notes', workspaceId: WORKSPACE_ID }],
      failed: [
        {
          id: 'tbl_accounts',
          name: 'Accounts',
          reason:
            'Cannot delete table "Accounts" because the selected tables contain a reference cycle that cannot be restored safely. Remove a reference column first.',
          code: 'reference_cycle',
        },
        {
          id: 'tbl_contacts',
          name: 'Contacts',
          reason:
            'Cannot delete table "Contacts" because the selected tables contain a reference cycle that cannot be restored safely. Remove a reference column first.',
          code: 'reference_cycle',
        },
      ],
      notFound: [],
    })

    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
  })

  it('archives a reference cycle atomically when it will be restored as one cohort', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [
      batchTable('tbl_accounts', 'Accounts', ['tbl_contacts']),
      batchTable('tbl_contacts', 'Contacts', ['tbl_accounts']),
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'tbl_accounts', name: 'Accounts', workspaceId: WORKSPACE_ID },
      { id: 'tbl_contacts', name: 'Contacts', workspaceId: WORKSPACE_ID },
    ])

    await expect(
      deleteTables(['tbl_accounts', 'tbl_contacts'], 'folder-cascade-folder-1', {
        expectedWorkspaceId: WORKSPACE_ID,
        skipNotify: true,
        archiveAsCohort: true,
      })
    ).resolves.toEqual({
      archived: [
        { id: 'tbl_accounts', name: 'Accounts', workspaceId: WORKSPACE_ID },
        { id: 'tbl_contacts', name: 'Contacts', workspaceId: WORKSPACE_ID },
      ],
      failed: [],
      notFound: [],
    })

    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
  })

  it('archives none of a restore cohort when one table becomes delete-locked', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [
      { ...batchTable('tbl_accounts', 'Accounts'), deleteLocked: true },
      batchTable('tbl_contacts', 'Contacts'),
    ])

    await expect(
      deleteTables(['tbl_accounts', 'tbl_contacts'], 'folder-cascade-folder-1', {
        expectedWorkspaceId: WORKSPACE_ID,
        skipNotify: true,
        archiveAsCohort: true,
      })
    ).resolves.toEqual({
      archived: [],
      failed: [
        {
          id: 'tbl_accounts',
          name: 'Accounts',
          reason: new TableLockedError('delete').message,
          code: 'locked',
        },
      ],
      notFound: [],
    })

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('allows a self-referencing table to archive', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [
      batchTable('tbl_categories', 'Categories', ['tbl_categories']),
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'tbl_categories', name: 'Categories', workspaceId: WORKSPACE_ID },
    ])

    await expect(
      deleteTables(['tbl_categories'], 'request-1', {
        expectedWorkspaceId: WORKSPACE_ID,
        skipNotify: true,
      })
    ).resolves.toEqual({
      archived: [{ id: 'tbl_categories', name: 'Categories', workspaceId: WORKSPACE_ID }],
      failed: [],
      notFound: [],
    })
  })

  it('archives a selected referrer before its target when request order is reversed', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [
      batchTable('tbl_referrer', 'Referrer', ['tbl_target']),
      batchTable('tbl_target', 'Target'),
    ])
    const statementFailure = new Error('statement timeout')
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ id: 'tbl_referrer', name: 'Referrer', workspaceId: WORKSPACE_ID }])
      .mockRejectedValueOnce(statementFailure)

    await expect(
      deleteTables(['tbl_target', 'tbl_referrer'], 'request-1', {
        expectedWorkspaceId: WORKSPACE_ID,
        skipNotify: true,
      })
    ).resolves.toEqual({
      archived: [{ id: 'tbl_referrer', name: 'Referrer', workspaceId: WORKSPACE_ID }],
      failed: [],
      notFound: [],
      terminalError: statementFailure,
    })

    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls[1][0],
        (node) =>
          node.type === 'eq' &&
          node.left === schemaMock.userTableDefinitions.id &&
          node.right === 'tbl_referrer'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls[2][0],
        (node) =>
          node.type === 'eq' &&
          node.left === schemaMock.userTableDefinitions.id &&
          node.right === 'tbl_target'
      )
    ).toBe(true)
  })

  it('stops before a target when its referrer archive returns no row', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [
      batchTable('tbl_referrer', 'Referrer', ['tbl_target']),
      batchTable('tbl_target', 'Target'),
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const result = await deleteTables(['tbl_target', 'tbl_referrer'], 'request-1', {
      expectedWorkspaceId: WORKSPACE_ID,
      skipNotify: true,
    })

    expect(result).toMatchObject({
      archived: [],
      failed: [],
      notFound: ['tbl_referrer'],
      terminalError: { code: 'internal' },
    })
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
  })

  it('returns the committed prefix when an archive statement can roll back to its savepoint', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [
      batchTable('tbl_customers', 'Customers'),
      batchTable('tbl_orders', 'Orders'),
    ])
    const statementFailure = new Error('statement timeout')
    dbChainMockFns.returning
      .mockResolvedValueOnce([
        { id: 'tbl_customers', name: 'Customers', workspaceId: WORKSPACE_ID },
      ])
      .mockRejectedValueOnce(statementFailure)

    await expect(
      deleteTables(['tbl_customers', 'tbl_orders'], 'request-1', {
        expectedWorkspaceId: WORKSPACE_ID,
        skipNotify: true,
      })
    ).resolves.toEqual({
      archived: [{ id: 'tbl_customers', name: 'Customers', workspaceId: WORKSPACE_ID }],
      failed: [],
      notFound: [],
      terminalError: statementFailure,
    })

    expect(mocks.findActiveTableReferenceBlockers).toHaveBeenCalledOnce()
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(2)
  })

  it('rejects an oversized selection before opening a transaction', async () => {
    await expect(
      deleteTables(
        Array.from({ length: MAX_TABLE_BATCH_ITEMS + 1 }, (_, index) => `table-${index}`),
        'request-1',
        { expectedWorkspaceId: WORKSPACE_ID }
      )
    ).rejects.toMatchObject({ code: 'validation' })

    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })
})
