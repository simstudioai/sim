import { db } from '@sim/db'
import { permissions, user, userTableDefinitions, userTableRows, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createExecutorPrincipal } from '@sim/testing/factories/principal.factory'
import { storageServiceMock } from '@sim/testing/mocks/storage-service.mock'
import { tableBillingMock, tableBillingMockFns } from '@sim/testing/mocks/table-billing.mock'
import { tableEventsMock } from '@sim/testing/mocks/table-events.mock'
import { tableTriggerMock } from '@sim/testing/mocks/table-trigger.mock'
import { tableWorkflowColumnsMock } from '@sim/testing/mocks/table-workflow-columns.mock'
import { generateId } from '@sim/utils/id'
import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/table/billing', () => tableBillingMock)
vi.mock('@/lib/table/events', () => tableEventsMock)
vi.mock('@/lib/table/trigger', () => tableTriggerMock)
vi.mock('@/lib/table/workflow-columns', () => tableWorkflowColumnsMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

import {
  insertTableRowsContract,
  updateTableRowContract,
  updateTableRowsByFilterContract,
  upsertTableRowContract,
} from '@/lib/api/contracts/tables'
import {
  executeTableInsertRows,
  executeTableUpdateRow,
  executeTableUpdateRowsByFilter,
  executeTableUpsertRow,
  type TableToolOperationContext,
  type TableToolOperationResult,
} from '@/lib/internal/table/operations'
import type { RowData } from '@/lib/table'

/**
 * The workflow Table tools write leniently: a key naming no column is dropped, not refused. These
 * runs go through the tool operations against PostgreSQL and parse each body with its route
 * contract, as `executeTableTool` does, so a key the write dropped must survive to the tool as
 * `ignoredColumns` while the stored row stays exactly what it was before the field existed.
 */
describe('Table tool writes report the keys they drop', () => {
  let userId: string
  let workspaceId: string
  let tableId: string

  beforeEach(async () => {
    userId = generateId()
    workspaceId = generateId()
    tableId = generateId()
    const now = new Date()
    tableBillingMockFns.mockAssertRowCapacity.mockResolvedValue(10_000)
    await db.insert(user).values({
      id: userId,
      name: 'Ignored columns fixture',
      email: `${userId}@ignored-columns.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Ignored columns fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(permissions).values({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
    })
    await db.insert(userTableDefinitions).values({
      id: tableId,
      workspaceId,
      name: 'Leads',
      createdBy: userId,
      schema: {
        columns: [
          { id: 'col_email', name: 'email', type: 'string', unique: true },
          { id: 'col_score', name: 'score', type: 'number' },
        ],
      },
    })
  })

  afterEach(async () => {
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
  })

  function context(): TableToolOperationContext {
    return {
      principal: createExecutorPrincipal({
        subjectUserId: userId,
        workspaceId,
        delegationId: generateId(),
        audience: 'sim:tables',
        resourceScope: { tableId },
        delegationContext: { kind: 'workflow_execution', workflowId: 'wf-ignored-columns' },
      }),
      headers: new Headers(),
      requestId: 'request-ignored-columns',
    }
  }

  /** The body the tool receives: what `executeTableTool` returns after its contract parse. */
  function delivered(
    contract: { response: { schema: { parse: (body: unknown) => unknown } } },
    result: TableToolOperationResult
  ) {
    return (contract.response.schema.parse(result.body) as { data: Record<string, unknown> }).data
  }

  async function storedRows() {
    const rows = await db
      .select({ data: userTableRows.data })
      .from(userTableRows)
      .where(eq(userTableRows.tableId, tableId))
      .orderBy(asc(userTableRows.orderKey))
    return rows.map((row) => row.data)
  }

  async function seed(email: string) {
    const result = await executeTableInsertRows(
      tableId,
      { workspaceId, data: { email, score: 1 } },
      context()
    )
    return (result.body.data as { row: { id: string } }).row.id
  }

  it.each<{ name: string; data: RowData; ignored: string[]; stored: RowData }>([
    {
      name: 'no key unknown',
      data: { email: 'a@x.co', score: 3 },
      ignored: [],
      stored: { col_email: 'a@x.co', col_score: 3 },
    },
    {
      name: 'some keys unknown',
      data: { email: 'a@x.co', nickname: 'A' },
      ignored: ['nickname'],
      stored: { col_email: 'a@x.co' },
    },
    {
      name: 'every key unknown',
      data: { nickname: 'A', tier: 'gold' },
      ignored: ['nickname', 'tier'],
      stored: {},
    },
  ])('a single insert with $name', async ({ data, ignored, stored }) => {
    const result = await executeTableInsertRows(tableId, { workspaceId, data }, context())

    expect(delivered(insertTableRowsContract, result).ignoredColumns).toEqual(ignored)
    expect(await storedRows()).toEqual([stored])
  })

  it('a batch insert names each dropped key once, in the order first sent', async () => {
    const result = await executeTableInsertRows(
      tableId,
      {
        workspaceId,
        rows: [
          { email: 'a@x.co', nickname: 'A' },
          { email: 'b@x.co', tier: 'gold', nickname: 'B' },
        ],
      },
      context()
    )

    const data = delivered(insertTableRowsContract, result)
    expect(data.ignoredColumns).toEqual(['nickname', 'tier'])
    expect(data.insertedCount).toBe(2)
    expect(await storedRows()).toEqual([{ col_email: 'a@x.co' }, { col_email: 'b@x.co' }])
  })

  it.each([
    { operation: 'insert', existing: false },
    { operation: 'update', existing: true },
  ])('an upsert that resolves to an $operation', async ({ operation, existing }) => {
    if (existing) await seed('a@x.co')

    const result = await executeTableUpsertRow(
      tableId,
      { workspaceId, data: { email: 'a@x.co', score: 5, nickname: 'A' }, conflictTarget: 'email' },
      context()
    )

    const data = delivered(upsertTableRowContract, result)
    expect(data.operation).toBe(operation)
    expect(data.ignoredColumns).toEqual(['nickname'])
    expect(await storedRows()).toEqual([{ col_email: 'a@x.co', col_score: 5 }])
  })

  it('an update of one row', async () => {
    const rowId = await seed('a@x.co')

    const result = await executeTableUpdateRow(
      tableId,
      rowId,
      { workspaceId, data: { score: 9, tier: 'gold' } },
      context()
    )

    expect(delivered(updateTableRowContract, result).ignoredColumns).toEqual(['tier'])
    expect(await storedRows()).toEqual([{ col_email: 'a@x.co', col_score: 9 }])
  })

  it('an update by filter, whether or not a row matches', async () => {
    await seed('a@x.co')
    const update = (email: string) =>
      executeTableUpdateRowsByFilter(
        tableId,
        { workspaceId, filter: { email }, data: { score: 7, tier: 'gold' } },
        context()
      )

    const matched = delivered(updateTableRowsByFilterContract, await update('a@x.co'))
    const unmatched = delivered(updateTableRowsByFilterContract, await update('none@x.co'))

    expect(matched).toMatchObject({ updatedCount: 1, ignoredColumns: ['tier'] })
    expect(unmatched).toMatchObject({ updatedCount: 0, ignoredColumns: ['tier'] })
    expect(await storedRows()).toEqual([{ col_email: 'a@x.co', col_score: 7 }])
  })
})
