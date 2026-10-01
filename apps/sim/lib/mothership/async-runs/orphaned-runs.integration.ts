/**
 * Settlement of Chat runs that no controller owns, against real PostgreSQL and Redis:
 * the chat stream lock, the replay buffer keys, the run and chat rows, and the Stop
 * use case are production code. A local HTTP server stands in for the worker's abort
 * endpoint.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedEnv, worker } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const { createServer } = await import('node:http')
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ settled: true }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const url = readTestRedisUrl()
  const inheritedEnv = {
    REDIS_URL: process.env.REDIS_URL,
    SIM_AGENT_API_URL: process.env.SIM_AGENT_API_URL,
  }
  /** The real Redis module and worker URL resolution read these at import. */
  process.env.REDIS_URL = url
  process.env.SIM_AGENT_API_URL = `http://127.0.0.1:${port}`
  return { redisUrl: url, inheritedEnv, worker: { server } }
})

import { db } from '@sim/db'
import {
  copilotAsyncToolCalls,
  copilotChats,
  copilotRequestStops,
  copilotRuns,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { createDeferred } from '@sim/testing'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { randomInt } from '@sim/utils/random'
import { eq, inArray, sql } from 'drizzle-orm'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import type { DbTransaction } from '@/lib/db/types'
import {
  LEGACY_RUN_ERROR,
  ORPHANED_RUN_ERROR,
  settleStoppedRunWithoutController,
  sweepOrphanedRuns,
} from '@/lib/mothership/async-runs/orphaned-runs'
import {
  claimSimToolExecution,
  requestRunStop,
  updateRunStatus,
} from '@/lib/mothership/async-runs/repository'
import { chatPubSub } from '@/lib/mothership/chat-status'
import { abortRun } from '@/lib/mothership/request/application/controls'
import { claimRunController } from '@/lib/mothership/request/lifecycle/controller-ownership'
import {
  acquirePendingChatStream,
  getLocalChatStreamLease,
  releasePendingChatStream,
} from '@/lib/mothership/request/session/abort'
import {
  assertChatStreamLease,
  chatStreamLockKey,
} from '@/lib/mothership/request/session/controller-lease'

/** A recovering controller's first takeover of a run. */
const FIRST_RECOVERY = { attempts: 1, claimedAt: 0, notBefore: 0 }

function redis() {
  const client = getRedisClient()
  if (!client) throw new Error('The integration suite requires TEST_REDIS_URL')
  return client
}

/** The sweep's resume point lives in shared Redis; each test and the next suite start fresh. */
async function resetSweepCursor() {
  await getRedisClient()?.del('copilot:orphaned-runs:sweep-cursor')
}

beforeEach(resetSweepCursor)

afterAll(async () => {
  chatPubSub?.dispose()
  await resetSweepCursor()
  await closeRedisConnection()
  await new Promise<void>((resolve) => worker.server.close(() => resolve()))
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe.runIf(Boolean(redisUrl))('Chat runs no controller owns', () => {
  const userId = generateId()
  const workspaceId = generateId()
  const chatIds: string[] = []

  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Orphaned run fixture',
      email: `${userId}@orphaned-runs.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Orphaned run fixture',
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
  })

  afterAll(async () => {
    if (chatIds.length) await db.delete(copilotChats).where(inArray(copilotChats.id, chatIds))
    await db.delete(permissions).where(eq(permissions.userId, userId))
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
  })

  /**
   * A run as the chat POST admits it: the chat marker names its stream and the run
   * records the lock value its first controller held. `idleMinutes` backdates its
   * last durable write; `controllerToken: null` is a run with no lease protocol.
   * `stopped` records the user's Stop intent; `superseded` only closes tool admission,
   * as a newer turn's workbench does to older runs.
   */
  async function admittedRun(
    options: {
      idleMinutes?: number
      status?: 'active' | 'paused_waiting_for_tool'
      controllerToken?: string | null
      stopped?: boolean
      superseded?: boolean
      /** Admitted by code predating the current tool-execution protocol. */
      legacy?: boolean
      id?: string
    } = {}
  ) {
    const chatId = generateId()
    const streamId = generateId()
    const runId = options.id ?? generateId()
    chatIds.push(chatId)
    const controllerToken =
      options.controllerToken === undefined
        ? `${streamId}\n${generateId()}`
        : options.controllerToken
    const idle = sql`now() - make_interval(mins => ${options.idleMinutes ?? 0})`
    await db.insert(copilotChats).values({
      id: chatId,
      userId,
      workspaceId,
      type: 'mothership',
      conversationId: streamId,
    })
    await db.insert(copilotRuns).values({
      id: runId,
      executionId: generateId(),
      chatId,
      userId,
      workspaceId,
      streamId,
      toolExecutionVersion: options.legacy ? 0 : 2,
      status: options.status ?? 'active',
      requestContext: controllerToken
        ? { requestId: generateId(), controllerToken, recovery: { kind: 'interactive_stream' } }
        : { source: 'headless_lifecycle' },
      startedAt: idle,
      updatedAt: idle,
      ...(options.stopped || options.superseded ? { toolAdmissionClosedAt: idle } : {}),
    })
    if (options.stopped)
      await db.insert(copilotRequestStops).values({ userId, workspaceId, streamId })
    return { chatId, streamId, runId, controllerToken }
  }

  /** Records the user's Stop the way the abort use case does before it settles anything. */
  async function stop(run: { streamId: string; chatId: string }) {
    await requestRunStop({ userId, workspaceId, streamId: run.streamId, chatId: run.chatId })
  }

  /** A Sim tool call the worker dispatched on the run, not yet admitted for execution. */
  async function dispatchedTool(runId: string) {
    const toolCallId = generateId()
    await db.insert(copilotAsyncToolCalls).values({ runId, toolCallId, toolName: 'run_workflow' })
    return { toolCallId, runId, userId, ownerToken: generateId() }
  }

  /** The backend queued on a lock behind any of these, once one is. */
  async function lockWaiterBehind(...blockers: number[]) {
    const pids = sql`ARRAY[${sql.join(
      blockers.map((pid) => sql`${pid}::int`),
      sql`, `
    )}]`
    let waiter: number | undefined
    await expect
      .poll(
        async () => {
          const [row] = await db.execute<{ pid: number }>(sql`
            SELECT pid FROM pg_stat_activity WHERE datname = current_database()
              AND wait_event_type = 'Lock' AND pid <> ALL(${pids})
              AND pg_blocking_pids(pid) && ${pids} LIMIT 1
          `)
          waiter = row?.pid
          return waiter
        },
        { interval: 5, timeout: 5000 }
      )
      .toBeDefined()
    return waiter!
  }

  /**
   * Runs `lock` in a transaction held open until `run` settles, then commits it, so a
   * failed step never leaves the rows locked behind the test. `run` returns the work
   * queued behind the lock wrapped, never as a bare promise it would wait on.
   */
  async function whileHolding<T>(
    lock: (tx: DbTransaction) => Promise<unknown>,
    run: (holder: number) => Promise<T>
  ): Promise<T> {
    const locked = createDeferred<number>()
    const release = createDeferred<void>()
    const holding = db.transaction(async (tx) => {
      await lock(tx)
      const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      locked.resolve(backend.pid)
      await release.promise
    })
    holding.catch(locked.reject)
    const holder = await locked.promise
    try {
      return await run(holder)
    } finally {
      release.resolve()
      await holding
    }
  }

  async function stored(runId: string) {
    const [run] = await db.select().from(copilotRuns).where(eq(copilotRuns.id, runId))
    const [chat] = await db
      .select({ conversationId: copilotChats.conversationId })
      .from(copilotChats)
      .where(eq(copilotChats.id, run.chatId))
    return { ...run, marker: chat?.conversationId ?? null }
  }

  it('settles a run whose controller died once its recovery window has passed', async () => {
    const orphan = await admittedRun({ idleMinutes: 90, status: 'paused_waiting_for_tool' })

    const { settledRunIds } = await sweepOrphanedRuns()

    expect(settledRunIds).toContain(orphan.runId)
    const run = await stored(orphan.runId)
    expect(run.status).toBe('error')
    expect(run.error).toBeTruthy()
    expect(run.completedAt).not.toBeNull()
    expect(run.toolAdmissionClosedAt).not.toBeNull()
    expect(run.marker).toBeNull()
  })

  it('never settles a run while one of its Sim tools holds a live execution lease', async () => {
    /** A long tool call writes nothing to the run; only its execution heartbeat shows it is alive. */
    const orphan = await admittedRun({ idleMinutes: 90, status: 'paused_waiting_for_tool' })
    const tool = await dispatchedTool(orphan.runId)
    expect(await claimSimToolExecution(tool)).toEqual({ outcome: 'claimed' })

    expect((await sweepOrphanedRuns()).settledRunIds).not.toContain(orphan.runId)
    const live = await stored(orphan.runId)
    expect(live.status).toBe('paused_waiting_for_tool')
    expect(live.toolAdmissionClosedAt).toBeNull()
    expect(live.marker).toBe(orphan.streamId)

    /** Its owner died: the heartbeat stopped renewing the lease. */
    await db
      .update(copilotAsyncToolCalls)
      .set({ executionLeaseExpiresAt: sql`now() - interval '1 second'` })
      .where(eq(copilotAsyncToolCalls.toolCallId, tool.toolCallId))

    expect((await sweepOrphanedRuns()).settledRunIds).toContain(orphan.runId)
    expect((await stored(orphan.runId)).status).toBe('error')
  })

  it('never settles a run whose Sim tool was admitted while the sweep waited to settle it', async () => {
    const orphan = await admittedRun({ idleMinutes: 90, status: 'paused_waiting_for_tool' })
    const tool = await dispatchedTool(orphan.runId)
    /** Holds the run row so the tool's admission and then the sweep queue behind it, in that order. */
    const { claim, sweep } = await whileHolding(
      (tx) =>
        tx
          .select({ id: copilotRuns.id })
          .from(copilotRuns)
          .where(eq(copilotRuns.id, orphan.runId))
          .for('update'),
      async (holder) => {
        const claim = claimSimToolExecution(tool)
        const claimant = await lockWaiterBehind(holder)
        const sweep = sweepOrphanedRuns()
        await lockWaiterBehind(holder, claimant)
        return { claim, sweep }
      }
    )

    expect(await claim).toEqual({ outcome: 'claimed' })
    expect((await sweep).settledRunIds).not.toContain(orphan.runId)
    const run = await stored(orphan.runId)
    expect(run.status).toBe('paused_waiting_for_tool')
    expect(run.toolAdmissionClosedAt).toBeNull()
  })

  it('never settles a run whose Sim tool lease a heartbeat renewed as the sweep settled it', async () => {
    const orphan = await admittedRun({ idleMinutes: 90, status: 'paused_waiting_for_tool' })
    const tool = await dispatchedTool(orphan.runId)
    expect(await claimSimToolExecution(tool)).toEqual({ outcome: 'claimed' })
    await db
      .update(copilotAsyncToolCalls)
      .set({ executionLeaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(copilotAsyncToolCalls.toolCallId, tool.toolCallId))

    /**
     * A heartbeat that passed its expiry check just before the lease ran out, and has
     * not committed yet: the sweep sees the old, expired lease until it does.
     */
    const { sweep } = await whileHolding(
      (tx) =>
        tx
          .update(copilotAsyncToolCalls)
          .set({ executionLeaseExpiresAt: sql`clock_timestamp() + interval '1 minute'` })
          .where(eq(copilotAsyncToolCalls.toolCallId, tool.toolCallId)),
      async (holder) => {
        const sweep = sweepOrphanedRuns()
        await lockWaiterBehind(holder)
        return { sweep }
      }
    )

    expect((await sweep).settledRunIds).not.toContain(orphan.runId)
    const run = await stored(orphan.runId)
    expect(run.status).toBe('paused_waiting_for_tool')
    expect(run.toolAdmissionClosedAt).toBeNull()
  })

  it('settles a run stopped while no controller owned it as cancelled', async () => {
    const orphan = await admittedRun({ idleMinutes: 90, stopped: true })

    const { settledRunIds } = await sweepOrphanedRuns()

    expect(settledRunIds).toContain(orphan.runId)
    expect((await stored(orphan.runId)).status).toBe('cancelled')
  })

  it('settles a run a newer turn superseded, without a Stop, as an error', async () => {
    const orphan = await admittedRun({ idleMinutes: 90, superseded: true })

    const { settledRunIds } = await sweepOrphanedRuns()

    expect(settledRunIds).toContain(orphan.runId)
    const run = await stored(orphan.runId)
    expect(run.status).toBe('error')
    expect(run.error).toBeTruthy()
  })

  it('settles a legacy run without a lease only after the legacy ceiling', async () => {
    const recent = await admittedRun({ idleMinutes: 90, controllerToken: null, legacy: true })
    const abandoned = await admittedRun({
      idleMinutes: 25 * 60,
      controllerToken: null,
      legacy: true,
    })
    const [before] = await db
      .select({ updatedAt: copilotRuns.updatedAt })
      .from(copilotRuns)
      .where(eq(copilotRuns.id, abandoned.runId))
    const { settledRunIds } = await sweepOrphanedRuns()

    expect(settledRunIds).toContain(abandoned.runId)
    expect(settledRunIds).not.toContain(recent.runId)
    const settled = await stored(abandoned.runId)
    expect(settled.status).toBe('error')
    /** Its retention clock keeps running from its last real write, and it reads as never finalized. */
    expect(settled.updatedAt).toEqual(before.updatedAt)
    expect(settled.completedAt).toEqual(before.updatedAt)
    expect(settled.error).toBe(LEGACY_RUN_ERROR)
    expect(settled.error).not.toBe(ORPHANED_RUN_ERROR)
    expect((await stored(recent.runId)).status).toBe('active')
  })

  it('never settles a current headless run, however long it has run', async () => {
    /** A headless turn has no lease or heartbeat; only its own lifecycle can end it. */
    const headless = await admittedRun({ idleMinutes: 25 * 60, controllerToken: null })

    const { settledRunIds } = await sweepOrphanedRuns()

    expect(settledRunIds).not.toContain(headless.runId)
    expect((await stored(headless.runId)).status).toBe('active')
  })

  it('never settles a run whose stream holds its chat lock, or that is still recoverable', async () => {
    const leased = await admittedRun({ idleMinutes: 90 })
    await redis().set(chatStreamLockKey(leased.chatId), leased.controllerToken!, 'EX', 60)
    /** A recovering controller holds the lock under a new token before it claims the run. */
    const recovering = await admittedRun({ idleMinutes: 90 })
    await redis().set(
      chatStreamLockKey(recovering.chatId),
      `${recovering.streamId}\n${generateId()}`,
      'EX',
      60
    )
    const replayable = await admittedRun({ idleMinutes: 90 })
    await redis().set(`mothership_stream:${replayable.streamId}:seq`, '4', 'EX', 60)
    const fresh = await admittedRun({ idleMinutes: 5 })

    try {
      const { settledRunIds } = await sweepOrphanedRuns()

      for (const run of [leased, recovering, replayable, fresh]) {
        expect(settledRunIds).not.toContain(run.runId)
        const current = await stored(run.runId)
        expect(current.status).toBe('active')
        expect(current.marker).toBe(run.streamId)
      }
    } finally {
      await redis().del(
        chatStreamLockKey(leased.chatId),
        chatStreamLockKey(recovering.chatId),
        `mothership_stream:${replayable.streamId}:seq`
      )
    }
  })

  it('settles a run exactly once when a sweep races its own controller finalizing', async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const orphan = await admittedRun({ idleMinutes: 90 })

      const [finalized, sweep] = await Promise.all([
        updateRunStatus(orphan.runId, 'complete', {}, orphan.controllerToken!),
        sweepOrphanedRuns(),
      ])

      const swept = sweep.settledRunIds.includes(orphan.runId)
      expect(Boolean(finalized) !== swept).toBe(true)
      expect((await stored(orphan.runId)).status).toBe(swept ? 'error' : 'complete')
    }
  })

  it('settles a run exactly once when a sweep races a recovering controller claiming it', async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const orphan = await admittedRun({ idleMinutes: 90 })

      const [claimed, sweep] = await Promise.all([
        claimRunController({
          runId: orphan.runId,
          chatId: orphan.chatId,
          previousToken: orphan.controllerToken!,
          token: `${orphan.streamId}\n${generateId()}`,
          recoveryBackoff: FIRST_RECOVERY,
        }),
        sweepOrphanedRuns(),
      ])

      const swept = sweep.settledRunIds.includes(orphan.runId)
      expect(claimed !== swept).toBe(true)
      expect((await stored(orphan.runId)).status).toBe(swept ? 'error' : 'active')
    }
  })

  it('settles a stopped run as cancelled when no controller owns it', async () => {
    const orphan = await admittedRun({ status: 'paused_waiting_for_tool' })

    const result = await abortRun.execute({
      principal: { kind: 'session', userId, sessionId: generateId() },
      input: { streamId: orphan.streamId, chatId: orphan.chatId, workspaceId },
    })

    expect(result).toMatchObject({ aborted: true })
    const run = await stored(orphan.runId)
    expect(run.status).toBe('cancelled')
    expect(run.completedAt).not.toBeNull()
    expect(run.toolAdmissionClosedAt).not.toBeNull()
    expect(run.marker).toBeNull()
  })

  it('never cancels a run nobody stopped', async () => {
    const orphan = await admittedRun({ superseded: true })

    expect(await settleStoppedRunWithoutController(orphan.runId)).toBe(false)

    const run = await stored(orphan.runId)
    expect(run.status).toBe('active')
    expect(run.marker).toBe(orphan.streamId)
  })

  it('leaves a stopped run to the controller of its stream that holds the chat lock', async () => {
    const owned = await admittedRun()
    await stop(owned)
    await redis().set(chatStreamLockKey(owned.chatId), owned.controllerToken!, 'EX', 60)

    try {
      expect(await settleStoppedRunWithoutController(owned.runId)).toBe(false)
      const run = await stored(owned.runId)
      expect(run.status).toBe('active')
      expect(run.marker).toBe(owned.streamId)
    } finally {
      await redis().del(chatStreamLockKey(owned.chatId))
    }
  })

  it('never deadlocks a sweep against recovering controllers claiming the same runs', async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const orphans = await Promise.all(
        Array.from({ length: 20 }, () => admittedRun({ idleMinutes: 90 }))
      )

      const [sweep, ...claims] = await Promise.all([
        sweepOrphanedRuns(),
        /** Staggered so claims land while the sweep's settling transaction holds its locks. */
        ...orphans.map((orphan) =>
          sleep(randomInt(0, 40)).then(() =>
            claimRunController({
              runId: orphan.runId,
              chatId: orphan.chatId,
              previousToken: orphan.controllerToken!,
              token: `${orphan.streamId}\n${generateId()}`,
              recoveryBackoff: FIRST_RECOVERY,
            })
          )
        ),
      ])

      orphans.forEach((orphan, index) => {
        expect(claims[index] !== sweep.settledRunIds.includes(orphan.runId)).toBe(true)
      })
    }
  })

  it('settles a stopped run exactly once when Stop races its own controller finalizing', async () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const orphan = await admittedRun()
      await stop(orphan)

      const [finalized, stopped] = await Promise.all([
        updateRunStatus(orphan.runId, 'complete', {}, orphan.controllerToken!),
        settleStoppedRunWithoutController(orphan.runId),
      ])

      expect(Boolean(finalized) !== stopped).toBe(true)
      expect((await stored(orphan.runId)).status).toBe(stopped ? 'cancelled' : 'complete')
    }
  })

  it('settles a stopped run exactly once when Stop races a recovering controller claiming it', async () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const orphan = await admittedRun()
      await stop(orphan)

      const [claimed, stopped] = await Promise.all([
        claimRunController({
          runId: orphan.runId,
          chatId: orphan.chatId,
          previousToken: orphan.controllerToken!,
          token: `${orphan.streamId}\n${generateId()}`,
          recoveryBackoff: FIRST_RECOVERY,
        }),
        settleStoppedRunWithoutController(orphan.runId),
      ])

      expect(claimed !== stopped).toBe(true)
      expect((await stored(orphan.runId)).status).toBe(stopped ? 'cancelled' : 'active')
    }
  })

  it('never takes a run from a reconnect that locked its chat while the sweep was settling', async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const orphans = await Promise.all(
        Array.from({ length: 20 }, () => admittedRun({ idleMinutes: 90 }))
      )

      /**
       * Each reconnect locks the chat, proves its lease, then claims the run, as recovery
       * does. A run still unfinished once its reconnect holds the lock belongs to it.
       */
      const reconnect = async (orphan: (typeof orphans)[number]) => {
        await sleep(randomInt(0, 40))
        if (!(await acquirePendingChatStream(orphan.chatId, orphan.streamId, 0))) {
          return { owned: false, claimed: false }
        }
        const lease = getLocalChatStreamLease(orphan.chatId, orphan.streamId)!
        try {
          await assertChatStreamLease(lease)
          const owned = (await stored(orphan.runId)).status === 'active'
          await sleep(randomInt(0, 10))
          const claimed = await claimRunController({
            runId: orphan.runId,
            chatId: orphan.chatId,
            previousToken: orphan.controllerToken!,
            token: lease.value,
            recoveryBackoff: FIRST_RECOVERY,
          })
          return { owned, claimed }
        } finally {
          await releasePendingChatStream(orphan.chatId, orphan.streamId, lease)
        }
      }
      const [sweep, ...reconnects] = await Promise.all([
        sweepOrphanedRuns(),
        ...orphans.map(reconnect),
      ])

      orphans.forEach((orphan, index) => {
        const swept = sweep.settledRunIds.includes(orphan.runId)
        if (reconnects[index].owned) expect(reconnects[index].claimed).toBe(true)
        expect(reconnects[index].claimed !== swept).toBe(true)
      })
    }
  })

  it('announces every settled run whose chat it released, legacy runs included', async () => {
    const legacy = await admittedRun({
      idleMinutes: 25 * 60,
      controllerToken: null,
      legacy: true,
    })
    const announced: string[] = []
    const unsubscribe = chatPubSub!.onStatusChanged((event) => {
      if (event.type === 'completed') announced.push(event.chatId)
    })

    try {
      const { settledRunIds } = await sweepOrphanedRuns()
      expect(settledRunIds).toContain(legacy.runId)
      for (let wait = 0; wait < 50 && !announced.includes(legacy.chatId); wait++) await sleep(20)
      expect(announced).toContain(legacy.chatId)
    } finally {
      unsubscribe()
    }
  })

  it('reaches an orphan behind more unsettleable runs than one sweep examines', async () => {
    /** Runs whose replay is still live, all sorting before the orphan. */
    const blockers = Array.from({ length: 10_500 }, (_, index) => ({
      runId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
      chatId: generateId(),
      streamId: generateId(),
    }))
    const orphan = await admittedRun({
      idleMinutes: 90,
      id: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
    })
    const blockerChatIds = blockers.map((blocker) => blocker.chatId)
    try {
      for (let start = 0; start < blockers.length; start += 1000) {
        const page = blockers.slice(start, start + 1000)
        await db.insert(copilotChats).values(
          page.map((blocker) => ({
            id: blocker.chatId,
            userId,
            workspaceId,
            type: 'mothership' as const,
          }))
        )
        await db.insert(copilotRuns).values(
          page.map((blocker) => ({
            id: blocker.runId,
            executionId: generateId(),
            chatId: blocker.chatId,
            userId,
            workspaceId,
            streamId: blocker.streamId,
            toolExecutionVersion: 2,
            status: 'active' as const,
            requestContext: { controllerToken: `${blocker.streamId}\n${generateId()}` },
            startedAt: sql`now() - interval '2 hours'`,
            updatedAt: sql`now() - interval '2 hours'`,
          }))
        )
        const pipeline = redis().pipeline()
        for (const blocker of page) {
          pipeline.set(`mothership_stream:${blocker.streamId}:seq`, '1', 'EX', 600)
        }
        await pipeline.exec()
      }

      const first = await sweepOrphanedRuns()
      const second = first.settledRunIds.includes(orphan.runId) ? first : await sweepOrphanedRuns()

      expect(second.settledRunIds).toContain(orphan.runId)
      expect((await stored(orphan.runId)).status).toBe('error')
    } finally {
      for (let start = 0; start < blockerChatIds.length; start += 1000) {
        await db
          .delete(copilotChats)
          .where(inArray(copilotChats.id, blockerChatIds.slice(start, start + 1000)))
      }
      const pipeline = redis().pipeline()
      for (const blocker of blockers) pipeline.del(`mothership_stream:${blocker.streamId}:seq`)
      await pipeline.exec()
    }
  }, 120_000)
})
