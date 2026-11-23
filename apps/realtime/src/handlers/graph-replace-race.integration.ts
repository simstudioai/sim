/**
 * Real PostgreSQL coverage for a canvas keystroke racing a whole-graph write. Every production
 * graph writer (a source apply, a revert to a deployed version, a normalized-state replace) locks
 * the workflow row and then saves through `saveWorkflowToNormalizedTables`, which rewrites only the
 * rows that changed. A keystroke flushed inside that window waits for the row lock and then lands
 * on the saved graph, so it is confirmed and kept. A writer that skipped the lock and deleted the
 * block under the flush (none does in production) must still never see a keystroke confirmed and
 * then lost: the flush reports it failed, which the client retries. A variable keystroke racing an
 * apply that rewrites the variables must not revert the apply's own change either.
 *
 * Drives the real `subblock-update` and `variable-update` handlers (real permission checks and
 * flush) with only the socket and the room manager stood in, and interleaves the keystroke at each
 * point of the writer's transaction. Each interleaving has one correct outcome, asserted exactly.
 */
import { db, runOutsideTransactionContext } from '@sim/db'
import { permissions, user, workflow, workflowBlocks, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { BlockState } from '@sim/workflow-types/workflow'
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

async function storedName(): Promise<string | undefined> {
  const [row] = await db
    .select({ name: workflowBlocks.name })
    .from(workflowBlocks)
    .where(eq(workflowBlocks.id, blockId))
  return row?.name
}

/**
 * Waits until `settled` resolves (`settled`) or another session waits on a lock (`blocked`), and
 * fails the test when neither happens: an interleave that silently ran after the writer instead
 * would pass for a broken flush as for a sound one.
 */
async function untilSettledOrBlocked(settled: Promise<unknown>): Promise<'settled' | 'blocked'> {
  let done = false
  void settled.then(() => {
    done = true
  })
  for (let attempt = 0; attempt < 500; attempt++) {
    if (done) return 'settled'
    const [{ waiting }] = await db.execute<{ waiting: number }>(
      sql`select count(*)::int as waiting from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`
    )
    if (waiting > 0) return 'blocked'
    await sleep(10)
  }
  throw new Error('The keystroke neither settled nor waited on a lock')
}

const RENAMED = 'Function 1 (applied)'

/** The block as the writer saves it: the code it read, under a new name. */
function savedBlock(): BlockState {
  return {
    id: blockId,
    type: 'function',
    name: RENAMED,
    position: { x: 0, y: 0 },
    subBlocks: { code: { id: 'code', type: 'code', value: BEFORE } },
    outputs: {},
    enabled: true,
  }
}

type Point = 'after-lock' | 'after-save'

/**
 * A production graph write: lock the live workflow row, then save the graph through the real
 * diff save, renaming the block from what it read. `interleave` runs at `point` inside the
 * transaction, on its own connections, as the realtime server's flush would.
 */
async function lockedSave(point: Point, interleave: () => Promise<void>) {
  await db.transaction(async (tx) => {
    await tx
      .select({ id: workflow.id })
      .from(workflow)
      .where(and(eq(workflow.id, workflowId), isNull(workflow.archivedAt)))
      .limit(1)
      .for('update')
    if (point === 'after-lock') await runOutsideTransactionContext(interleave)
    await saveWorkflowToNormalizedTables(
      workflowId,
      { blocks: { [blockId]: savedBlock() }, edges: [], loops: {}, parallels: {} },
      tx
    )
    if (point === 'after-save') await runOutsideTransactionContext(interleave)
  })
}

/**
 * A writer that skips the workflow row lock and deletes every block before re-inserting what it
 * read: no production writer does, but it is the case the flush's rows-affected check exists for.
 */
async function unlockedReplace(interleave: () => Promise<void>) {
  await db.transaction(async (tx) => {
    const read = await tx
      .select()
      .from(workflowBlocks)
      .where(eq(workflowBlocks.workflowId, workflowId))
    await tx.delete(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId))
    await runOutsideTransactionContext(interleave)
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

  const keystroke = (handlers: Record<string, Handler>, outcome: Promise<Outcome>) => async () => {
    await handlers['subblock-update']({
      workflowId,
      blockId,
      subblockId: 'code',
      value: TYPED,
      timestamp: Date.now(),
      operationId: generateId(),
    })
    expect(await untilSettledOrBlocked(outcome)).toBe('blocked')
  }

  it.each<Point>(['after-lock', 'after-save'])(
    'keeps a keystroke flushed inside a locked save (%s), and the save’s own change',
    async (point) => {
      const { handlers, outcome } = connect()
      await lockedSave(point, keystroke(handlers, outcome))

      expect({
        reported: await outcome,
        code: await storedValue(),
        name: await storedName(),
      }).toEqual({ reported: 'operation-confirmed', code: TYPED, name: RENAMED })
    }
  )

  it('reports a keystroke an unlocked replace deletes the block under as failed, never confirmed', async () => {
    const { handlers, outcome } = connect()
    await unlockedReplace(async () => {
      await handlers['subblock-update']({
        workflowId,
        blockId,
        subblockId: 'code',
        value: TYPED,
        timestamp: Date.now(),
        operationId: generateId(),
      })
      expect(await untilSettledOrBlocked(outcome)).toBe('blocked')
    })

    expect({ reported: await outcome, code: await storedValue() }).toEqual({
      reported: 'operation-failed',
      code: BEFORE,
    })
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
        expect(await untilSettledOrBlocked(outcome)).toBe('blocked')
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
    expect({
      reported,
      typed: stored[variableId].value,
      applied: stored[otherVariableId].value,
    }).toEqual({ reported: 'operation-confirmed', typed: TYPED, applied: APPLIED })
  })
})
