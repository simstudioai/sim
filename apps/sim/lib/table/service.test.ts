import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { tableBillingMock } from '@sim/testing/mocks/table-billing.mock'
import {
  tableTtlAvailabilityMock,
  tableTtlAvailabilityMockFns,
} from '@sim/testing/mocks/table-ttl-availability.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableSchema } from '@/lib/table/types'

vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

vi.mock('@/lib/table/billing', () => tableBillingMock)

vi.mock('@/lib/table/ttl-availability', () => tableTtlAvailabilityMock)

import { createTable, getTableById } from '@/lib/table/service'

const mockAssertTableRowTtlEnabled = tableTtlAvailabilityMockFns.mockAssertTableRowTtlEnabled

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'

function create(schema: TableSchema) {
  return createTable(
    { name: 'contacts', schema, workspaceId: WORKSPACE_ID, userId: 'user-1' },
    'request-1'
  )
}

describe('createTable schema invariants', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockAssertTableRowTtlEnabled.mockResolvedValue(undefined)
  })

  it('rejects a TTL schema before persistence when the feature is disabled', async () => {
    mockAssertTableRowTtlEnabled.mockRejectedValue(new Error('Expiration columns are not enabled'))

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
    resetDbChainMock()
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
})
