/**
 * The run-loop half of the desktop background executor against real PostgreSQL and Redis:
 * binding a turn to its desktop, offering each call and ringing the device, and failing a call
 * fast when nobody can pick it up or honestly when a claimed call's lease lapses.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { redisUrl } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const url = readTestRedisUrl()
  /** The real Redis module reads this at import. */
  if (url) process.env.REDIS_URL = url
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
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { closeRedisConnection } from '@/lib/core/config/redis'
import {
  claimDesktopTool,
  completeDesktopTool,
  listDesktopInbox,
  openDesktopInboxStream,
  registerDesktopDevice,
  renewDesktopToolLease,
  resolveTurnDesktopDevice,
} from '@/lib/desktop/application/executor'
import { failLapsedDesktopCall } from '@/lib/desktop/executor/repository'
import {
  DESKTOP_LEASE_LOST_MESSAGE,
  DESKTOP_NOT_RESPONDING_MESSAGE,
  DESKTOP_OFFLINE_MESSAGE,
  superviseDesktopCall,
} from '@/lib/desktop/executor/supervisor'
import {
  createRunSegment,
  revokeExpiredSimToolExecutions,
} from '@/lib/mothership/async-runs/repository'
import { waitForToolConfirmation } from '@/lib/mothership/persistence/tool-confirm'
import { unsealClientToolCompletion } from '@/lib/mothership/request/tools/client-completion-seal.server'

const CAPABILITIES = { executor: 1, browser: true, terminal: true, localFiles: true }

afterAll(async () => {
  await closeRedisConnection()
})

describe.runIf(Boolean(redisUrl))('desktop call supervision and turn binding', () => {
  const userIds: string[] = []
  const workspaceIds = new Map<string, string>()
  const deviceIds: string[] = []
  const excluded = new Set<string>()

  beforeEach(() => {
    featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
      async (flag, context) =>
        flag === 'mothership-desktop-background-executor' &&
        typeof context === 'object' &&
        context !== null &&
        'userId' in context &&
        typeof context.userId === 'string' &&
        !excluded.has(context.userId)
    )
  })

  afterAll(async () => {
    const workspaces = [...workspaceIds.values()]
    if (workspaces.length) await db.delete(workspace).where(inArray(workspace.id, workspaces))
    if (deviceIds.length)
      await db.delete(desktopDevices).where(inArray(desktopDevices.id, deviceIds))
    if (userIds.length) await db.delete(user).where(inArray(user.id, userIds))
  })

  async function signedInDesktop(options: { sameUserAs?: string } = {}) {
    const userId = options.sameUserAs ?? generateId()
    const now = new Date()
    if (!options.sameUserAs) {
      userIds.push(userId)
      await db.insert(user).values({
        id: userId,
        name: 'Desktop supervisor fixture',
        email: `${userId}@desktop-supervisor.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      const workspaceId = generateId()
      workspaceIds.set(userId, workspaceId)
      await db.insert(workspace).values({
        id: workspaceId,
        name: 'Desktop supervisor fixture',
        ownerId: userId,
        billedAccountUserId: userId,
      })
    }
    const sessionId = generateId()
    await db.insert(session).values({
      id: sessionId,
      userId,
      token: generateId(),
      expiresAt: new Date(now.getTime() + 3_600_000),
      createdAt: now,
      updatedAt: now,
    })
    const principal: SessionPrincipal = { kind: 'session', userId, sessionId }
    const deviceId = generateId()
    deviceIds.push(deviceId)
    await registerDesktopDevice.execute({
      principal,
      input: {
        deviceId,
        name: 'Fixture Mac',
        appVersion: '0.9.0',
        platform: 'darwin-arm64',
        capabilities: CAPABILITIES,
      },
    })
    return { userId, sessionId, principal, deviceId }
  }

  /** A turn admitted with its run bound to `deviceId`, through the run-segment writer. */
  async function boundRun(userId: string, deviceId: string | null) {
    const workspaceId = workspaceIds.get(userId)
    const chatId = generateId()
    await db.insert(copilotChats).values({ id: chatId, userId, workspaceId, type: 'mothership' })
    const run = await createRunSegment({
      executionId: generateId(),
      chatId,
      userId,
      workspaceId,
      streamId: generateId(),
      status: 'paused_waiting_for_tool',
      desktopDeviceId: deviceId,
    })
    return { runId: run.id, chatId, desktopDeviceId: run.desktopDeviceId }
  }

  async function pendingCall(runId: string, toolName = 'browser_click') {
    const toolCallId = generateId()
    await db
      .insert(copilotAsyncToolCalls)
      .values({ runId, toolCallId, toolName, args: { ref: 'e1' } })
    return toolCallId
  }

  async function row(toolCallId: string) {
    const [stored] = await db
      .select()
      .from(copilotAsyncToolCalls)
      .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
    return stored
  }

  async function unsealed(toolCallId: string, runId: string, userId: string) {
    return unsealClientToolCompletion((await row(toolCallId)).result, {
      toolCallId,
      runId,
      userId,
    })
  }

  /** Keeps the device online for the duration of `run`, as its open doorbell stream does. */
  async function online<T>(
    desktop: Awaited<ReturnType<typeof signedInDesktop>>,
    run: (heard: string[]) => Promise<T>
  ): Promise<T> {
    const stream = await openDesktopInboxStream.execute({
      principal: desktop.principal,
      input: { deviceId: desktop.deviceId },
    })
    const heard: string[] = []
    const close = stream.subscribe((_event, data) => heard.push(String(data.reason)))
    try {
      return await run(heard)
    } finally {
      close()
    }
  }

  describe('binding a turn', () => {
    it("binds a turn to the composer's own desktop on this session", async () => {
      const desktop = await signedInDesktop()
      await expect(resolveTurnDesktopDevice(desktop.principal, desktop.deviceId)).resolves.toBe(
        desktop.deviceId
      )
      const run = await boundRun(desktop.userId, desktop.deviceId)
      expect(run.desktopDeviceId).toBe(desktop.deviceId)
    })

    it("refuses another user's desktop, another session, a revoked desktop, and a non-executor", async () => {
      const desktop = await signedInDesktop()
      const otherUser = await signedInDesktop()
      const sameUserOtherSession = await signedInDesktop({ sameUserAs: desktop.userId })
      const noExecutor = await signedInDesktop({ sameUserAs: desktop.userId })
      await db
        .update(desktopDevices)
        .set({ capabilities: { ...CAPABILITIES, executor: 0 } })
        .where(eq(desktopDevices.id, noExecutor.deviceId))

      await expect(
        resolveTurnDesktopDevice(otherUser.principal, desktop.deviceId)
      ).resolves.toBeNull()
      await expect(
        resolveTurnDesktopDevice(sameUserOtherSession.principal, desktop.deviceId)
      ).resolves.toBeNull()
      await expect(
        resolveTurnDesktopDevice(noExecutor.principal, noExecutor.deviceId)
      ).resolves.toBeNull()
      await db
        .update(desktopDevices)
        .set({ revokedAt: new Date() })
        .where(eq(desktopDevices.id, desktop.deviceId))
      await expect(
        resolveTurnDesktopDevice(desktop.principal, desktop.deviceId)
      ).resolves.toBeNull()
    })

    it('leaves turns unbound for a user outside the rollout', async () => {
      const desktop = await signedInDesktop()
      excluded.add(desktop.userId)
      await expect(
        resolveTurnDesktopDevice(desktop.principal, desktop.deviceId)
      ).resolves.toBeNull()
    })
  })

  describe('supervising a call', () => {
    it('fails a call as not started at once when its desktop is offline', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop.userId, desktop.deviceId)
      const toolCallId = await pendingCall(run.runId)
      const woken = waitForToolConfirmation(toolCallId, 2_000, undefined, {
        acceptStatus: (status) => status === 'error',
      })

      const started = Date.now()
      await expect(
        superviseDesktopCall({
          toolCallId,
          runId: run.runId,
          userId: desktop.userId,
          deviceId: desktop.deviceId,
        })
      ).resolves.toBe('offline')
      expect(Date.now() - started).toBeLessThan(1_000)
      expect((await woken)?.status).toBe('error')
      expect((await row(toolCallId)).status).toBe('failed')
      await expect(unsealed(toolCallId, run.runId, desktop.userId)).resolves.toMatchObject({
        message: DESKTOP_OFFLINE_MESSAGE,
        data: { notStarted: true, reason: 'offline' },
      })
      await expect(
        claimDesktopTool.execute({
          principal: desktop.principal,
          input: { deviceId: desktop.deviceId, toolCallId },
        })
      ).rejects.toThrow('no longer waiting')
    })

    it('rings an online desktop and fails the call as not started when nobody claims it in time', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop.userId, desktop.deviceId)
      const toolCallId = await pendingCall(run.runId)

      await online(desktop, async (heard) => {
        await expect(
          superviseDesktopCall({
            toolCallId,
            runId: run.runId,
            userId: desktop.userId,
            deviceId: desktop.deviceId,
            pickupGraceMs: 400,
          })
        ).resolves.toBe('not_responding')
        expect(heard).toContain('call')
      })
      await expect(unsealed(toolCallId, run.runId, desktop.userId)).resolves.toMatchObject({
        message: DESKTOP_NOT_RESPONDING_MESSAGE,
        data: { notStarted: true, reason: 'not_responding' },
      })
    })

    it("delivers the device's own result when it claims and completes in time", async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop.userId, desktop.deviceId)
      const toolCallId = await pendingCall(run.runId)

      await online(desktop, async () => {
        const supervision = superviseDesktopCall({
          toolCallId,
          runId: run.runId,
          userId: desktop.userId,
          deviceId: desktop.deviceId,
          pickupGraceMs: 2_000,
        })
        await expect
          .poll(async () => (await row(toolCallId)).executionLeaseExpiresAt)
          .not.toBeNull()
        const { executionToken } = await claimDesktopTool.execute({
          principal: desktop.principal,
          input: { deviceId: desktop.deviceId, toolCallId },
        })
        await completeDesktopTool.execute({
          principal: desktop.principal,
          input: {
            deviceId: desktop.deviceId,
            toolCallId,
            executionToken,
            status: 'success',
            message: 'Clicked',
          },
        })
        await expect(supervision).resolves.toBe('settled')
      })
      expect((await row(toolCallId)).status).toBe('completed')
      await expect(unsealed(toolCallId, run.runId, desktop.userId)).resolves.toMatchObject({
        message: 'Clicked',
      })
    })

    it('keeps a running call alive while its lease is renewed', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop.userId, desktop.deviceId)
      const toolCallId = await pendingCall(run.runId, 'terminal')

      await online(desktop, async () => {
        const supervision = superviseDesktopCall({
          toolCallId,
          runId: run.runId,
          userId: desktop.userId,
          deviceId: desktop.deviceId,
          pickupGraceMs: 2_000,
        })
        await expect
          .poll(async () => (await row(toolCallId)).executionLeaseExpiresAt)
          .not.toBeNull()
        const { executionToken } = await claimDesktopTool.execute({
          principal: desktop.principal,
          input: { deviceId: desktop.deviceId, toolCallId },
        })
        const lease = { deviceId: desktop.deviceId, toolCallId, executionToken }
        await db
          .update(copilotAsyncToolCalls)
          .set({ executionLeaseExpiresAt: sql`clock_timestamp() + interval '600 milliseconds'` })
          .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
        await renewDesktopToolLease.execute({ principal: desktop.principal, input: lease })
        /** A settlement that read the old deadline must lose to the renewal. */
        await expect(
          failLapsedDesktopCall({
            toolCallId,
            runId: run.runId,
            ownerToken: executionToken,
            result: {},
            error: 'stale',
          })
        ).resolves.toBe(false)
        await sleep(1_000)
        expect((await row(toolCallId)).status).toBe('running')
        await completeDesktopTool.execute({
          principal: desktop.principal,
          input: { ...lease, status: 'success' },
        })
        await expect(supervision).resolves.toBe('settled')
      })
    })

    it('fails a claimed call as outcome unknown when its lease lapses, and supersedes its late result', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop.userId, desktop.deviceId)
      const toolCallId = await pendingCall(run.runId)

      const executionToken = await online(desktop, async () => {
        const supervision = superviseDesktopCall({
          toolCallId,
          runId: run.runId,
          userId: desktop.userId,
          deviceId: desktop.deviceId,
          pickupGraceMs: 2_000,
        })
        await expect
          .poll(async () => (await row(toolCallId)).executionLeaseExpiresAt)
          .not.toBeNull()
        const claim = await claimDesktopTool.execute({
          principal: desktop.principal,
          input: { deviceId: desktop.deviceId, toolCallId },
        })
        /** The desktop went to sleep: nothing renews the lease any more. */
        await db
          .update(copilotAsyncToolCalls)
          .set({ executionLeaseExpiresAt: sql`clock_timestamp() + interval '300 milliseconds'` })
          .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
        await expect(supervision).resolves.toBe('lease_lost')
        return claim.executionToken
      })

      await expect(unsealed(toolCallId, run.runId, desktop.userId)).resolves.toMatchObject({
        message: DESKTOP_LEASE_LOST_MESSAGE,
        data: { outcomeUnknown: true, doNotRetry: true, reason: 'lease_lost' },
      })
      const inbox = await listDesktopInbox.execute({
        principal: desktop.principal,
        input: { deviceId: desktop.deviceId },
      })
      expect(inbox.items).toEqual([{ kind: 'cancel', toolCallId }])
      await expect(
        completeDesktopTool.execute({
          principal: desktop.principal,
          input: { deviceId: desktop.deviceId, toolCallId, executionToken, status: 'success' },
        })
      ).resolves.toEqual({ outcome: 'superseded', status: 'failed' })
    })

    it('leaves a lapsed desktop lease to its supervisor rather than the Sim tool sweep', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop.userId, desktop.deviceId)
      const toolCallId = await pendingCall(run.runId)
      await db
        .update(copilotAsyncToolCalls)
        .set({ executionLeaseExpiresAt: sql`clock_timestamp() + interval '10 seconds'` })
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
      await claimDesktopTool.execute({
        principal: desktop.principal,
        input: { deviceId: desktop.deviceId, toolCallId },
      })
      await db
        .update(copilotAsyncToolCalls)
        .set({ executionLeaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))

      await revokeExpiredSimToolExecutions({ runId: run.runId, userId: desktop.userId })
      expect((await row(toolCallId)).status).toBe('running')
    })

    it('never offers a call on a run the chat view serves', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop.userId, null)
      const toolCallId = await pendingCall(run.runId)
      await expect(
        superviseDesktopCall({
          toolCallId,
          runId: run.runId,
          userId: desktop.userId,
          deviceId: desktop.deviceId,
        })
      ).resolves.toBe('not_offered')
      expect((await row(toolCallId)).status).toBe('pending')
    })
  })
})
