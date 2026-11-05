/**
 * What a cell's durable state write does when the connection dies around its commit, against the
 * real schema, `updateRow`, and SQL guards. A proxy between `@sim/db` and PostgreSQL forwards the
 * COMMIT, withholds the server's reply, and then sends a real TCP reset: the commit landed and the
 * client cannot know it, which is the only case where repeating a write can do harm.
 */
import net, { type Socket } from 'node:net'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { tableBillingMock } from '@sim/testing/mocks/table-billing.mock'
import { tableEventsMock, tableEventsMockFns } from '@sim/testing/mocks/table-events.mock'
import { tableTriggerMock } from '@sim/testing/mocks/table-trigger.mock'
import { tableWorkflowColumnsMock } from '@sim/testing/mocks/table-workflow-columns.mock'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/table/billing', () => tableBillingMock)
vi.mock('@/lib/table/events', () => tableEventsMock)
vi.mock('@/lib/table/trigger', () => tableTriggerMock)
vi.mock('@/lib/table/workflow-columns', () => tableWorkflowColumnsMock)

type Interception = {
  /** Which client statement to act on. */
  match: RegExp
  /** Forward it and lose the reply (it lands), or drop it (it never reaches the server). */
  forward: boolean
  /** Runs after the statement landed, before the client sees the reset. */
  beforeReset?: () => Promise<void>
  /** Runs once the client has the reset, inside the write's retry backoff. */
  afterReset?: () => Promise<void>
}

const realUrl = new URL(readTestDatabaseUrl())
const control = postgres(realUrl.toString(), { max: 2, onnotice: () => {} })
let interception: Interception | null = null

const proxy = net.createServer((client: Socket) => {
  const server = net.connect(Number(realUrl.port || 5432), realUrl.hostname.replace(/^\[|\]$/g, ''))
  let replyLost = false
  client.on('data', (chunk) => {
    const armed = interception
    if (!armed?.match.test(chunk.toString('latin1'))) {
      server.write(chunk)
      return
    }
    interception = null
    replyLost = true
    if (armed.forward) server.write(chunk)
    void (async () => {
      await sleep(100)
      await armed.beforeReset?.()
      client.resetAndDestroy()
      await armed.afterReset?.()
    })()
  })
  server.on('data', (chunk) => {
    if (!replyLost) client.write(chunk)
  })
  client.on('error', () => {})
  server.on('error', () => client.destroy())
  client.on('close', () => server.destroy())
})
await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
const proxied = new URL(realUrl)
proxied.hostname = '127.0.0.1'
proxied.port = String((proxy.address() as net.AddressInfo).port)
process.env.DATABASE_URL = proxied.toString()

const { db } = await import('@sim/db')
const { userTableDefinitions, userTableRows } = await import('@sim/db/schema')
const { writeExecutionsPatch } = await import('@/lib/table/rows/executions')
const { getTableById } = await import('@/lib/table/service')
const {
  confirmWorkflowGroupStateCommitted,
  terminalizeUnclaimedRowMarkers,
  writeWorkflowGroupStateDurably,
} = await import('@/lib/table/cell-write')

const LANDED_COMMIT = { match: /commit/i, forward: true }
const workspaceId = generateId()
const userId = generateId()
const groupId = 'group-1'
const executionId = 'execution-1'

async function createCell({ pickedUp = true } = {}) {
  const tableId = generateId()
  const rowId = generateId()
  await db.insert(userTableDefinitions).values({
    id: tableId,
    workspaceId,
    name: tableId,
    schema: { columns: [{ id: 'out', name: 'out', type: 'string' }] },
    createdBy: userId,
  })
  await db
    .insert(userTableRows)
    .values({ id: rowId, tableId, workspaceId, data: { out: 'before' }, orderKey: 'a' })
  const running = {
    status: 'running' as const,
    executionId,
    jobId: null,
    workflowId: 'workflow-1',
    error: null,
  }
  if (pickedUp) await writeExecutionsPatch(db, tableId, rowId, { [groupId]: running })
  const table = await getTableById(tableId)
  if (!table) throw new Error('Fixture table was not created')
  return { ctx: { tableId, rowId, workspaceId, groupId, executionId, table }, tableId, rowId }
}

const completed = (dataPatch: { out: string }) => ({
  dataPatch,
  executionState: {
    status: 'completed' as const,
    executionId,
    jobId: null,
    workflowId: 'workflow-1',
    error: null,
  },
})

async function readCell(rowId: string) {
  const [row] = await control<
    { out: string; status: string | null; execution_id: string | null }[]
  >`
    SELECT r.data->>'out' AS out, e.status, e.execution_id
    FROM user_table_rows r
    LEFT JOIN table_row_executions e ON e.row_id = r.id AND e.group_id = ${groupId}
    WHERE r.id = ${rowId}`
  return row
}

beforeAll(async () => {
  await control`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
    VALUES (${userId}, 'Cell write fixture', ${`${userId}@example.test`}, true, now(), now())`
  await control.begin(async (tx) => {
    await tx`INSERT INTO project (id, name, owner_id) VALUES (${workspaceId}, 'Fixture project', ${userId})`
    await tx`INSERT INTO workspace (id, project_id, name, owner_id, billed_account_user_id)
      VALUES (${workspaceId}, ${workspaceId}, 'Cell write fixtures', ${userId}, ${userId})`
  })
})

beforeEach(() => {
  interception = null
})

/** An interception still armed means no reset happened, and the test proved nothing. */
afterEach(() => {
  expect(interception).toBeNull()
})

afterAll(async () => {
  await control.begin(async (tx) => {
    await tx`DELETE FROM workspace WHERE id = ${workspaceId}`
    await tx`DELETE FROM project WHERE id = ${workspaceId}`
    await tx`DELETE FROM "user" WHERE id = ${userId}`
  })
  await control.end({ timeout: 1 })
  proxy.close()
})

describe('a durable cell state write around a lost connection', { timeout: 90_000 }, () => {
  it('applies a write whose statement never reached the server', async () => {
    const { ctx, rowId } = await createCell()
    interception = { match: /commit/i, forward: false }

    await expect(writeWorkflowGroupStateDurably(ctx, completed({ out: 'result' }))).resolves.toBe(
      'wrote'
    )

    expect(await readCell(rowId)).toMatchObject({ out: 'result', status: 'completed' })
    expect(tableEventsMockFns.mockAppendTableEvent).toHaveBeenCalledOnce()
  })

  it('recognizes a commit that landed and still tells the client', async () => {
    const { ctx, rowId } = await createCell()
    interception = LANDED_COMMIT

    await expect(writeWorkflowGroupStateDurably(ctx, completed({ out: 'result' }))).resolves.toBe(
      'wrote'
    )

    expect(await readCell(rowId)).toMatchObject({ out: 'result', status: 'completed' })
    expect(tableEventsMockFns.mockAppendTableEvent).toHaveBeenCalledOnce()
    expect(tableEventsMockFns.mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', outputs: { out: 'result' } })
    )
  })

  it('does not undo an edit the user made after the commit landed', async () => {
    const { ctx, rowId } = await createCell()
    interception = {
      ...LANDED_COMMIT,
      beforeReset: async () => {
        await control`UPDATE user_table_rows SET data = '{"out":"edited"}' WHERE id = ${rowId}`
      },
    }

    await writeWorkflowGroupStateDurably(ctx, completed({ out: 'result' }))

    expect((await readCell(rowId)).out).toBe('edited')
    expect(tableEventsMockFns.mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', outputs: { out: 'edited' } })
    )
  })

  it('does not bring back a cell the user cleared after the commit landed', async () => {
    const { ctx, rowId } = await createCell()
    interception = {
      ...LANDED_COMMIT,
      beforeReset: async () => {
        await control`DELETE FROM table_row_executions WHERE row_id = ${rowId}`
      },
    }

    await expect(writeWorkflowGroupStateDurably(ctx, completed({ out: 'result' }))).resolves.toBe(
      'skipped'
    )

    expect((await readCell(rowId)).status).toBeNull()
  })

  it('does not bring back outputs of a failed run the user cleared after the commit landed', async () => {
    const { ctx, rowId } = await createCell()
    interception = {
      ...LANDED_COMMIT,
      beforeReset: async () => {
        await control`DELETE FROM table_row_executions WHERE row_id = ${rowId}`
        await control`UPDATE user_table_rows SET data = '{}' WHERE id = ${rowId}`
      },
    }

    await expect(
      writeWorkflowGroupStateDurably(ctx, {
        dataPatch: { out: 'partial' },
        executionState: {
          status: 'error',
          executionId,
          jobId: null,
          workflowId: 'workflow-1',
          error: 'A block failed',
        },
      })
    ).resolves.toBe('skipped')

    expect(await readCell(rowId)).toMatchObject({ out: null, status: null })
  })

  it('writes an error for a cell that never had a state, not mistaking it for a cleared one', async () => {
    const { ctx, rowId } = await createCell({ pickedUp: false })
    interception = { match: /commit/i, forward: false }

    await expect(
      writeWorkflowGroupStateDurably(ctx, {
        executionState: {
          status: 'error',
          executionId,
          jobId: null,
          workflowId: 'workflow-1',
          error: 'Workflow not found',
        },
      })
    ).resolves.toBe('wrote')

    expect((await readCell(rowId)).status).toBe('error')
  })

  it('does not overwrite a Stop that lands during the retry backoff', async () => {
    const { ctx, rowId } = await createCell()
    interception = {
      match: /commit/i,
      forward: false,
      afterReset: async () => {
        await control`UPDATE table_row_executions SET status = 'cancelled' WHERE row_id = ${rowId}`
      },
    }

    await expect(writeWorkflowGroupStateDurably(ctx, completed({ out: 'result' }))).resolves.toBe(
      'skipped'
    )

    expect((await readCell(rowId)).status).toBe('cancelled')
  })

  it('confirms a write that committed and tells the client, and only that write', async () => {
    const { ctx, rowId } = await createCell()
    const write = completed({ out: 'result' })

    await expect(confirmWorkflowGroupStateCommitted(ctx, write)).resolves.toBe(false)
    expect(tableEventsMockFns.mockAppendTableEvent).not.toHaveBeenCalled()

    await control`UPDATE table_row_executions SET status = 'completed' WHERE row_id = ${rowId}`
    await expect(confirmWorkflowGroupStateCommitted(ctx, write)).resolves.toBe(true)
    expect(tableEventsMockFns.mockAppendTableEvent).toHaveBeenCalledOnce()
  })

  it('fails only the markers on a row that no worker has claimed', async () => {
    const { ctx, tableId, rowId } = await createCell()
    const pending = { status: 'pending' as const, jobId: null, workflowId: 'w', error: null }
    await writeExecutionsPatch(db, tableId, rowId, {
      unclaimed: { ...pending, executionId: null },
      paused: { ...pending, executionId: 'paused-run', jobId: 'paused-paused-run' },
      stopped: { ...pending, status: 'cancelled', executionId: null },
    })

    await terminalizeUnclaimedRowMarkers(tableId, rowId, 'Stopped')

    const rows = await control<{ group_id: string; status: string }[]>`
      SELECT group_id, status FROM table_row_executions WHERE row_id = ${rowId}`
    expect(Object.fromEntries(rows.map((row) => [row.group_id, row.status]))).toEqual({
      [ctx.groupId]: 'running',
      unclaimed: 'error',
      paused: 'pending',
      stopped: 'cancelled',
    })
    expect(tableEventsMockFns.mockAppendTableEvent).toHaveBeenCalledOnce()
  })

  it('does not repeat a cancel stamp, which could kill a run the user just started', async () => {
    const { ctx, rowId } = await createCell()
    interception = {
      ...LANDED_COMMIT,
      beforeReset: async () => {
        await control`
          UPDATE table_row_executions SET status = 'pending', execution_id = NULL
          WHERE row_id = ${rowId}`
      },
    }

    await expect(
      writeWorkflowGroupStateDurably(ctx, {
        executionState: {
          status: 'cancelled',
          executionId,
          jobId: null,
          workflowId: 'workflow-1',
          error: 'Cancelled',
        },
      })
    ).rejects.toThrow()

    expect(await readCell(rowId)).toMatchObject({ status: 'pending', execution_id: null })
  })
})
