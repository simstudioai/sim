/**
 * Background desktop activity against real PostgreSQL and Redis: which of a user's chats a desktop
 * runs, and whether each is running, waiting on the user's approval, or blocked by an offline desktop.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { redisUrl } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const url = readTestRedisUrl()
  /** The real Redis module and the tool-permission switch read these at import. */
  if (url) process.env.REDIS_URL = url
  process.env.COPILOT_TOOL_PERMISSIONS_ENABLED = 'true'
  return { redisUrl: url }
})

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  copilotAsyncToolCalls,
  copilotChats,
  desktopDevices,
  session,
  user,
  workspace,
} from '@sim/db/schema'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { generateId } from '@sim/utils/id'
import { inArray } from 'drizzle-orm'
import { closeRedisConnection } from '@/lib/core/config/redis'
import { listDesktopActivity } from '@/lib/desktop/application/activity'
import { openDesktopInboxStream, registerDesktopDevice } from '@/lib/desktop/application/executor'
import { isDesktopPresent } from '@/lib/desktop/executor/presence'
import { createRunSegment } from '@/lib/mothership/async-runs/repository'

afterAll(async () => {
  await closeRedisConnection()
})

describe.runIf(Boolean(redisUrl))('background desktop activity', () => {
  const userIds: string[] = []
  const workspaceIds: string[] = []
  const deviceIds: string[] = []

  beforeEach(() => {
    featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(true)
  })

  afterAll(async () => {
    if (workspaceIds.length) await db.delete(workspace).where(inArray(workspace.id, workspaceIds))
    if (deviceIds.length)
      await db.delete(desktopDevices).where(inArray(desktopDevices.id, deviceIds))
    if (userIds.length) await db.delete(user).where(inArray(user.id, userIds))
  })

  async function signedInDesktop() {
    const userId = generateId()
    const workspaceId = generateId()
    const sessionId = generateId()
    const deviceId = generateId()
    const now = new Date()
    userIds.push(userId)
    workspaceIds.push(workspaceId)
    deviceIds.push(deviceId)
    await db.insert(user).values({
      id: userId,
      name: 'Desktop activity fixture',
      email: `${userId}@desktop-activity.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Desktop activity fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(session).values({
      id: sessionId,
      userId,
      token: generateId(),
      expiresAt: new Date(now.getTime() + 3_600_000),
      createdAt: now,
      updatedAt: now,
    })
    const principal: SessionPrincipal = { kind: 'session', userId, sessionId }
    await registerDesktopDevice.execute({
      principal,
      input: {
        deviceId,
        name: 'Studio Mac',
        appVersion: '0.9.0',
        platform: 'darwin-arm64',
        capabilities: { executor: 1, browser: true, terminal: true, localFiles: true },
      },
    })
    return { userId, workspaceId, principal, deviceId }
  }

  async function chatWithRun(
    owner: { userId: string; workspaceId: string },
    deviceId: string | null,
    status: 'active' | 'complete' = 'active'
  ) {
    const chatId = generateId()
    await db.insert(copilotChats).values({
      id: chatId,
      userId: owner.userId,
      workspaceId: owner.workspaceId,
      type: 'mothership',
    })
    const run = await createRunSegment({
      executionId: generateId(),
      chatId,
      userId: owner.userId,
      workspaceId: owner.workspaceId,
      streamId: generateId(),
      status,
      desktopDeviceId: deviceId,
    })
    return { chatId, runId: run.id }
  }

  it('reports running, needs input and blocked for the chats a desktop runs', async () => {
    const desktop = await signedInDesktop()
    const running = await chatWithRun(desktop, desktop.deviceId)
    const waiting = await chatWithRun(desktop, desktop.deviceId)
    await db.insert(copilotAsyncToolCalls).values({
      runId: waiting.runId,
      toolCallId: generateId(),
      toolName: 'terminal',
      args: { operation: 'run', args: { command: 'npm publish' } },
      permissionRequestedAt: new Date(),
    })
    // An allowed command waits for nobody: the desktop simply runs it.
    await db.insert(copilotAsyncToolCalls).values({
      runId: running.runId,
      toolCallId: generateId(),
      toolName: 'terminal',
      args: { operation: 'run', args: { command: 'npm test' } },
    })
    await chatWithRun(desktop, null)
    await chatWithRun(desktop, desktop.deviceId, 'complete')

    expect(
      (
        await listDesktopActivity.execute({
          principal: desktop.principal,
          input: { workspaceId: desktop.workspaceId },
        })
      ).chats
    ).toEqual(
      expect.arrayContaining([
        { chatId: running.chatId, state: 'blocked', deviceName: 'Studio Mac' },
        { chatId: waiting.chatId, state: 'needs_input', deviceName: 'Studio Mac' },
      ])
    )

    const stream = await openDesktopInboxStream.execute({
      principal: desktop.principal,
      input: { deviceId: desktop.deviceId },
    })
    const close = stream.subscribe(() => {})
    try {
      await expect.poll(() => isDesktopPresent(desktop.deviceId)).toBe(true)
      const { chats } = await listDesktopActivity.execute({
        principal: desktop.principal,
        input: { workspaceId: desktop.workspaceId },
      })
      expect(chats).toHaveLength(2)
      expect(chats).toEqual(
        expect.arrayContaining([
          { chatId: running.chatId, state: 'running', deviceName: 'Studio Mac' },
          { chatId: waiting.chatId, state: 'needs_input', deviceName: 'Studio Mac' },
        ])
      )
    } finally {
      close()
    }
  })

  it('reports a chat whose running call handed control to the user as needing input', async () => {
    const desktop = await signedInDesktop()
    const handoff = await chatWithRun(desktop, desktop.deviceId)
    const takeover = await chatWithRun(desktop, desktop.deviceId)
    const decided = await chatWithRun(desktop, desktop.deviceId)
    await db.insert(copilotAsyncToolCalls).values([
      {
        runId: handoff.runId,
        toolCallId: generateId(),
        toolName: 'terminal',
        args: { operation: 'handoff', args: { reason: 'Enter your password' } },
        status: 'running',
      },
      {
        runId: takeover.runId,
        toolCallId: generateId(),
        toolName: 'browser_request_takeover',
        args: { reason: 'Solve the captcha' },
        status: 'running',
      },
      {
        runId: decided.runId,
        toolCallId: generateId(),
        toolName: 'terminal',
        args: { operation: 'run', args: { command: 'npm publish' } },
        permissionRequestedAt: new Date(),
        permissionDecision: 'skip',
        status: 'pending',
      },
    ])

    const { chats } = await listDesktopActivity.execute({
      principal: desktop.principal,
      input: { workspaceId: desktop.workspaceId },
    })
    const stateOf = (chatId: string) => chats.find((chat) => chat.chatId === chatId)?.state
    expect(stateOf(handoff.chatId)).toBe('needs_input')
    expect(stateOf(takeover.chatId)).toBe('needs_input')
    expect(stateOf(decided.chatId)).toBe('blocked')
  })

  it("never reports another user's chats, or chats in another workspace", async () => {
    const desktop = await signedInDesktop()
    const other = await signedInDesktop()
    await chatWithRun(other, other.deviceId)
    const elsewhere = await signedInDesktop()
    await chatWithRun(
      { userId: desktop.userId, workspaceId: elsewhere.workspaceId },
      desktop.deviceId
    )

    const { chats } = await listDesktopActivity.execute({
      principal: desktop.principal,
      input: { workspaceId: desktop.workspaceId },
    })
    expect(chats).toEqual([])
    const { chats: otherWorkspace } = await listDesktopActivity.execute({
      principal: other.principal,
      input: { workspaceId: elsewhere.workspaceId },
    })
    expect(otherWorkspace).toEqual([])
  })
})
