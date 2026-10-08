/**
 * A chat view learns from the stream it reads whether the desktop app's background executor runs
 * the turn's desktop tools, so it only shows those calls. Exercised against real PostgreSQL and
 * Redis through the production reconnect route, for the live tail and the replay batch a view
 * attaches with after a reload.
 */
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { redisUrl } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const url = readTestRedisUrl()
  if (url) process.env.REDIS_URL = url
  return { redisUrl: url }
})

vi.mock('@/lib/auth', () => authMock)

import { db } from '@sim/db'
import {
  copilotChats,
  copilotRuns,
  desktopDevices,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { closeRedisConnection } from '@/lib/core/config/redis'
import { MOTHERSHIP_DESKTOP_EXECUTOR_HEADER } from '@/lib/mothership/constants'
import { GET as streamGET } from '@/app/api/copilot/chat/stream/route'

const userId = generateId()
const workspaceId = generateId()
const chatId = generateId()
const deviceId = generateId()

async function finishedRun(desktopDeviceId: string | null): Promise<string> {
  const streamId = generateId()
  await db.insert(copilotRuns).values({
    id: generateId(),
    executionId: generateId(),
    chatId,
    userId,
    workspaceId,
    streamId,
    status: 'complete',
    desktopDeviceId,
  })
  return streamId
}

function reconnect(streamId: string, batch: boolean) {
  return streamGET(
    new NextRequest(
      `http://localhost:3000/api/copilot/chat/stream?streamId=${streamId}&after=0${batch ? '&batch=true' : ''}`
    ),
    { params: Promise.resolve({}) }
  )
}

describe.runIf(Boolean(redisUrl))('desktop executor binding on a chat stream', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Desktop stream fixture',
      email: `${userId}@desktop-stream.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Desktop stream fixture',
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
    await db.insert(desktopDevices).values({
      id: deviceId,
      userId,
      name: 'Studio Mac',
      appVersion: '0.9.0',
      platform: 'darwin-arm64',
      capabilities: { executor: 1, browser: true, terminal: true, localFiles: true },
    })
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: userId },
      session: { id: generateId() },
    })
  })

  afterAll(async () => {
    await db.delete(copilotRuns).where(eq(copilotRuns.chatId, chatId))
    await db.delete(copilotChats).where(eq(copilotChats.id, chatId))
    await db.delete(desktopDevices).where(eq(desktopDevices.id, deviceId))
    await db.delete(permissions).where(eq(permissions.userId, userId))
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
    await closeRedisConnection()
  })

  it('marks the live tail and the replay batch of a turn a desktop runs', async () => {
    const streamId = await finishedRun(deviceId)

    const tail = await reconnect(streamId, false)
    await tail.text()
    const batch = await (await reconnect(streamId, true)).json()

    expect(tail.headers.get(MOTHERSHIP_DESKTOP_EXECUTOR_HEADER)).toBe('device')
    expect(batch.desktopToolsOnDevice).toBe(true)
  })

  it('leaves a turn the chat view runs unmarked', async () => {
    const streamId = await finishedRun(null)

    const tail = await reconnect(streamId, false)
    await tail.text()
    const batch = await (await reconnect(streamId, true)).json()

    expect(tail.headers.get(MOTHERSHIP_DESKTOP_EXECUTOR_HEADER)).toBeNull()
    expect(batch.desktopToolsOnDevice).toBeUndefined()
  })
})
