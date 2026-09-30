/**
 * Settlement of Chat runs that no controller owns, against real PostgreSQL and Redis:
 * the chat stream lock, the replay buffer keys, the run and chat rows, and the Stop
 * use case are production code. A local HTTP server stands in for the worker's abort
 * endpoint.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

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
import { copilotChats, copilotRuns, permissions, user, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import {
  settleStoppedRunWithoutController,
  sweepOrphanedRuns,
} from '@/lib/mothership/async-runs/orphaned-runs'
import { updateRunStatus } from '@/lib/mothership/async-runs/repository'
import { abortRun } from '@/lib/mothership/request/application/controls'
import { claimRunController } from '@/lib/mothership/request/lifecycle/controller-ownership'
import { chatStreamLockKey } from '@/lib/mothership/request/session/controller-lease'

function redis() {
  const client = getRedisClient()
  if (!client) throw new Error('The integration suite requires TEST_REDIS_URL')
  return client
}

afterAll(async () => {
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
   */
  async function admittedRun(
    options: {
      idleMinutes?: number
      status?: 'active' | 'paused_waiting_for_tool'
      controllerToken?: string | null
      stopped?: boolean
    } = {}
  ) {
    const chatId = generateId()
    const streamId = generateId()
    const runId = generateId()
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
      toolExecutionVersion: 2,
      status: options.status ?? 'active',
      requestContext: controllerToken
        ? { requestId: generateId(), controllerToken, recovery: { kind: 'interactive_stream' } }
        : { source: 'headless_lifecycle' },
      startedAt: idle,
      updatedAt: idle,
      ...(options.stopped ? { toolAdmissionClosedAt: idle } : {}),
    })
    return { chatId, streamId, runId, controllerToken }
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

  it('settles a run stopped while no controller owned it as cancelled', async () => {
    const orphan = await admittedRun({ idleMinutes: 90, stopped: true })

    const { settledRunIds } = await sweepOrphanedRuns()

    expect(settledRunIds).toContain(orphan.runId)
    expect((await stored(orphan.runId)).status).toBe('cancelled')
  })

  it('settles a run without a lease only after the unleased ceiling', async () => {
    const recent = await admittedRun({ idleMinutes: 90, controllerToken: null })
    const abandoned = await admittedRun({ idleMinutes: 25 * 60, controllerToken: null })

    const { settledRunIds } = await sweepOrphanedRuns()

    expect(settledRunIds).toContain(abandoned.runId)
    expect(settledRunIds).not.toContain(recent.runId)
    expect((await stored(abandoned.runId)).status).toBe('error')
    expect((await stored(recent.runId)).status).toBe('active')
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

  it('leaves a stopped run to the controller of its stream that holds the chat lock', async () => {
    const owned = await admittedRun()
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
})
