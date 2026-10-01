/**
 * Recovery of a Chat run whose Sim controller died after its replay ring lost its
 * head, against real Redis and PostgreSQL through the production reconnect route and
 * chat lifecycle. A local HTTP server stands in for the worker: it answers the new
 * controller's re-attach with the run's whole response, as its duplicate-send path does,
 * and answers the tool resume that follows a re-handed call.
 */
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedEnv, worker } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const { createServer } = await import('node:http')
  const worker = {
    requests: [] as Array<{ path: string; body: Record<string, unknown> }>,
    /** SSE frames per worker path, set by each test once its ids are known. */
    replies: {} as Record<string, unknown[]>,
  }
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const frames = request.url ? worker.replies[request.url] : undefined
    if (!request.url || !frames) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'Run not found' }))
      return
    }
    worker.requests.push({ path: request.url, body: JSON.parse(body) })
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const frame of frames) response.write(`data: ${JSON.stringify(frame)}\n\n`)
    response.end('data: [DONE]\n\n')
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
  copilotAsyncToolCalls,
  copilotChats,
  copilotMessages,
  copilotRuns,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { toArray, toRecord } from '@sim/utils/object'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import {
  claimSimToolExecution,
  completeOwnedSimToolCall,
  upsertAsyncToolCall,
} from '@/lib/mothership/async-runs/repository'
import {
  createProviderToolCallIdentity,
  scopeProviderToolCallId,
} from '@/lib/mothership/request/go/tool-call-identity'
import { appendEvents, readEvents } from '@/lib/mothership/request/session/buffer'
import { chatStreamLockKey } from '@/lib/mothership/request/session/controller-lease'
import { createEvent } from '@/lib/mothership/request/session/event'
import { GET as streamGET } from '@/app/api/copilot/chat/stream/route'

const userId = generateId()
const workspaceId = generateId()
const chatIds: string[] = []
const FULL_TEXT = 'part 1 part 2 part 3 part 4 '

/** A live run with a dead controller whose ring kept only seqs 3–4 of its four events. */
async function orphanedRunWithTrimmedRing() {
  const chatId = generateId()
  chatIds.push(chatId)
  const streamId = generateId()
  const runId = generateId()
  const request = {
    message: 'Summarize the logs',
    userId,
    messageId: streamId,
    chatId,
    workspaceId,
  }
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
  const frame = (seq: number, type: string, payload: unknown) => ({
    v: 1,
    type,
    seq,
    ts: new Date().toISOString(),
    stream: { streamId, chatId },
    payload,
  })
  return { chatId, streamId, runId, frame }
}

/** Opens a reconnect, which recovers the run, and waits for the recovered turn to finish. */
async function recoverAndFinish(streamId: string, runId: string) {
  const reconnect = await streamGET(
    new NextRequest(`http://localhost:3000/api/copilot/chat/stream?streamId=${streamId}&after=4`),
    { params: Promise.resolve({}) }
  )
  await reconnect.body?.cancel()
  let status: string | undefined
  for (let attempt = 0; attempt < 150 && status !== 'complete'; attempt++) {
    await sleep(100)
    const [run] = await db
      .select({ status: copilotRuns.status })
      .from(copilotRuns)
      .where(eq(copilotRuns.id, runId))
    status = run?.status
  }
  return status
}

async function assistantMessages(chatId: string) {
  const rows = await db
    .select({ content: copilotMessages.content })
    .from(copilotMessages)
    .where(eq(copilotMessages.chatId, chatId))
  return rows.map((row) => toRecord(row.content)).filter((message) => message.role === 'assistant')
}

/** Runs whether or not the suite does, so a skipped suite never leaks the worker or env. */
afterAll(async () => {
  await new Promise<void>((resolve) => worker.server.close(() => resolve()))
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

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
    for (const chatId of chatIds) {
      await db.delete(copilotMessages).where(eq(copilotMessages.chatId, chatId))
      await db.delete(copilotRuns).where(eq(copilotRuns.chatId, chatId))
      await db.delete(copilotChats).where(eq(copilotChats.id, chatId))
    }
    await db.delete(permissions).where(eq(permissions.userId, userId))
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
    await closeRedisConnection()
  })

  it('recovers from an empty context and persists the whole turn once', async () => {
    const { chatId, streamId, runId, frame } = await orphanedRunWithTrimmedRing()
    worker.requests.length = 0
    worker.replies = {
      '/api/mothership': [
        frame(1, 'session', { kind: 'start' }),
        frame(2, 'text', { channel: 'assistant', text: FULL_TEXT, textOffset: 0 }),
        frame(3, 'complete', { status: 'complete', textLength: FULL_TEXT.length }),
      ],
    }

    expect(await recoverAndFinish(streamId, runId)).toBe('complete')

    const [chat] = await db
      .select({ conversationId: copilotChats.conversationId })
      .from(copilotChats)
      .where(eq(copilotChats.id, chatId))
    expect(chat.conversationId).toBeNull()
    const assistant = await assistantMessages(chatId)
    expect(assistant).toHaveLength(1)
    expect(String(assistant[0].content).trim()).toBe(FULL_TEXT.trim())
    // One re-attach under the original identity and an empty receipt: the worker re-sends
    // the response rather than running, or billing, the turn again.
    expect(worker.requests.map((request) => request.path)).toEqual(['/api/mothership'])
    expect(worker.requests[0].body).toMatchObject({ messageId: streamId, receivedTextChars: 0 })
    expect(await getRedisClient()!.get(chatStreamLockKey(chatId))).toBeNull()
  })

  it('shows replayed tools once and never re-runs a re-handed call the dead controller ran', async () => {
    const { chatId, streamId, runId, frame } = await orphanedRunWithTrimmedRing()
    const simCallId = scopeProviderToolCallId('sim-call', createProviderToolCallIdentity(runId))
    const storedResult = { servers: [] }
    await upsertAsyncToolCall({
      runId,
      toolCallId: simCallId,
      toolName: 'list_workspace_mcp_servers',
      args: {},
    })
    expect(
      await claimSimToolExecution({ toolCallId: simCallId, runId, userId, ownerToken: 'dead' })
    ).toEqual({ outcome: 'claimed' })
    await completeOwnedSimToolCall(
      { toolCallId: simCallId, status: 'completed', result: storedResult },
      'dead'
    )
    const [ran] = await db
      .select({ startedAt: copilotAsyncToolCalls.executionStartedAt })
      .from(copilotAsyncToolCalls)
      .where(eq(copilotAsyncToolCalls.toolCallId, simCallId))
    worker.requests.length = 0
    worker.replies = {
      '/api/mothership': [
        frame(1, 'session', { kind: 'start' }),
        frame(2, 'text', { channel: 'assistant', text: FULL_TEXT, textOffset: 0 }),
        frame(3, 'tool', {
          phase: 'call',
          toolCallId: 'go-call',
          toolName: 'search_online',
          executor: 'go',
          mode: 'sync',
          arguments: { query: 'logs' },
          replay: true,
        }),
        frame(4, 'tool', {
          phase: 'result',
          toolCallId: 'go-call',
          toolName: 'search_online',
          executor: 'go',
          mode: 'sync',
          success: true,
          output: { results: [] },
          replay: true,
        }),
        frame(5, 'tool', {
          phase: 'call',
          toolCallId: 'sim-call',
          toolName: 'list_workspace_mcp_servers',
          executor: 'sim',
          mode: 'async',
          arguments: {},
        }),
        frame(6, 'run', {
          kind: 'checkpoint_pause',
          checkpointId: generateId(),
          executionId: generateId(),
          runId: generateId(),
          pendingToolCallIds: ['sim-call'],
        }),
      ],
      '/api/tools/resume': [
        frame(7, 'text', { channel: 'assistant', text: 'done', textOffset: FULL_TEXT.length }),
        frame(8, 'complete', { status: 'complete', textLength: FULL_TEXT.length + 4 }),
      ],
    }

    expect(await recoverAndFinish(streamId, runId)).toBe('complete')

    const [settled] = await db
      .select({
        startedAt: copilotAsyncToolCalls.executionStartedAt,
        result: copilotAsyncToolCalls.result,
      })
      .from(copilotAsyncToolCalls)
      .where(eq(copilotAsyncToolCalls.toolCallId, simCallId))
    expect(settled.startedAt).toEqual(ran.startedAt)
    expect(settled.result).toEqual(storedResult)
    const resumes = worker.requests.filter((request) => request.path === '/api/tools/resume')
    expect(resumes).toHaveLength(1)
    expect(toArray(resumes[0].body.results)).toEqual([
      expect.objectContaining({ callId: 'sim-call', success: true }),
    ])

    const assistant = await assistantMessages(chatId)
    expect(assistant).toHaveLength(1)
    const toolIds = toArray(assistant[0].contentBlocks)
      .map((block) => toRecord(toRecord(block).toolCall).id)
      .filter((id): id is string => typeof id === 'string')
    expect(toolIds).toHaveLength(2)
    expect(new Set(toolIds).size).toBe(2)
  })

  it('numbers a recovered turn past a ring whose events are all unreadable', async () => {
    const { streamId, runId, frame } = await orphanedRunWithTrimmedRing()
    const redis = getRedisClient()!
    const eventsKey = `mothership_stream:${streamId}:events`
    await redis.del(eventsKey)
    await redis.zadd(eventsKey, 1, 'corrupt-1', 2, 'corrupt-2', 3, 'corrupt-3', 4, 'corrupt-4')
    worker.replies = {
      '/api/mothership': [
        frame(1, 'session', { kind: 'start' }),
        frame(2, 'text', { channel: 'assistant', text: FULL_TEXT, textOffset: 0 }),
        frame(3, 'complete', { status: 'complete', textLength: FULL_TEXT.length }),
      ],
    }

    expect(await recoverAndFinish(streamId, runId)).toBe('complete')

    const recovered = await readEvents(streamId, '0')
    expect(recovered.length).toBeGreaterThan(0)
    expect(Math.min(...recovered.map((event) => event.seq))).toBe(5)
  })
})
