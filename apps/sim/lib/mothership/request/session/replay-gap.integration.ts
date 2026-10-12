/**
 * Reconnects that Sim's replay ring can no longer serve, against real Redis and
 * PostgreSQL through the production reconnect route. A local HTTP server stands in for
 * the worker's read-only replay endpoint; everything on Sim's side is production code.
 */
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedEnv, worker } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const { createServer } = await import('node:http')
  const worker = {
    requests: [] as Array<Record<string, unknown>>,
    /** What the replay endpoint answers: an HTTP status, or SSE frames. */
    reply: { status: 200, frames: [] as unknown[] },
  }
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    if (request.url !== '/api/streams/replay') {
      response.writeHead(404).end()
      return
    }
    worker.requests.push(JSON.parse(body))
    if (worker.reply.status !== 200) {
      response.writeHead(worker.reply.status, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'Run not found' }))
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const frame of worker.reply.frames) response.write(`data: ${JSON.stringify(frame)}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const url = readTestRedisUrl()
  const inheritedEnv = {
    REDIS_URL: process.env.REDIS_URL,
    SIM_AGENT_API_URL: process.env.SIM_AGENT_API_URL,
    COPILOT_STREAM_EVENT_LIMIT: process.env.COPILOT_STREAM_EVENT_LIMIT,
  }
  process.env.REDIS_URL = url
  process.env.SIM_AGENT_API_URL = `http://127.0.0.1:${port}`
  /** A ring this small loses the head of every stream below. */
  process.env.COPILOT_STREAM_EVENT_LIMIT = '5'
  return { redisUrl: url, inheritedEnv, worker: Object.assign(worker, { server }) }
})

vi.mock('@/lib/auth', () => authMock)

import { db } from '@sim/db'
import { copilotChats, copilotRuns, permissions, user, workspace } from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import { MOTHERSHIP_STREAM_REPLAY_HEADER } from '@/lib/mothership/constants'
import { allocateCursor, appendEvents } from '@/lib/mothership/request/session/buffer'
import { createEvent } from '@/lib/mothership/request/session/event'
import { GET as streamGET } from '@/app/api/copilot/chat/stream/route'

const userId = generateId()
const workspaceId = generateId()
const chatId = generateId()

function dataFrames(body: string) {
  return body
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice('data: '.length)))
}

/** A worker frame as the replay endpoint writes it, with the worker's own sequence. */
function workerFrame(streamId: string, seq: number, type: string, payload: unknown) {
  return {
    v: 1,
    type,
    seq,
    ts: new Date().toISOString(),
    stream: { streamId, chatId },
    payload,
  }
}

async function appendText(streamId: string, value: string): Promise<void> {
  const { seq, cursor } = await allocateCursor(streamId)
  await appendEvents([
    createEvent({
      streamId,
      cursor,
      seq,
      requestId: 'req-ring',
      type: 'text',
      payload: { channel: 'assistant', text: value },
    }),
  ])
}

/** A live run whose ring holds only the last five of its ten events. */
async function liveRunWithTrimmedRing(): Promise<{ streamId: string; runId: string }> {
  const streamId = generateId()
  const runId = generateId()
  await db.insert(copilotRuns).values({
    id: runId,
    executionId: generateId(),
    chatId,
    userId,
    workspaceId,
    streamId,
  })
  for (let index = 1; index <= 10; index++) await appendText(streamId, `part ${index} `)
  return { streamId, runId }
}

function reconnect(streamId: string, after: string, batch = false, extra = '') {
  return streamGET(
    new NextRequest(
      `http://localhost:3000/api/copilot/chat/stream?streamId=${streamId}&after=${after}${batch ? '&batch=true' : ''}${extra}`
    ),
    { params: Promise.resolve({}) }
  )
}

function fullResponse(streamId: string) {
  return [
    workerFrame(streamId, 1, 'session', { kind: 'start' }),
    workerFrame(streamId, 2, 'text', {
      channel: 'assistant',
      text: 'part 1 part 2 part 3 part 4 part 5 part 6 part 7 part 8 part 9 part 10 ',
      textOffset: 0,
    }),
    workerFrame(streamId, 3, 'complete', { status: 'complete' }),
  ]
}

/** Runs whether or not the suite does, so a skipped suite never leaks the worker or env. */
afterAll(async () => {
  await new Promise<void>((resolve) => worker.server.close(() => resolve()))
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe.runIf(Boolean(redisUrl))('reconnects past the replay ring', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Replay gap fixture',
      email: `${userId}@replay-gap.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Replay gap fixture',
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
    await db.insert(copilotChats).values({ id: chatId, userId, workspaceId, type: 'mothership' })
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: userId },
      session: { id: generateId() },
    })
  })

  beforeEach(() => {
    worker.requests.length = 0
    worker.reply = { status: 200, frames: [] }
  })

  afterAll(async () => {
    await db.delete(copilotRuns).where(eq(copilotRuns.chatId, chatId))
    await db.delete(copilotChats).where(eq(copilotChats.id, chatId))
    await db.delete(permissions).where(eq(permissions.userId, userId))
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
    await closeRedisConnection()
  })

  it.each([
    ['a fresh tab reconnecting from 0', '0'],
    ['a cursor behind the retained ring', '2'],
  ])(
    're-syncs %s from the worker log instead of a partial replay or an error',
    async (_name, after) => {
      const { streamId } = await liveRunWithTrimmedRing()
      worker.reply.frames = fullResponse(streamId)

      const response = await reconnect(streamId, after)
      const frames = dataFrames(await response.text())

      expect(response.headers.get(MOTHERSHIP_STREAM_REPLAY_HEADER)).toBe('log')
      expect(worker.requests).toEqual([{ streamId, chatId, userId }])
      expect(frames.map((frame) => [frame.seq, frame.stream.cursor, frame.type])).toEqual([
        [1, '1', 'session'],
        [2, '2', 'text'],
        [3, '3', 'complete'],
      ])
      expect(frames[1].payload.text).toMatch(/^part 1 part 2 /)
    }
  )

  it('re-syncs a cursor ahead of a ring whose numbering restarted', async () => {
    const { streamId } = await liveRunWithTrimmedRing()
    await getRedisClient()!.del(
      `mothership_stream:${streamId}:events`,
      `mothership_stream:${streamId}:seq`
    )
    await appendText(streamId, 'after expiry ')
    worker.reply.frames = fullResponse(streamId)

    const response = await reconnect(streamId, '4')
    const frames = dataFrames(await response.text())

    expect(response.headers.get(MOTHERSHIP_STREAM_REPLAY_HEADER)).toBe('log')
    expect(frames.map((frame) => frame.type)).toEqual(['session', 'text', 'complete'])
  })

  it('ends a parked replay without a terminal once the run resumes', async () => {
    const { streamId, runId } = await liveRunWithTrimmedRing()
    await db
      .update(copilotRuns)
      .set({ status: 'paused_waiting_for_tool' })
      .where(eq(copilotRuns.id, runId))
    worker.reply.frames = [
      workerFrame(streamId, 1, 'text', { channel: 'assistant', text: 'so far', textOffset: 0 }),
      workerFrame(streamId, 2, 'run', { kind: 'replay_end', reason: 'parked', textLength: 6 }),
    ]

    const startedAt = Date.now()
    const response = await reconnect(streamId, '0')
    const body = response.text()
    await sleep(1_500)
    await db.update(copilotRuns).set({ status: 'active' }).where(eq(copilotRuns.id, runId))
    const frames = dataFrames(await body)

    const elapsed = Date.now() - startedAt
    expect(frames.map((frame) => frame.type)).toEqual(['text'])
    expect(elapsed).toBeGreaterThanOrEqual(1_500)
    expect(elapsed).toBeLessThan(5_000)
    expect(worker.requests).toHaveLength(1)
  })

  it('ends a stalled replay promptly once the run finishes', async () => {
    const { streamId, runId } = await liveRunWithTrimmedRing()
    worker.reply.frames = [
      workerFrame(streamId, 1, 'text', { channel: 'assistant', text: 'so far', textOffset: 0 }),
      workerFrame(streamId, 2, 'run', { kind: 'replay_end', reason: 'stalled', textLength: 6 }),
    ]

    const startedAt = Date.now()
    const body = (await reconnect(streamId, '0')).text()
    await sleep(1_000)
    await db.update(copilotRuns).set({ status: 'complete' }).where(eq(copilotRuns.id, runId))
    await body

    expect(Date.now() - startedAt).toBeLessThan(5_000)
  })

  it('ends a live tail without a terminal when its ring restarts under it', async () => {
    const streamId = generateId()
    await db.insert(copilotRuns).values({
      id: generateId(),
      executionId: generateId(),
      chatId,
      userId,
      workspaceId,
      streamId,
    })
    for (let index = 1; index <= 4; index++) await appendText(streamId, `part ${index} `)

    const response = await reconnect(streamId, '4')
    const body = response.text()
    // Let the tail reach its poll loop, past the reconnect-time gap check.
    await sleep(500)
    await getRedisClient()!.del(
      `mothership_stream:${streamId}:events`,
      `mothership_stream:${streamId}:seq`
    )
    await appendText(streamId, 'after expiry ')
    const frames = dataFrames(await body)

    expect(frames).toEqual([])
  })

  it('keeps a reader re-synced from the log on the log once a restarted ring grows past its cursor', async () => {
    const streamId = generateId()
    await db.insert(copilotRuns).values({
      id: generateId(),
      executionId: generateId(),
      chatId,
      userId,
      workspaceId,
      streamId,
    })
    for (let index = 1; index <= 4; index++) await appendText(streamId, `part ${index} `)
    worker.reply.frames = fullResponse(streamId)

    const response = await reconnect(streamId, '2', false, '&source=log')
    const frames = dataFrames(await response.text())

    expect(response.headers.get(MOTHERSHIP_STREAM_REPLAY_HEADER)).toBe('log')
    expect(frames.map((frame) => frame.type)).toEqual(['session', 'text', 'complete'])
  })

  it('serves no ring events to a batch read from a reader re-synced from the log', async () => {
    const streamId = generateId()
    await db.insert(copilotRuns).values({
      id: generateId(),
      executionId: generateId(),
      chatId,
      userId,
      workspaceId,
      streamId,
    })
    for (let index = 1; index <= 4; index++) await appendText(streamId, `part ${index} `)

    const response = await reconnect(streamId, '2', true, '&source=log')

    expect(await response.json()).toMatchObject({ success: true, events: [], status: 'active' })
  })

  it('holds a stalled replay open before the client re-attaches', async () => {
    const { streamId } = await liveRunWithTrimmedRing()
    worker.reply.frames = [
      workerFrame(streamId, 1, 'text', { channel: 'assistant', text: 'so far', textOffset: 0 }),
      workerFrame(streamId, 2, 'run', { kind: 'replay_end', reason: 'stalled', textLength: 6 }),
    ]

    const startedAt = Date.now()
    const frames = dataFrames(await (await reconnect(streamId, '0')).text())

    expect(frames.map((frame) => frame.type)).toEqual(['text'])
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(9_000)
  })

  it('ends a replay whose end reason it does not know without a run event or an error', async () => {
    const { streamId } = await liveRunWithTrimmedRing()
    worker.reply.frames = [
      workerFrame(streamId, 1, 'text', { channel: 'assistant', text: 'so far', textOffset: 0 }),
      workerFrame(streamId, 2, 'run', { kind: 'replay_end', reason: 'drained', textLength: 6 }),
    ]

    const frames = dataFrames(await (await reconnect(streamId, '0')).text())

    expect(frames.map((frame) => frame.type)).toEqual(['text'])
  })

  it('ends a live tail without a terminal when its ring loses its head under it', async () => {
    const streamId = generateId()
    await db.insert(copilotRuns).values({
      id: generateId(),
      executionId: generateId(),
      chatId,
      userId,
      workspaceId,
      streamId,
    })
    for (let index = 1; index <= 4; index++) await appendText(streamId, `part ${index} `)

    const response = await reconnect(streamId, '4')
    const body = response.text()
    await sleep(500)
    for (let index = 5; index <= 7; index++) await appendText(streamId, `part ${index} `)
    const frames = dataFrames(await body)

    expect(frames.map((frame) => frame.type)).not.toContain('complete')
    expect(response.headers.get(MOTHERSHIP_STREAM_REPLAY_HEADER)).toBeNull()
  })

  it('re-syncs a live run whose buffer expired under a reader cursor', async () => {
    const streamId = generateId()
    await db.insert(copilotRuns).values({
      id: generateId(),
      executionId: generateId(),
      chatId,
      userId,
      workspaceId,
      streamId,
    })
    worker.reply.frames = fullResponse(streamId)

    const response = await reconnect(streamId, '6')
    const frames = dataFrames(await response.text())

    expect(response.headers.get(MOTHERSHIP_STREAM_REPLAY_HEADER)).toBe('log')
    expect(frames.map((frame) => frame.type)).toEqual(['session', 'text', 'complete'])
  })

  it('answers a finished run whose buffer expired with its terminal, not a replay', async () => {
    const streamId = generateId()
    await db.insert(copilotRuns).values({
      id: generateId(),
      executionId: generateId(),
      chatId,
      userId,
      workspaceId,
      streamId,
      status: 'complete',
    })

    const response = await reconnect(streamId, '6')
    const frames = dataFrames(await response.text())

    expect(response.headers.get(MOTHERSHIP_STREAM_REPLAY_HEADER)).toBeNull()
    expect(frames.map((frame) => [frame.type, frame.payload.status])).toEqual([
      ['complete', 'complete'],
    ])
    expect(worker.requests).toEqual([])
  })

  it('serves no ring events to a batch read the ring can no longer serve', async () => {
    const { streamId } = await liveRunWithTrimmedRing()

    const response = await reconnect(streamId, '0', true)

    expect(await response.json()).toMatchObject({ success: true, events: [], status: 'active' })
  })

  it.each([404, 401, 403])(
    'keeps the replay_gap terminal when the worker will not replay the run (%i)',
    async (status) => {
      const { streamId } = await liveRunWithTrimmedRing()
      worker.reply.status = status

      const frames = dataFrames(await (await reconnect(streamId, '2')).text())

      expect(
        frames.map((frame) => [frame.type, frame.payload.code ?? frame.payload.status])
      ).toEqual([
        ['error', 'replay_gap'],
        ['complete', 'error'],
      ])
    }
  )
})
