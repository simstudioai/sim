/**
 * Recovery of a Chat run whose Sim controller died after its replay ring lost its
 * head, against real Redis and PostgreSQL through the production reconnect route and
 * chat lifecycle. A local HTTP server stands in for the worker: it answers the new
 * controller's re-attach with the run's whole response, as its duplicate-send path does.
 */
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedEnv, worker } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const { createServer } = await import('node:http')
  const worker = {
    chatRequests: [] as Array<Record<string, unknown>>,
    /** SSE frames for the re-attach, built once the stream id is known. */
    frames: [] as unknown[],
  }
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    if (request.url === '/api/mothership') {
      worker.chatRequests.push(JSON.parse(body))
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const frame of worker.frames) response.write(`data: ${JSON.stringify(frame)}\n\n`)
      response.end('data: [DONE]\n\n')
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'Run not found' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const url = readTestRedisUrl()
  const inheritedEnv = {
    REDIS_URL: process.env.REDIS_URL,
    SIM_AGENT_API_URL: process.env.SIM_AGENT_API_URL,
  }
  process.env.REDIS_URL = url
  process.env.SIM_AGENT_API_URL = `http://127.0.0.1:${port}`
  return { redisUrl: url, inheritedEnv, worker: Object.assign(worker, { server }) }
})

vi.mock('@/lib/auth', () => authMock)

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
import { toRecord } from '@sim/utils/object'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import { appendEvents } from '@/lib/mothership/request/session/buffer'
import { chatStreamLockKey } from '@/lib/mothership/request/session/controller-lease'
import { createEvent } from '@/lib/mothership/request/session/event'
import { GET as streamGET } from '@/app/api/copilot/chat/stream/route'

const userId = generateId()
const workspaceId = generateId()
const chatId = generateId()
const FULL_TEXT = 'part 1 part 2 part 3 part 4 '

function workerFrame(streamId: string, seq: number, type: string, payload: unknown) {
  return { v: 1, type, seq, ts: new Date().toISOString(), stream: { streamId, chatId }, payload }
}

describe.runIf(Boolean(redisUrl))('recovering a run whose ring lost its head', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Stream recovery fixture',
      email: `${userId}@stream-recovery.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Stream recovery fixture',
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
    await db.delete(copilotMessages).where(eq(copilotMessages.chatId, chatId))
    await db.delete(copilotRuns).where(eq(copilotRuns.chatId, chatId))
    await db.delete(copilotChats).where(eq(copilotChats.id, chatId))
    await db.delete(permissions).where(eq(permissions.userId, userId))
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
    await closeRedisConnection()
    await new Promise<void>((resolve) => worker.server.close(() => resolve()))
    for (const [key, value] of Object.entries(inheritedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('recovers from an empty context and persists the whole turn once', async () => {
    const streamId = generateId()
    const runId = generateId()
    const request = {
      message: 'Summarize the logs',
      userId,
      messageId: streamId,
      chatId,
      workspaceId,
    }
    await db.insert(copilotChats).values({
      id: chatId,
      userId,
      workspaceId,
      type: 'mothership',
      conversationId: streamId,
    })
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
      requestContext: {
        requestId: generateId(),
        controllerToken: `dead\n${generateId()}`,
        recovery: {
          kind: 'interactive_stream',
          request,
          goRoute: '/api/mothership',
          clientToolPickupExpected: false,
        },
      },
    })
    await appendEvents(
      [1, 2, 3, 4].map((seq) =>
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
    await getRedisClient()!.set(`mothership_stream:${streamId}:seq`, '4')
    await getRedisClient()!.zremrangebyrank(`mothership_stream:${streamId}:events`, 0, 1)
    worker.frames = [
      workerFrame(streamId, 1, 'session', { kind: 'start' }),
      workerFrame(streamId, 2, 'text', { channel: 'assistant', text: FULL_TEXT, textOffset: 0 }),
      workerFrame(streamId, 3, 'complete', { status: 'complete', textLength: FULL_TEXT.length }),
    ]

    const reconnect = await streamGET(
      new NextRequest(`http://localhost:3000/api/copilot/chat/stream?streamId=${streamId}&after=4`),
      { params: Promise.resolve({}) }
    )
    await reconnect.body?.cancel()

    let run: { status: string } | undefined
    for (let attempt = 0; attempt < 100 && run?.status !== 'complete'; attempt++) {
      await sleep(100)
      ;[run] = await db
        .select({ status: copilotRuns.status })
        .from(copilotRuns)
        .where(eq(copilotRuns.id, runId))
    }
    expect(run?.status).toBe('complete')

    const [chat] = await db
      .select({ conversationId: copilotChats.conversationId })
      .from(copilotChats)
      .where(eq(copilotChats.id, chatId))
    expect(chat.conversationId).toBeNull()
    const assistant = await db
      .select({ content: copilotMessages.content })
      .from(copilotMessages)
      .where(eq(copilotMessages.chatId, chatId))
      .then((rows) =>
        rows.map((row) => toRecord(row.content)).filter((m) => m.role === 'assistant')
      )
    expect(assistant).toHaveLength(1)
    expect(String(assistant[0].content).trim()).toBe(FULL_TEXT.trim())

    // One re-attach under the original identity and an empty receipt: the worker re-sends
    // the response rather than running, or billing, the turn again.
    expect(worker.chatRequests).toHaveLength(1)
    expect(worker.chatRequests[0]).toMatchObject({ messageId: streamId, receivedTextChars: 0 })
    expect(await getRedisClient()!.get(chatStreamLockKey(chatId))).toBeNull()
  })
})
