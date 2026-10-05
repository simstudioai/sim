/**
 * The desktop background executor's device-facing protocol against real PostgreSQL and Redis:
 * registration, the inbox and its doorbell, leased claims, renewal, and idempotent completion.
 * Calls are offered the way Sim's run loop offers them, by giving a pending row its pickup
 * deadline.
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
  copilotRuns,
  desktopDevices,
  session,
  user,
  workspace,
} from '@sim/db/schema'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
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
} from '@/lib/desktop/application/executor'
import { DESKTOP_CALL_PICKUP_GRACE_MS } from '@/lib/desktop/executor/constants'
import { ringDesktopInbox } from '@/lib/desktop/executor/doorbell'
import {
  DesktopCallRevokedError,
  DesktopDeviceUnrecognizedError,
} from '@/lib/desktop/executor/errors'
import { isDesktopPresent } from '@/lib/desktop/executor/presence'
import { requestRunStop } from '@/lib/mothership/async-runs/repository'
import { waitForToolConfirmation } from '@/lib/mothership/persistence/tool-confirm'
import { unsealClientToolCompletion } from '@/lib/mothership/request/tools/client-completion-seal.server'

const CAPABILITIES = { executor: 1, browser: true, terminal: true, localFiles: true }

afterAll(async () => {
  await closeRedisConnection()
})

describe.runIf(Boolean(redisUrl))('desktop background executor protocol', () => {
  const userIds: string[] = []
  const workspaceIds = new Map<string, string>()
  const chatIds: string[] = []
  const deviceIds: string[] = []

  /**
   * A signed-in desktop: its user (created unless `sameUserAs` names one), its Better Auth
   * session, and its install id, registered the way the app registers after sign-in.
   */
  async function signedInDesktop(sameUserAs?: string, newUserId?: string) {
    const userId = sameUserAs ?? newUserId ?? generateId()
    const now = new Date()
    if (!sameUserAs) {
      userIds.push(userId)
      await db.insert(user).values({
        id: userId,
        name: 'Desktop executor fixture',
        email: `${userId}@desktop-executor.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      const workspaceId = generateId()
      workspaceIds.set(userId, workspaceId)
      await db.insert(workspace).values({
        id: workspaceId,
        name: 'Desktop executor fixture',
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
      userAgent: 'Sim Desktop',
    })
    const principal: SessionPrincipal = { kind: 'session', userId, sessionId }
    const deviceId = generateId()
    deviceIds.push(deviceId)
    const registration = await registerDesktopDevice.execute({
      principal,
      input: {
        deviceId,
        name: 'Fixture Mac',
        appVersion: '0.9.0',
        platform: 'darwin-arm64',
        capabilities: CAPABILITIES,
      },
    })
    return {
      userId,
      sessionId,
      principal,
      deviceId,
      enabled: registration.enabled,
      workspaceId: workspaceIds.get(userId),
    }
  }

  /** A run bound to the device at admission, with an open turn. */
  async function boundRun(owner: { userId: string; deviceId: string | null }) {
    const workspaceId = workspaceIds.get(owner.userId)
    const chatId = generateId()
    const runId = generateId()
    const streamId = generateId()
    chatIds.push(chatId)
    await db.insert(copilotChats).values({
      id: chatId,
      userId: owner.userId,
      workspaceId,
      type: 'mothership',
      title: 'Fix CI',
      conversationId: streamId,
    })
    await db.insert(copilotRuns).values({
      id: runId,
      executionId: generateId(),
      chatId,
      userId: owner.userId,
      workspaceId,
      streamId,
      toolExecutionVersion: 2,
      status: 'paused_waiting_for_tool',
      desktopDeviceId: owner.deviceId,
    })
    return { chatId, runId, streamId, workspaceId }
  }

  /** A desktop call the run persisted before forwarding its frame; pending until offered. */
  async function pendingCall(
    runId: string,
    toolName = 'browser_click',
    args: Record<string, unknown> = { ref: 'e1' }
  ) {
    const toolCallId = generateId()
    await db.insert(copilotAsyncToolCalls).values({ runId, toolCallId, toolName, args })
    return toolCallId
  }

  /** What the run loop does once a call may run: open its pickup window. */
  async function offer(toolCallId: string) {
    await db
      .update(copilotAsyncToolCalls)
      .set({
        executionLeaseExpiresAt: sql`clock_timestamp() + ${DESKTOP_CALL_PICKUP_GRACE_MS} * interval '1 millisecond'`,
      })
      .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
  }

  async function row(toolCallId: string) {
    const [stored] = await db
      .select()
      .from(copilotAsyncToolCalls)
      .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
    return stored
  }

  async function claim(principal: SessionPrincipal, deviceId: string, toolCallId: string) {
    return claimDesktopTool.execute({ principal, input: { deviceId, toolCallId } })
  }

  /** The flag targets users; `excluded` is outside its rollout. */
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
    if (chatIds.length) await db.delete(copilotChats).where(inArray(copilotChats.id, chatIds))
    if (deviceIds.length)
      await db.delete(desktopDevices).where(inArray(desktopDevices.id, deviceIds))
    const workspaces = [...workspaceIds.values()]
    if (workspaces.length) await db.delete(workspace).where(inArray(workspace.id, workspaces))
    if (userIds.length) await db.delete(user).where(inArray(user.id, userIds))
  })

  describe('registration', () => {
    it('writes nothing and reports the executor off for a user outside the rollout', async () => {
      const userId = generateId()
      excluded.add(userId)
      const desktop = await signedInDesktop(undefined, userId)
      expect(desktop.enabled).toBe(false)
      const [stored] = await db
        .select()
        .from(desktopDevices)
        .where(eq(desktopDevices.id, desktop.deviceId))
      expect(stored).toBeUndefined()
      await expect(
        listDesktopInbox.execute({
          principal: desktop.principal,
          input: { deviceId: desktop.deviceId },
        })
      ).rejects.toBeInstanceOf(DesktopDeviceUnrecognizedError)
    })

    it('refuses an install id that belongs to another account', async () => {
      const owner = await signedInDesktop()
      const intruder = await signedInDesktop()
      await expect(
        registerDesktopDevice.execute({
          principal: intruder.principal,
          input: {
            deviceId: owner.deviceId,
            name: 'Other Mac',
            appVersion: '0.9.0',
            platform: 'darwin-arm64',
            capabilities: CAPABILITIES,
          },
        })
      ).rejects.toThrow('belongs to another account')
      const [stored] = await db
        .select({ userId: desktopDevices.userId, sessionId: desktopDevices.sessionId })
        .from(desktopDevices)
        .where(eq(desktopDevices.id, owner.deviceId))
      expect(stored).toEqual({ userId: owner.userId, sessionId: owner.sessionId })
    })

    it('rebinds the device to its newest session and locks out the older one', async () => {
      const desktop = await signedInDesktop()
      const sessionId = generateId()
      const now = new Date()
      await db.insert(session).values({
        id: sessionId,
        userId: desktop.userId,
        token: generateId(),
        expiresAt: new Date(now.getTime() + 3_600_000),
        createdAt: now,
        updatedAt: now,
      })
      const newer: SessionPrincipal = { kind: 'session', userId: desktop.userId, sessionId }
      await registerDesktopDevice.execute({
        principal: newer,
        input: {
          deviceId: desktop.deviceId,
          name: 'Fixture Mac',
          appVersion: '0.9.1',
          platform: 'darwin-arm64',
          capabilities: CAPABILITIES,
        },
      })
      await expect(
        listDesktopInbox.execute({
          principal: desktop.principal,
          input: { deviceId: desktop.deviceId },
        })
      ).rejects.toBeInstanceOf(DesktopDeviceUnrecognizedError)
      await expect(
        listDesktopInbox.execute({ principal: newer, input: { deviceId: desktop.deviceId } })
      ).resolves.toEqual({ items: [], hasActiveRun: false })
    })

    it('disconnects the device when its session is signed out', async () => {
      const desktop = await signedInDesktop()
      await db.delete(session).where(eq(session.id, desktop.sessionId))
      await expect(
        listDesktopInbox.execute({
          principal: desktop.principal,
          input: { deviceId: desktop.deviceId },
        })
      ).rejects.toBeInstanceOf(DesktopDeviceUnrecognizedError)
    })
  })

  describe('claims', () => {
    it('hands an offered call to exactly one of many concurrent claims, with a lease', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId, 'browser_click', {
        ref: 'e1',
        activity: 'Clicking Save',
      })
      await offer(toolCallId)

      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => claim(desktop.principal, desktop.deviceId, toolCallId))
      )
      const won = results.filter((result) => result.status === 'fulfilled')
      expect(won).toHaveLength(1)
      const granted = won[0].status === 'fulfilled' ? won[0].value : undefined
      expect(granted).toMatchObject({
        toolName: 'browser_click',
        args: { ref: 'e1' },
        chatId: run.chatId,
        executionToken: expect.any(String),
      })
      const stored = await row(toolCallId)
      expect(stored.status).toBe('running')
      expect(stored.claimedBy).toBe('desktop-browser')
      expect(stored.executionOwnerToken).toBe(granted?.executionToken)
      expect(stored.executionLeaseExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 50_000)
    })

    it('never hands over a call Sim has not offered, or one whose pickup deadline passed', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const unoffered = await pendingCall(run.runId)
      await expect(claim(desktop.principal, desktop.deviceId, unoffered)).rejects.toThrow(
        'no longer waiting'
      )
      const lapsed = await pendingCall(run.runId)
      await db
        .update(copilotAsyncToolCalls)
        .set({ executionLeaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
        .where(eq(copilotAsyncToolCalls.toolCallId, lapsed))
      await expect(claim(desktop.principal, desktop.deviceId, lapsed)).rejects.toThrow(
        'no longer waiting'
      )
      expect((await row(lapsed)).status).toBe('pending')
    })

    it("refuses another device's or another user's claim on a bound call", async () => {
      const desktop = await signedInDesktop()
      const sameUserOtherMac = await signedInDesktop(desktop.userId)
      const otherUser = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId)
      await offer(toolCallId)

      await expect(
        claim(sameUserOtherMac.principal, sameUserOtherMac.deviceId, toolCallId)
      ).rejects.toThrow('not found')
      await expect(claim(otherUser.principal, otherUser.deviceId, toolCallId)).rejects.toThrow(
        'not found'
      )
      /** A principal presenting a device id it does not own is not that device. */
      await expect(claim(otherUser.principal, desktop.deviceId, toolCallId)).rejects.toBeInstanceOf(
        DesktopDeviceUnrecognizedError
      )
      for (const outsider of [sameUserOtherMac, otherUser]) {
        const inbox = await listDesktopInbox.execute({
          principal: outsider.principal,
          input: { deviceId: outsider.deviceId },
        })
        expect(inbox.items).toEqual([])
      }
      expect((await row(toolCallId)).status).toBe('pending')
      await expect(claim(desktop.principal, desktop.deviceId, toolCallId)).resolves.toMatchObject({
        toolName: 'browser_click',
      })
    })

    it('ignores runs that were never bound to a device', async () => {
      const desktop = await signedInDesktop()
      const unbound = await boundRun({ userId: desktop.userId, deviceId: null })
      const toolCallId = await pendingCall(unbound.runId)
      await offer(toolCallId)
      await expect(claim(desktop.principal, desktop.deviceId, toolCallId)).rejects.toThrow(
        'not found'
      )
      const inbox = await listDesktopInbox.execute({
        principal: desktop.principal,
        input: { deviceId: desktop.deviceId },
      })
      expect(inbox.items).toEqual([])
    })
  })

  describe('approval', () => {
    it('lists a gated command for approval and keeps it unclaimable until it is allowed and offered', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId, 'terminal', {
        operation: 'run',
        command: 'npm test',
      })
      const inbox = await listDesktopInbox.execute({
        principal: desktop.principal,
        input: { deviceId: desktop.deviceId },
      })
      expect(inbox.items).toEqual([
        {
          kind: 'approval_needed',
          toolCallId,
          toolName: 'terminal',
          chatId: run.chatId,
          chatTitle: 'Fix CI',
          workspaceId: run.workspaceId,
          summary: 'npm test',
        },
      ])
      await expect(claim(desktop.principal, desktop.deviceId, toolCallId)).rejects.toThrow(
        'no longer waiting'
      )

      await db
        .update(copilotAsyncToolCalls)
        .set({ permissionDecision: 'allow', permissionDecidedAt: new Date() })
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
      await expect(claim(desktop.principal, desktop.deviceId, toolCallId)).rejects.toThrow(
        'no longer waiting'
      )
      await offer(toolCallId)
      await expect(claim(desktop.principal, desktop.deviceId, toolCallId)).resolves.toMatchObject({
        toolName: 'terminal',
        args: { operation: 'run', command: 'npm test' },
      })
    })

    it('never hands over a call the user declined', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId, 'terminal', {
        operation: 'run',
        command: 'rm -rf build',
      })
      await db
        .update(copilotAsyncToolCalls)
        .set({ permissionDecision: 'skip', permissionDecidedAt: new Date() })
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
      await offer(toolCallId)
      await expect(claim(desktop.principal, desktop.deviceId, toolCallId)).rejects.toThrow(
        'no longer waiting'
      )
      const inbox = await listDesktopInbox.execute({
        principal: desktop.principal,
        input: { deviceId: desktop.deviceId },
      })
      expect(inbox.items).toEqual([])
    })
  })

  describe('leases and Stop', () => {
    it('renews a held lease and refuses one that has lapsed', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId)
      await offer(toolCallId)
      const { executionToken } = await claim(desktop.principal, desktop.deviceId, toolCallId)
      const input = { deviceId: desktop.deviceId, toolCallId, executionToken }

      await db
        .update(copilotAsyncToolCalls)
        .set({ executionLeaseExpiresAt: sql`clock_timestamp() + interval '5 seconds'` })
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
      const { leaseExpiresAt } = await renewDesktopToolLease.execute({
        principal: desktop.principal,
        input,
      })
      expect(leaseExpiresAt.getTime()).toBeGreaterThan(Date.now() + 50_000)
      await expect(
        renewDesktopToolLease.execute({
          principal: desktop.principal,
          input: { ...input, executionToken: generateId() },
        })
      ).rejects.toBeInstanceOf(DesktopCallRevokedError)

      await db
        .update(copilotAsyncToolCalls)
        .set({ executionLeaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
      await expect(
        renewDesktopToolLease.execute({ principal: desktop.principal, input })
      ).rejects.toBeInstanceOf(DesktopCallRevokedError)
      const inbox = await listDesktopInbox.execute({
        principal: desktop.principal,
        input: { deviceId: desktop.deviceId },
      })
      expect(inbox.items).toEqual([{ kind: 'cancel', toolCallId }])
    })

    it('after Stop, refuses new claims and renewals and tells the device to cancel', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const running = await pendingCall(run.runId)
      const waiting = await pendingCall(run.runId, 'browser_snapshot', {})
      await offer(running)
      const { executionToken } = await claim(desktop.principal, desktop.deviceId, running)
      await offer(waiting)

      await requestRunStop({
        userId: desktop.userId,
        workspaceId: run.workspaceId,
        streamId: run.streamId,
      })

      await expect(claim(desktop.principal, desktop.deviceId, waiting)).rejects.toThrow(
        'was stopped'
      )
      await expect(
        renewDesktopToolLease.execute({
          principal: desktop.principal,
          input: { deviceId: desktop.deviceId, toolCallId: running, executionToken },
        })
      ).rejects.toBeInstanceOf(DesktopCallRevokedError)
      const inbox = await listDesktopInbox.execute({
        principal: desktop.principal,
        input: { deviceId: desktop.deviceId },
      })
      expect(inbox.items).toEqual([{ kind: 'cancel', toolCallId: running }])
      expect(inbox.hasActiveRun).toBe(false)

      /** The device's cancelled result acknowledges the cancellation. */
      await completeDesktopTool.execute({
        principal: desktop.principal,
        input: {
          deviceId: desktop.deviceId,
          toolCallId: running,
          executionToken,
          status: 'cancelled',
        },
      })
      const after = await listDesktopInbox.execute({
        principal: desktop.principal,
        input: { deviceId: desktop.deviceId },
      })
      expect(after.items).toEqual([])
    })
  })

  describe('completion', () => {
    it('records a result once, wakes the waiting run, and answers a retry as a duplicate', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId)
      await offer(toolCallId)
      const { executionToken } = await claim(desktop.principal, desktop.deviceId, toolCallId)
      /** Shorter than the waiter's 5 s durable poll, so only the published wake-up can settle it. */
      const waiting = waitForToolConfirmation(toolCallId, 2_000, undefined, {
        acceptStatus: (status) => status === 'success',
      })
      const input = {
        deviceId: desktop.deviceId,
        toolCallId,
        executionToken,
        status: 'success' as const,
        message: 'Clicked Save',
        data: { clicked: true },
      }

      await expect(
        completeDesktopTool.execute({ principal: desktop.principal, input })
      ).resolves.toEqual({ outcome: 'recorded', status: 'completed' })
      const woken = await waiting
      expect(woken?.status).toBe('success')
      await expect(
        unsealClientToolCompletion(woken?.data, {
          toolCallId,
          runId: run.runId,
          userId: desktop.userId,
        })
      ).resolves.toMatchObject({ message: 'Clicked Save', data: { clicked: true } })

      await expect(
        completeDesktopTool.execute({
          principal: desktop.principal,
          input: { ...input, status: 'error', message: 'retry with a different payload' },
        })
      ).resolves.toEqual({ outcome: 'duplicate', status: 'completed' })
      const stored = await row(toolCallId)
      expect(stored.status).toBe('completed')
      expect(stored.executionSettledAt).not.toBeNull()
      expect(stored.claimedBy).toBeNull()
    })

    it('refuses a result presented with the wrong token or by another device', async () => {
      const desktop = await signedInDesktop()
      const otherMac = await signedInDesktop(desktop.userId)
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId)
      await offer(toolCallId)
      const { executionToken } = await claim(desktop.principal, desktop.deviceId, toolCallId)

      await expect(
        completeDesktopTool.execute({
          principal: desktop.principal,
          input: {
            deviceId: desktop.deviceId,
            toolCallId,
            executionToken: generateId(),
            status: 'success',
          },
        })
      ).rejects.toThrow('not found')
      await expect(
        completeDesktopTool.execute({
          principal: otherMac.principal,
          input: { deviceId: otherMac.deviceId, toolCallId, executionToken, status: 'success' },
        })
      ).rejects.toThrow('not found')
      expect((await row(toolCallId)).status).toBe('running')
    })

    it('answers a late result for a call Sim already settled as superseded, without changing it', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId)
      await offer(toolCallId)
      const { executionToken } = await claim(desktop.principal, desktop.deviceId, toolCallId)
      /** Sim settled the lost call as outcome unknown when its lease lapsed. */
      await db
        .update(copilotAsyncToolCalls)
        .set({
          status: 'failed',
          error: 'lost',
          executionRevokedAt: sql`now()`,
          executionSettledAt: sql`now()`,
        })
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))

      await expect(
        completeDesktopTool.execute({
          principal: desktop.principal,
          input: { deviceId: desktop.deviceId, toolCallId, executionToken, status: 'success' },
        })
      ).resolves.toEqual({ outcome: 'superseded', status: 'failed' })
      expect((await row(toolCallId)).error).toBe('lost')
    })
  })

  describe('inbox', () => {
    it('lists an offered call even when its doorbell was never heard', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const first = await pendingCall(run.runId, 'browser_navigate', { url: 'https://sim.ai' })
      const second = await pendingCall(run.runId, 'read_local_file', { path: '/tmp/notes.md' })
      await offer(first)
      await offer(second)
      /** Rung while no stream was open: nobody heard it. */
      ringDesktopInbox(desktop.deviceId, 'call')

      const inbox = await listDesktopInbox.execute({
        principal: desktop.principal,
        input: { deviceId: desktop.deviceId },
      })
      expect(inbox.hasActiveRun).toBe(true)
      expect(inbox.items.map((item) => item.kind === 'call' && item.toolCallId)).toEqual([
        first,
        second,
      ])
    })

    it('marks the device online while its stream is open and rings it when the inbox changes', async () => {
      const desktop = await signedInDesktop()
      const stream = await openDesktopInboxStream.execute({
        principal: desktop.principal,
        input: { deviceId: desktop.deviceId },
      })
      const heard: Array<{ event: string; data: Record<string, unknown> }> = []
      const close = stream.subscribe((event, data) => heard.push({ event, data }))
      try {
        await expect.poll(() => isDesktopPresent(desktop.deviceId)).toBe(true)
        ringDesktopInbox(generateId(), 'call')
        ringDesktopInbox(desktop.deviceId, 'cancel')
        await expect
          .poll(() => heard)
          .toEqual([{ event: 'inbox_changed', data: { reason: 'cancel' } }])
      } finally {
        close()
      }
      await expect.poll(() => isDesktopPresent(desktop.deviceId)).toBe(false)
    })

    it('ends a stream whose session was signed out at its next revalidation', async () => {
      const desktop = await signedInDesktop()
      const stream = await openDesktopInboxStream.execute({
        principal: desktop.principal,
        input: { deviceId: desktop.deviceId },
      })
      await expect(stream.revalidate()).resolves.toBeUndefined()
      await db.delete(session).where(eq(session.id, desktop.sessionId))
      await expect(stream.revalidate()).rejects.toBeInstanceOf(DesktopDeviceUnrecognizedError)
    })
  })
})
