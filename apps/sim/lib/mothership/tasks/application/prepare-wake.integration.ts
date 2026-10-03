/**
 * How sim answers the worker's retry of a task wake, against real PostgreSQL and Redis: the
 * wake route, the chat stream lock, and the run records are production code. Only `after` is
 * stubbed, so the background wake turn never starts; each test writes the run record that
 * turn would have written instead. The run lookup passes through to PostgreSQL unless a test
 * makes it fail.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedRedisUrl } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const url = readTestRedisUrl()
  const inheritedRedisUrl = process.env.REDIS_URL
  /** The real Redis module reads this at import. */
  if (url) process.env.REDIS_URL = url
  return { redisUrl: url, inheritedRedisUrl }
})

vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: () => {},
}))

vi.mock('@/lib/mothership/async-runs/repository', async (original) => {
  const actual = await original<typeof import('@/lib/mothership/async-runs/repository')>()
  return { ...actual, getLatestRunForStream: vi.fn(actual.getLatestRunForStream) }
})

import { db } from '@sim/db'
import { copilotChats, copilotRuns, permissions, user, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import {
  createRunSegment,
  getLatestRunForStream,
  updateRunStatus,
} from '@/lib/mothership/async-runs/repository'
import { chatPubSub } from '@/lib/mothership/chat-status'
import {
  acquirePendingChatStream,
  getLocalChatStreamLease,
  releasePendingChatStream,
} from '@/lib/mothership/request/session/abort'
import { POST as wakeRoute } from '@/app/api/mothership/wake/route'

afterAll(async () => {
  chatPubSub?.dispose()
  await closeRedisConnection()
  if (inheritedRedisUrl === undefined) Reflect.deleteProperty(process.env, 'REDIS_URL')
  else process.env.REDIS_URL = inheritedRedisUrl
})

describe.runIf(Boolean(redisUrl))('task wake retries', () => {
  const userId = generateId()
  const workspaceId = generateId()
  const chatIds: string[] = []

  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Task wake fixture',
      email: `${userId}@task-wake.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Task wake fixture',
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
    if (chatIds.length) {
      await db.delete(copilotRuns).where(inArray(copilotRuns.chatId, chatIds))
      await db.delete(copilotChats).where(inArray(copilotChats.id, chatIds))
    }
    await db.delete(permissions).where(eq(permissions.userId, userId))
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
  })

  async function idleChat() {
    const chatId = generateId()
    chatIds.push(chatId)
    await db.insert(copilotChats).values({ id: chatId, userId, workspaceId, type: 'mothership' })
    return chatId
  }

  /** The worker's wake call, as `wakeOnSim` sends it. */
  function wake(chatId: string, runId: string) {
    return wakeRoute(
      new NextRequest('http://localhost:3000/api/mothership/wake', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.INTERNAL_API_SECRET ?? '',
          'x-mothership-user-id': userId,
          'x-mothership-workspace-id': workspaceId,
        },
        body: JSON.stringify({
          taskId: generateId(),
          runId,
          chatId,
          userId,
          workspaceId,
          message: 'Timer elapsed',
          status: 'completed',
          summary: 'Timer elapsed',
        }),
      }),
      { params: Promise.resolve({}) }
    )
  }

  /** The run record the headless wake turn opens under the wake's run ID. */
  function openWakeTurn(chatId: string, runId: string) {
    return createRunSegment({
      executionId: generateId(),
      chatId,
      userId,
      workspaceId,
      streamId: runId,
      requestContext: { source: 'headless_lifecycle' },
    })
  }

  it('answers not-found to a wake whose turn already ended, and leaves the chat free', async () => {
    const chatId = await idleChat()
    const runId = generateId()
    expect((await wake(chatId, runId)).status).toBe(202)
    /** The turn ends inside sim without reaching the worker, as a usage-limit refusal does. */
    const turn = await openWakeTurn(chatId, runId)
    await updateRunStatus(turn.id, 'complete', { completedAt: new Date() })
    await releasePendingChatStream(chatId, runId)

    /** The worker saw no run under this ID, so it retries the same wake. */
    expect((await wake(chatId, runId)).status).toBe(404)

    const nextTurn = generateId()
    expect(await acquirePendingChatStream(chatId, nextTurn, 0)).toBe(true)
    await releasePendingChatStream(chatId, nextTurn)
  })

  it('answers busy, never not-found, while the wake turn under that ID still holds the chat', async () => {
    const chatId = await idleChat()
    const runId = generateId()
    expect((await wake(chatId, runId)).status).toBe(202)
    await openWakeTurn(chatId, runId)

    expect((await wake(chatId, runId)).status).toBe(409)
    await releasePendingChatStream(chatId, runId)
  }, 15_000)

  it('frees the chat when the run lookup fails after the wake took it', async () => {
    const chatId = await idleChat()
    const runId = generateId()
    vi.mocked(getLatestRunForStream).mockRejectedValueOnce(new Error('statement timeout'))

    expect((await wake(chatId, runId)).status).toBe(500)

    const nextTurn = generateId()
    expect(await acquirePendingChatStream(chatId, nextTurn, 0)).toBe(true)
    await releasePendingChatStream(chatId, nextTurn)
  })

  it("keeps a retry's chat lock when an earlier wake's slow lookup fails after its own lock expired", async () => {
    const chatId = await idleChat()
    const runId = generateId()
    let lookupStarted!: () => void
    const started = new Promise<void>((resolve) => {
      lookupStarted = resolve
    })
    let failLookup!: () => void
    const failed = new Promise<void>((resolve) => {
      failLookup = resolve
    })
    vi.mocked(getLatestRunForStream).mockImplementationOnce(async () => {
      lookupStarted()
      await failed
      throw new Error('statement timeout')
    })

    const slowWake = wake(chatId, runId)
    await started
    /** The first wake's lock outlives its TTL while the lookup hangs. */
    const firstLease = getLocalChatStreamLease(chatId, runId)
    await getRedisClient()?.del(firstLease?.key ?? '')
    expect((await wake(chatId, runId)).status).toBe(202)

    failLookup()
    expect((await slowWake).status).toBe(500)

    const nextTurn = generateId()
    expect(await acquirePendingChatStream(chatId, nextTurn, 0)).toBe(false)
    await releasePendingChatStream(chatId, runId)
  }, 15_000)
})
