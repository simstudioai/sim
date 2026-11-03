import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
/**
 * How often reconnecting to an orphaned Chat run re-POSTs it to the worker, against real
 * Redis and PostgreSQL. The production reconnect route, stream recovery, chat lifecycle
 * and finalization run unmodified; a local HTTP server stands in for the worker. Faults
 * are injected at two seams: the leased replay append (an append that fails once or every
 * time, or a lease lost with no successor to take over) and a recovering controller's read
 * of the replay ring.
 */
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedEnv, worker } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const { toRecord } = await import('@sim/utils/object')
  const { createServer } = await import('node:http')
  interface RunFixture {
    mode: 'frames' | 'json500' | 'drop'
    frames: unknown[]
    posts: { path: string; at: number }[]
    append?: {
      frames: 'any_tool' | 'tool_result'
      effect: 'throw' | 'throw_once' | 'lose_lease'
    }
    recoveryRead: boolean
  }
  const worker = {
    runs: new Map<string, RunFixture>(),
    /** The backoff each successful takeover persisted, in claim order, by run id. */
    claims: new Map<string, { attempts: number; claimedAt: number; notBefore: number }[]>(),
    unexpectedRequests: [] as { path: string; reason: string }[],
  }
  const server = createServer(async (request, response) => {
    let body: Record<string, unknown>
    try {
      let raw = ''
      request.setEncoding('utf8')
      for await (const chunk of request) raw += chunk
      body = toRecord(JSON.parse(raw))
    } catch {
      worker.unexpectedRequests.push({ path: request.url ?? '', reason: 'malformed_body' })
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'Run not found' }))
      return
    }
    const fixture = typeof body.messageId === 'string' ? worker.runs.get(body.messageId) : undefined
    if (
      !fixture ||
      (request.url !== '/api/mothership' && request.url !== '/api/streams/explicit-abort')
    ) {
      worker.unexpectedRequests.push({
        path: request.url ?? '',
        reason: fixture ? 'unknown_path' : 'unknown_stream',
      })
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'Run not found' }))
      return
    }
    fixture.posts.push({ path: request.url, at: Date.now() })
    if (request.url === '/api/streams/explicit-abort') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ settled: true }))
      return
    }
    if (fixture.mode === 'json500') {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'internal' }))
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    if (fixture.mode === 'drop') {
      response.write(`data: ${JSON.stringify(fixture.frames[0])}\n\n`)
      setTimeout(() => response.socket?.destroy(), 20)
      return
    }
    for (const frame of fixture.frames) response.write(`data: ${JSON.stringify(frame)}\n\n`)
    response.end('data: [DONE]\n\n')
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
  return { redisUrl: url, inheritedEnv, worker: Object.assign(worker, { server }) }
})

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/mothership/request/lifecycle/controller-ownership', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/mothership/request/lifecycle/controller-ownership')>()
  return {
    ...actual,
    claimRunController: async (...args: Parameters<typeof actual.claimRunController>) => {
      const claimed = await actual.claimRunController(...args)
      const [{ runId, recoveryBackoff }] = args
      if (claimed) worker.claims.set(runId, [...(worker.claims.get(runId) ?? []), recoveryBackoff])
      return claimed
    },
  }
})
vi.mock('@/lib/mothership/request/session/buffer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mothership/request/session/buffer')>()
  const { getRedisClient } = await import('@/lib/core/config/redis')
  return {
    ...actual,
    appendEvents: async (...args: Parameters<typeof actual.appendEvents>) => {
      const [envelopes, scope, lease] = args
      if (envelopes.length === 0) return actual.appendEvents(...args)
      const streamId = scope?.streamId ?? envelopes[0]?.stream.streamId
      const fixture = streamId ? worker.runs.get(streamId) : undefined
      if (!fixture) {
        worker.unexpectedRequests.push({ path: 'appendEvents', reason: 'unknown_append_stream' })
        throw new Error('Append has no registered recovery fixture')
      }
      const fault = fixture.append
      const hit =
        lease &&
        fault &&
        envelopes.some(
          (envelope) =>
            envelope.type === 'tool' &&
            (fault.frames === 'any_tool' ||
              (envelope.payload as { phase?: string }).phase === 'result')
        )
      if (hit && fault.effect === 'throw') throw new Error('simulated Redis write failure')
      /** A Redis blip that outlasts the append retries, after which Redis is healthy again. */
      if (hit && fault.effect === 'throw_once') {
        fixture.append = undefined
        throw new Error('simulated transient Redis write failure')
      }
      /** The lock expires under a live controller, and nobody else holds it. */
      if (hit && fault.effect === 'lose_lease') await getRedisClient()!.del(lease.key)
      return actual.appendEvents(...args)
    },
    readEvents: async (...args: Parameters<typeof actual.readEvents>) => {
      const [streamId, afterCursor] = args
      const fixture = worker.runs.get(streamId)
      if (!fixture) {
        worker.unexpectedRequests.push({ path: 'readEvents', reason: 'unknown_read_stream' })
        throw new Error('Read has no registered recovery fixture')
      }
      if (fixture.recoveryRead && afterCursor === '0')
        throw new Error('simulated Redis read failure')
      return actual.readEvents(...args)
    },
  }
})

import { db } from '@sim/db'
import {
  copilotChats,
  copilotMessages,
  copilotRuns,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import {
  MAX_RECOVERY_ATTEMPTS,
  RECOVERY_BUDGET_RESET_MS,
} from '@/lib/mothership/request/lifecycle/controller-ownership'
import { isTerminalStreamStatus } from '@/lib/mothership/request/session'
import { appendEvents } from '@/lib/mothership/request/session/buffer'
import { chatStreamLockKey } from '@/lib/mothership/request/session/controller-lease'
import { createEvent } from '@/lib/mothership/request/session/event'
import { StreamRecoveryExhaustedError } from '@/lib/mothership/request/session/turn-failure'
import { GET as streamGET } from '@/app/api/copilot/chat/stream/route'

const userId = generateId()
const workspaceId = generateId()
const chatIds: string[] = []

function redis() {
  const client = getRedisClient()
  if (!client) throw new Error('The integration suite requires TEST_REDIS_URL')
  return client
}

/** A run whose controller died after persisting two text frames, its lock long expired. */
async function orphanedRun(
  options: {
    status?: 'active' | 'paused_waiting_for_tool'
    recoveryBackoff?: Record<string, number>
    mode?: 'frames' | 'json500' | 'drop'
  } = {}
) {
  const chatId = generateId()
  chatIds.push(chatId)
  const streamId = generateId()
  const runId = generateId()
  const request = { message: 'Summarize', userId, messageId: streamId, chatId, workspaceId }
  await db
    .insert(copilotChats)
    .values({ id: chatId, userId, workspaceId, type: 'mothership', conversationId: streamId })
  await db.insert(copilotMessages).values({
    chatId,
    messageId: streamId,
    role: 'user',
    streamId,
    seq: 0,
    content: { id: streamId, role: 'user', content: request.message },
  })
  await db.insert(copilotRuns).values({
    id: runId,
    executionId: generateId(),
    chatId,
    userId,
    workspaceId,
    streamId,
    status: options.status ?? 'active',
    toolExecutionVersion: 2,
    requestContext: {
      requestId: generateId(),
      controllerToken: `dead\n${generateId()}`,
      recovery: {
        kind: 'interactive_stream',
        request,
        goRoute: '/api/mothership',
        clientToolPickupExpected: false,
      },
      ...(options.recoveryBackoff ? { recoveryBackoff: options.recoveryBackoff } : {}),
    },
  })
  const fixture: NonNullable<ReturnType<typeof worker.runs.get>> = {
    mode: options.mode ?? 'frames',
    frames: [],
    posts: [],
    recoveryRead: false,
  }
  worker.runs.set(streamId, fixture)
  await appendEvents(
    [1, 2].map((seq) =>
      createEvent({
        streamId,
        cursor: String(seq),
        seq,
        requestId: generateId(),
        type: 'text',
        payload: { channel: 'assistant', text: `part ${seq} ` },
      })
    ),
    { streamId }
  )
  const frame = (seq: number, type: string, payload: unknown) => ({
    v: 1,
    type,
    seq,
    ts: new Date().toISOString(),
    stream: { streamId, chatId },
    payload,
  })
  fixture.frames = [
    frame(1, 'tool', {
      phase: 'call',
      toolCallId: 'go-call',
      toolName: 'search_online',
      executor: 'go',
      mode: 'sync',
      arguments: { query: 'logs' },
    }),
    frame(2, 'tool', {
      phase: 'result',
      toolCallId: 'go-call',
      toolName: 'search_online',
      executor: 'go',
      mode: 'sync',
      success: true,
      output: { results: [] },
    }),
    frame(3, 'complete', { status: 'complete', textLength: 14 }),
  ]
  return { chatId, streamId, runId, fixture }
}

async function storedRun(runId: string) {
  const [run] = await db
    .select({
      status: copilotRuns.status,
      error: copilotRuns.error,
      requestContext: copilotRuns.requestContext,
    })
    .from(copilotRuns)
    .where(eq(copilotRuns.id, runId))
  return {
    ...run,
    recoveryBackoff: (run.requestContext as { recoveryBackoff?: Record<string, number> })
      .recoveryBackoff,
  }
}

/**
 * Holds `tails` browser-like reconnect tails open until the run is terminal and its chat
 * lock released, or `windowMs` passes, and returns the worker requests made meanwhile.
 */
async function reconnect(
  { chatId, streamId, runId, fixture }: Awaited<ReturnType<typeof orphanedRun>>,
  {
    tails = 1,
    windowMs,
    waitForLeaseRelease = true,
  }: { tails?: number; windowMs: number; waitForLeaseRelease?: boolean }
) {
  const startedAt = Date.now()
  const controllers = Array.from({ length: tails }, () => new AbortController())
  const drains = controllers.map(async (controller) => {
    const response = await streamGET(
      new NextRequest(
        `http://localhost:3000/api/copilot/chat/stream?streamId=${streamId}&after=2`,
        { signal: controller.signal }
      ),
      { params: Promise.resolve({}) }
    )
    /** The route never observes the request signal under test, so the reader cancels. */
    await response.body?.pipeTo(new WritableStream(), { signal: controller.signal }).catch(() => {})
  })
  while (Date.now() - startedAt < windowMs) {
    const settled =
      isTerminalStreamStatus((await storedRun(runId)).status) &&
      !(await redis().get(chatStreamLockKey(chatId)))
    if (settled) break
    await sleep(100)
  }
  for (const controller of controllers) controller.abort()
  await Promise.allSettled(drains)
  if (waitForLeaseRelease)
    for (let i = 0; i < 50 && (await redis().get(chatStreamLockKey(chatId))); i++) await sleep(100)
  const requests = fixture.posts.filter((post) => post.at >= startedAt)
  return {
    startedAt,
    turns: requests.filter((post) => post.path === '/api/mothership'),
    stops: requests.filter((post) => post.path === '/api/streams/explicit-abort'),
  }
}

afterAll(async () => {
  await new Promise<void>((resolve) => worker.server.close(() => resolve()))
  worker.runs.clear()
  worker.claims.clear()
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  expect(worker.unexpectedRequests).toEqual([])
})

describe.runIf(Boolean(redisUrl))('reconnecting to an orphaned Chat run', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Recovery storm fixture',
      email: `${userId}@recovery-storm.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Recovery storm fixture',
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
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: userId },
      session: { id: generateId() },
    })
  })

  afterAll(async () => {
    for (const chatId of chatIds) {
      await db.delete(copilotMessages).where(eq(copilotMessages.chatId, chatId))
      await db.delete(copilotRuns).where(eq(copilotRuns.chatId, chatId))
      await db.delete(copilotChats).where(eq(copilotChats.id, chatId))
    }
    await db.delete(permissions).where(eq(permissions.userId, userId))
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
    await closeRedisConnection()
  })

  it.each(['active', 'paused_waiting_for_tool'] as const)(
    'takes over an orphaned %s run at once and completes it',
    async (status) => {
      const run = await orphanedRun({ status })

      const { startedAt, turns } = await reconnect(run, { windowMs: 10_000 })

      expect(turns).toHaveLength(1)
      expect(turns[0].at - startedAt).toBeLessThan(1_000)
      const stored = await storedRun(run.runId)
      expect(stored.status).toBe('complete')
      expect(stored.recoveryBackoff).toMatchObject({ attempts: 1 })
    },
    30_000
  )

  it('hands off a turn whose append fails once, and the next controller completes it', async () => {
    const run = await orphanedRun()
    run.fixture.append = { frames: 'any_tool', effect: 'throw_once' }
    try {
      const { turns, stops } = await reconnect(run, { windowMs: 15_000 })

      expect(turns).toHaveLength(2)
      expect(stops).toHaveLength(0)
      expect(await storedRun(run.runId)).toMatchObject({
        status: 'complete',
        recoveryBackoff: { attempts: 2 },
      })
    } finally {
      run.fixture.append = undefined
    }
  }, 60_000)

  it.concurrent.for([
    { frames: 'any_tool', effect: 'throw', tails: 1 },
    { frames: 'any_tool', effect: 'throw', tails: 3 },
    { frames: 'tool_result', effect: 'throw', tails: 1 },
    { frames: 'tool_result', effect: 'throw', tails: 3 },
    { frames: 'any_tool', effect: 'lose_lease', tails: 3 },
  ] as const)(
    'gives up on a run whose recovered controllers keep failing ($effect on $frames, $tails tails)',
    { timeout: 120_000 },
    async ({ frames, effect, tails }, { expect }) => {
      const run = await orphanedRun()
      run.fixture.append = { frames, effect }
      try {
        const { turns, stops } = await reconnect(run, { tails, windowMs: 60_000 })

        expect(turns).toHaveLength(MAX_RECOVERY_ATTEMPTS)
        /**
         * Each takeover is planned no earlier than the jittered floor of the one before it,
         * read from the backoff each claim persisted. Worker request arrival would add the
         * variable work between a claim and its POST, which concurrent cases stretch.
         */
        const claims = worker.claims.get(run.runId) ?? []
        expect(claims.map((claim) => claim.attempts)).toEqual(
          Array.from({ length: MAX_RECOVERY_ATTEMPTS + 1 }, (_, i) => i + 1)
        )
        claims.slice(1).forEach((claim, i) => {
          expect(claim.claimedAt).toBeGreaterThanOrEqual(claims[i].notBefore)
          expect(claims[i].notBefore - claims[i].claimedAt).toBeGreaterThanOrEqual(
            0.8 * 1_000 * 2 ** i
          )
        })
        expect(stops).toHaveLength(1)
        expect(await storedRun(run.runId)).toMatchObject({
          status: 'error',
          error: new StreamRecoveryExhaustedError().userMessage,
          recoveryBackoff: { attempts: MAX_RECOVERY_ATTEMPTS + 1 },
        })
      } finally {
        run.fixture.append = undefined
      }
    }
  )

  it('waits out the backoff of a recent takeover, then takes over and completes the run', async () => {
    const now = Date.now()
    const notBefore = now + 3_000
    const run = await orphanedRun({
      recoveryBackoff: { attempts: 2, claimedAt: now - 1_000, notBefore },
    })

    const { turns } = await reconnect(run, { windowMs: 15_000 })

    expect(turns).toHaveLength(1)
    expect(turns[0].at).toBeGreaterThanOrEqual(notBefore)
    const stored = await storedRun(run.runId)
    expect(stored.status).toBe('complete')
    expect(stored.recoveryBackoff).toMatchObject({ attempts: 3 })
  }, 30_000)

  it('starts a fresh budget once the previous takeover is older than the reset window', async () => {
    const claimedAt = Date.now() - RECOVERY_BUDGET_RESET_MS - 1_000
    const run = await orphanedRun({
      recoveryBackoff: { attempts: MAX_RECOVERY_ATTEMPTS, claimedAt, notBefore: claimedAt },
    })

    const { startedAt, turns } = await reconnect(run, { windowMs: 10_000 })

    expect(turns).toHaveLength(1)
    expect(turns[0].at - startedAt).toBeLessThan(1_000)
    const stored = await storedRun(run.runId)
    expect(stored.status).toBe('complete')
    expect(stored.recoveryBackoff).toMatchObject({ attempts: 1 })
  }, 30_000)

  it('leaves the run untouched when a takeover fails before it starts, then ends it once exhausted', async () => {
    const claimedAt = Date.now() - 1_000
    const recoveryBackoff = { attempts: MAX_RECOVERY_ATTEMPTS, claimedAt, notBefore: claimedAt }
    const run = await orphanedRun({ recoveryBackoff })
    const { controllerToken } = (await storedRun(run.runId)).requestContext as {
      controllerToken: string
    }
    run.fixture.recoveryRead = true
    try {
      const { turns } = await reconnect(run, { windowMs: 2_000 })

      expect(turns).toHaveLength(0)
      expect(await storedRun(run.runId)).toMatchObject({
        status: 'active',
        requestContext: { controllerToken },
        recoveryBackoff,
      })
    } finally {
      run.fixture.recoveryRead = false
    }

    const { turns, stops } = await reconnect(run, { windowMs: 10_000 })

    expect(turns).toHaveLength(0)
    expect(stops).toHaveLength(1)
    expect(await storedRun(run.runId)).toMatchObject({
      status: 'error',
      error: new StreamRecoveryExhaustedError().userMessage,
      recoveryBackoff: { attempts: MAX_RECOVERY_ATTEMPTS + 1 },
    })
  }, 30_000)

  it('never takes over a parked run whose controller still holds the chat lock', async () => {
    const run = await orphanedRun({ status: 'paused_waiting_for_tool' })
    const liveController = `${run.streamId}\n${generateId()}`
    await redis().set(chatStreamLockKey(run.chatId), liveController, 'EX', 60)
    try {
      const { turns } = await reconnect(run, {
        tails: 3,
        windowMs: 3_000,
        waitForLeaseRelease: false,
      })

      expect(turns).toHaveLength(0)
      const stored = await storedRun(run.runId)
      expect(stored.status).toBe('paused_waiting_for_tool')
      expect(stored.recoveryBackoff).toBeUndefined()
      expect(await redis().get(chatStreamLockKey(run.chatId))).toBe(liveController)
    } finally {
      await redis().del(chatStreamLockKey(run.chatId))
    }
  }, 30_000)

  it.each(['json500', 'drop'] as const)(
    'ends the run after its bounded retries when the worker fails every leg (%s)',
    async (mode) => {
      const run = await orphanedRun({ mode })
      const { turns } = await reconnect(run, { windowMs: 20_000 })

      expect(turns).toHaveLength(4)
      expect((await storedRun(run.runId)).status).toBe('error')
    },
    60_000
  )
})
