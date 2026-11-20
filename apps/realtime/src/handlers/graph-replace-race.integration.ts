/**
 * Real PostgreSQL coverage for a canvas keystroke racing a whole-graph replace. A source apply
 * locks the workflow row, re-reads the graph, then deletes and re-inserts every block from what it
 * read; a revert to a deployed version deletes and re-inserts without the lock. A keystroke flushed
 * inside either window must survive the replace or be reported to its sender as failed (the client
 * retries a retryable failure): it may never be confirmed and then vanish. A variable keystroke
 * racing an apply that rewrites the variables must not revert the apply's own change either.
 *
 * Drives the real `subblock-update` and `variable-update` handlers (real permission checks and flush) with only the
 * socket and the room manager stood in, and runs the replace's SQL sequence by hand at each
 * interleaving point.
 */
import { db, runOutsideTransactionContext } from '@sim/db'
import { permissions, user, workflow, workflowBlocks, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupSubblocksHandlers } from '@/handlers/subblocks'
import { setupVariablesHandlers } from '@/handlers/variables'
import type { IRoomManager } from '@/rooms'

const userId = generateId()
const workspaceId = generateId()
const workflowId = generateId()
const blockId = generateId()
const variableId = generateId()
const otherVariableId = generateId()
const SOCKET_ID = 'socket-typing'
const BEFORE = 'before the apply'
const TYPED = 'typed during the apply'

type Outcome = 'operation-confirmed' | 'operation-failed'
type Handler = (payload: unknown) => Promise<void>

/** The sender's socket, the room manager the handler reads, and the outcome its flush emits. */
function connect() {
  const handlers: Record<string, Handler> = {}
  let settle: (outcome: Outcome) => void = () => {}
  const outcome = new Promise<Outcome>((resolve) => {
    settle = resolve
  })
  const emitTo = (room: string) => ({
    emit: (event: string) => {
      if (room === SOCKET_ID && (event === 'operation-confirmed' || event === 'operation-failed')) {
        settle(event)
      }
    },
  })
  const socket = {
    id: SOCKET_ID,
    userId,
    on: (event: string, handler: Handler) => {
      handlers[event] = handler
    },
    emit: () => {},
  }
  const roomManager = {
    isReady: () => true,
    getRoomForSocket: async () => ({ type: 'workflow', id: workflowId }),
    getUserSession: async () => ({ userId, userName: 'Typist' }),
    hasRoom: async () => true,
    getRoomUsers: async () => [{ socketId: SOCKET_ID, userId, role: 'write' }],
    updateUserActivity: async () => {},
    io: { to: (room: string) => ({ ...emitTo(room), except: () => emitTo(room) }) },
  }
  const connected = socket as unknown as Parameters<typeof setupSubblocksHandlers>[0]
  setupSubblocksHandlers(connected, roomManager as unknown as IRoomManager)
  setupVariablesHandlers(connected, roomManager as unknown as IRoomManager)
  return { handlers, outcome }
}

async function storedValue(): Promise<unknown> {
  const [row] = await db
    .select({ subBlocks: workflowBlocks.subBlocks })
    .from(workflowBlocks)
    .where(eq(workflowBlocks.id, blockId))
  const subBlocks = row?.subBlocks as Record<string, { value?: unknown }> | undefined
  return subBlocks?.code?.value
}

/** Resolves once `settled` resolves or another session is waiting on a lock. */
async function untilSettledOrBlocked(settled: Promise<unknown>): Promise<void> {
  let done = false
  void settled.then(() => {
    done = true
  })
  for (let attempt = 0; attempt < 200 && !done; attempt++) {
    const [{ waiting }] = await db.execute<{ waiting: number }>(
      sql`select count(*)::int as waiting from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`
    )
    if (waiting > 0) return
    await sleep(10)
  }
}

type Writer = 'locking' | 'blind'
type Point = 'after-reread' | 'after-delete'

/**
 * A whole-graph replace, statement for statement: a `locking` writer (a source apply) locks the
 * live workflow row and re-reads the blocks first, a `blind` one (a revert to a deployed version)
 * does not; both then delete every block and re-insert the graph they started from. `interleave`
 * runs at `point` inside it, on its own connections, as the realtime server's flush would.
 */
async function replaceGraph(writer: Writer, point: Point, interleave: () => Promise<void>) {
  await db.transaction(async (tx) => {
    if (writer === 'locking') {
      await tx
        .select({ id: workflow.id })
        .from(workflow)
        .where(and(eq(workflow.id, workflowId), isNull(workflow.archivedAt)))
        .limit(1)
        .for('update')
    }
    const read = await tx
      .select()
      .from(workflowBlocks)
      .where(eq(workflowBlocks.workflowId, workflowId))
    if (point === 'after-reread') await runOutsideTransactionContext(interleave)
    await tx.delete(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId))
    if (point === 'after-delete') await runOutsideTransactionContext(interleave)
    await tx.insert(workflowBlocks).values(read)
  })
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: userId,
    name: 'Subblock race fixture',
    email: `${userId}@subblock-race.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Subblock race',
    ownerId: userId,
    billedAccountUserId: userId,
  })
  await db.insert(permissions).values({
    id: generateId(),
    entityType: 'workspace',
    entityId: workspaceId,
    userId,
    permissionType: 'write',
  })
  await db.insert(workflow).values({
    id: workflowId,
    userId,
    workspaceId,
    name: 'Subblock race',
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
})

afterAll(async () => {
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, userId))
})

describe('subblock flush racing a whole-graph replace', () => {
  beforeEach(async () => {
    await db.delete(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId))
    await db.insert(workflowBlocks).values({
      id: blockId,
      workflowId,
      type: 'function',
      name: 'Function 1',
      positionX: '0',
      positionY: '0',
      subBlocks: { code: { id: 'code', type: 'code', value: BEFORE } },
    })
  })

  it.each<[Writer, Point]>([
    ['locking', 'after-reread'],
    ['locking', 'after-delete'],
    ['blind', 'after-delete'],
  ])('never confirms a keystroke a %s replace then loses (keystroke %s)', async (writer, point) => {
    const { handlers, outcome } = connect()
    await replaceGraph(writer, point, async () => {
      await handlers['subblock-update']({
        workflowId,
        blockId,
        subblockId: 'code',
        value: TYPED,
        timestamp: Date.now(),
        operationId: generateId(),
      })
      await untilSettledOrBlocked(outcome)
    })
    const reported = await outcome
    const stored = await storedValue()
    expect({ reported, stored }).not.toEqual({ reported: 'operation-confirmed', stored: BEFORE })
    if (reported === 'operation-confirmed') expect(stored).toBe(TYPED)
  })
})

describe('variable flush racing an apply that rewrites the variables', () => {
  const variable = (id: string, value: string) => ({ id, name: id, type: 'plain', value })

  beforeEach(async () => {
    await db
      .update(workflow)
      .set({
        variables: {
          [variableId]: variable(variableId, BEFORE),
          [otherVariableId]: variable(otherVariableId, BEFORE),
        },
      })
      .where(eq(workflow.id, workflowId))
  })

  it("keeps both the keystroke and the apply's own variable change", async () => {
    const { handlers, outcome } = connect()
    const APPLIED = 'written by the apply'
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ variables: workflow.variables })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)
        .for('update')
      await runOutsideTransactionContext(async () => {
        await handlers['variable-update']({
          workflowId,
          variableId,
          field: 'value',
          value: TYPED,
          timestamp: Date.now(),
          operationId: generateId(),
        })
        await untilSettledOrBlocked(outcome)
      })
      const read = locked.variables as Record<string, ReturnType<typeof variable>>
      await tx
        .update(workflow)
        .set({ variables: { ...read, [otherVariableId]: variable(otherVariableId, APPLIED) } })
        .where(eq(workflow.id, workflowId))
    })
    const reported = await outcome
    const [row] = await db
      .select({ variables: workflow.variables })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
    const stored = row.variables as Record<string, { value: string }>
    expect(stored[otherVariableId].value).toBe(APPLIED)
    if (reported === 'operation-confirmed') expect(stored[variableId].value).toBe(TYPED)
  })
})
