/**
 * The run dispatcher's row windows against real PostgreSQL: rows that share a `position` (two
 * inserts that assigned it concurrently) are each dispatched exactly once, wherever the window
 * boundary falls.
 */
import { db } from '@sim/db'
import { userTableDefinitions, userTableRows } from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { tableEventsMock } from '@sim/testing/mocks/table-events.mock'
import {
  tableWorkflowColumnsMock,
  tableWorkflowColumnsMockFns,
} from '@sim/testing/mocks/table-workflow-columns.mock'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { mockBatchEnqueueAndWait } = vi.hoisted(() => ({ mockBatchEnqueueAndWait: vi.fn() }))

vi.mock('@/lib/core/async-jobs/config', () => ({
  getJobQueue: async () => ({ batchEnqueueAndWait: mockBatchEnqueueAndWait }),
}))
vi.mock('@/lib/table/events', () => tableEventsMock)
vi.mock('@/lib/table/workflow-columns', () => tableWorkflowColumnsMock)

import { insertDispatch, runDispatcherToCompletion } from '@/lib/table/dispatcher'

const url = readTestDatabaseUrl()
if (process.env.DATABASE_URL !== url) {
  throw new Error('This suite requires only the disposable local test database')
}
const control = postgres(url, { max: 2, onnotice: () => {} })
const workspaceId = generateId()
const userId = generateId()

describe('table run dispatcher against real PostgreSQL', () => {
  beforeAll(async () => {
    await control`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES (${userId}, 'Dispatcher fixture', ${`${userId}@example.test`}, true, now(), now())`
    await control.begin(async (tx) => {
      await tx`INSERT INTO project (id, name, owner_id)
        VALUES (${workspaceId}, 'Dispatcher fixture project', ${userId})`
      await tx`INSERT INTO workspace (id, project_id, name, owner_id, billed_account_user_id)
        VALUES (${workspaceId}, ${workspaceId}, 'Dispatcher fixtures', ${userId}, ${userId})`
    })
  })

  afterAll(async () => {
    await control.begin(async (tx) => {
      await tx`DELETE FROM workspace WHERE id = ${workspaceId}`
      await tx`DELETE FROM project WHERE id = ${workspaceId}`
      await tx`DELETE FROM "user" WHERE id = ${userId}`
    })
    await control.end()
  })

  it('dispatches every row once when a window boundary splits rows that share a position', async () => {
    const tableId = generateId()
    await db.insert(userTableDefinitions).values({
      id: tableId,
      workspaceId,
      name: tableId,
      schema: { columns: [], workflowGroups: [{ id: 'group-1' }] },
      createdBy: userId,
    })
    const positions = [0, 1, 1, 1, 2, 3, 3, 4]
    await db.insert(userTableRows).values(
      positions.map((position, i) => ({
        id: `${tableId}-${i}`,
        tableId,
        workspaceId,
        data: {},
        position,
        orderKey: `a${i}`,
      }))
    )
    tableWorkflowColumnsMockFns.mockBuildPendingRuns.mockImplementation(
      (_table: unknown, rows: Array<{ id: string }>) =>
        rows.map((row) => ({ rowId: row.id, groupId: 'group-1', tableId, workspaceId }))
    )
    tableWorkflowColumnsMockFns.mockBuildEnqueueItems.mockImplementation(async (runs: unknown[]) =>
      runs.map((payload) => ({ payload }))
    )
    const dispatched: string[] = []
    mockBatchEnqueueAndWait.mockImplementation(
      async (_kind: string, items: Array<{ payload: { rowId: string } }>) => {
        for (const item of items) dispatched.push(item.payload.rowId)
      }
    )

    const dispatchId = await insertDispatch({
      tableId,
      workspaceId,
      requestId: 'dispatcher-ties',
      mode: 'all',
      scope: { groupIds: ['group-1'] },
      isManualRun: true,
      capabilityGovernedUserId: null,
    })
    await runDispatcherToCompletion(dispatchId, 2)

    expect([...dispatched].sort()).toEqual(positions.map((_, i) => `${tableId}-${i}`).sort())
  })
})
