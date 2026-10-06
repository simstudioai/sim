/**
 * The desktop background executor's device-facing protocol against real PostgreSQL and Redis:
 * registration, presence, the inbox and its doorbell, leased claims, renewal, and idempotent
 * completion. Calls are persisted the way the run loop persists a bound run's desktop calls, and
 * Stop runs through the real `requestRunStop`.
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
  auditLog,
  copilotAsyncToolCalls,
  copilotChats,
  copilotRuns,
  desktopDevices,
  session,
  user,
  workspace,
} from '@sim/db/schema'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import type { DbTransaction } from '@/lib/db/types'
import {
  claimDesktopTool,
  completeDesktopTool,
  listDesktopInbox,
  openDesktopInboxStream,
  registerDesktopDevice,
  renewDesktopToolLease,
} from '@/lib/desktop/application/executor'
import { ringDesktopInbox } from '@/lib/desktop/executor/doorbell'
import {
  DesktopCallRevokedError,
  DesktopDeviceUnrecognizedError,
} from '@/lib/desktop/executor/errors'
import { isDesktopPresent } from '@/lib/desktop/executor/presence'
import { claimDesktopToolCall, requestRunStop } from '@/lib/mothership/async-runs/repository'
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

  /**
   * A desktop call the run persisted before forwarding its frame. `awaitingApproval` marks it held
   * for the user's decision, as pre-persist does for a gated call.
   */
  async function pendingCall(
    runId: string,
    toolName = 'browser_click',
    args: Record<string, unknown> = { ref: 'e1' },
    options: { awaitingApproval?: boolean } = {}
  ) {
    const toolCallId = generateId()
    await db.insert(copilotAsyncToolCalls).values({
      runId,
      toolCallId,
      toolName,
      args,
      ...(options.awaitingApproval ? { permissionRequestedAt: new Date() } : {}),
    })
    return toolCallId
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

  async function inbox(desktop: { principal: SessionPrincipal; deviceId: string }) {
    return listDesktopInbox.execute({
      principal: desktop.principal,
      input: { deviceId: desktop.deviceId },
    })
  }

  /** Runs `queued` while a transaction holding `lock` stays open, releasing it once `queued` waits. */
  async function whileHolding<T>(
    lock: (tx: DbTransaction) => Promise<unknown>,
    queued: () => Promise<T>
  ): Promise<PromiseSettledResult<T>> {
    const held = createDeferred<number>()
    const release = createDeferred<void>()
    const holding = db.transaction(async (tx) => {
      await lock(tx)
      const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      held.resolve(backend.pid)
      await release.promise
    })
    const holder = await held.promise
    const waiting = queued()
    try {
      await expect
        .poll(async () => {
          const [waiter] = await db.execute<{ pid: number }>(sql`
            SELECT pid FROM pg_stat_activity WHERE wait_event_type = 'Lock'
              AND ${holder}::int = ANY(pg_blocking_pids(pid)) LIMIT 1`)
          return Boolean(waiter)
        })
        .toBe(true)
    } finally {
      release.resolve()
      await holding
    }
    const [settled] = await Promise.allSettled([waiting])
    return settled
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
      await expect(inbox(desktop)).rejects.toBeInstanceOf(DesktopDeviceUnrecognizedError)
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
      await expect(inbox(desktop)).rejects.toBeInstanceOf(DesktopDeviceUnrecognizedError)
      await expect(inbox({ principal: newer, deviceId: desktop.deviceId })).resolves.toEqual({
        items: [],
      })
    })

    it('disconnects the device when its session is signed out', async () => {
      const desktop = await signedInDesktop()
      await db.delete(session).where(eq(session.id, desktop.sessionId))
      await expect(inbox(desktop)).rejects.toBeInstanceOf(DesktopDeviceUnrecognizedError)
    })
  })

  describe('claims', () => {
    it('hands a pending call to exactly one of many concurrent claims, with a lease', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId, 'browser_click', {
        ref: 'e1',
        activity: 'Clicking Save',
      })

      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => claim(desktop.principal, desktop.deviceId, toolCallId))
      )
      const won = results.filter((result) => result.status === 'fulfilled')
      expect(won).toHaveLength(1)
      const granted = won[0].status === 'fulfilled' ? won[0].value : undefined
      expect(granted).toEqual({
        toolName: 'browser_click',
        args: { ref: 'e1' },
        chatId: run.chatId,
        workspaceId: run.workspaceId,
        executionToken: expect.any(String),
      })
      const stored = await row(toolCallId)
      expect(stored.status).toBe('running')
      expect(stored.claimedBy).toBe('desktop-browser')
      expect(stored.executionOwnerToken).toBe(granted?.executionToken)
      expect(stored.executionStartedAt).not.toBeNull()
      expect(stored.executionLeaseExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 50_000)
    })

    it('never hands over a call that was settled before anyone claimed it', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId)
      /** Failed as not started: nobody claimed it in time. */
      await db
        .update(copilotAsyncToolCalls)
        .set({ status: 'failed', error: 'not started' })
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
      await expect(claim(desktop.principal, desktop.deviceId, toolCallId)).rejects.toThrow(
        'no longer waiting'
      )
      expect((await row(toolCallId)).status).toBe('failed')
    })

    it('records a local read under the files surface', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId, 'read_local_file', { path: '/tmp/a.md' })
      await claim(desktop.principal, desktop.deviceId, toolCallId)
      expect((await row(toolCallId)).claimedBy).toBe('desktop-files')
    })

    it("refuses another device's or another user's claim on a bound call", async () => {
      const desktop = await signedInDesktop()
      const sameUserOtherMac = await signedInDesktop(desktop.userId)
      const otherUser = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId)

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
        expect((await inbox(outsider)).items).toEqual([])
      }
      expect((await row(toolCallId)).status).toBe('pending')
      await expect(claim(desktop.principal, desktop.deviceId, toolCallId)).resolves.toMatchObject({
        toolName: 'browser_click',
      })
    })

    it('binds the claim itself to the run’s device, not only the lookup before it', async () => {
      const desktop = await signedInDesktop()
      const sameUserOtherMac = await signedInDesktop(desktop.userId)
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId)
      const executorClaim = (deviceId: string) =>
        claimDesktopToolCall({
          toolCallId,
          runId: run.runId,
          userId: desktop.userId,
          claimedBy: 'desktop-browser',
          executor: { deviceId, ownerToken: generateId() },
        })

      await expect(executorClaim(sameUserOtherMac.deviceId)).rejects.toThrow(
        'Tool execution ownership is unavailable'
      )
      expect((await row(toolCallId)).status).toBe('pending')
      await expect(executorClaim(desktop.deviceId)).resolves.toEqual({ outcome: 'claimed' })
    })

    it('ignores runs that were never bound to a device', async () => {
      const desktop = await signedInDesktop()
      const unbound = await boundRun({ userId: desktop.userId, deviceId: null })
      const toolCallId = await pendingCall(unbound.runId)
      await expect(claim(desktop.principal, desktop.deviceId, toolCallId)).rejects.toThrow(
        'not found'
      )
      expect((await inbox(desktop)).items).toEqual([])
    })
  })

  describe('approval', () => {
    it('lists a call held for approval and keeps it unclaimable until it is allowed', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(
        run.runId,
        'terminal',
        { operation: 'run', command: 'npm test' },
        { awaitingApproval: true }
      )
      expect((await inbox(desktop)).items).toEqual([
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
      await expect(claim(desktop.principal, desktop.deviceId, toolCallId)).rejects.toMatchObject({
        code: 'forbidden',
        message: expect.stringContaining('not approved'),
      })

      await db
        .update(copilotAsyncToolCalls)
        .set({ permissionDecision: 'allow', permissionDecidedAt: new Date() })
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
      expect((await inbox(desktop)).items).toMatchObject([{ kind: 'call', toolCallId }])
      await expect(claim(desktop.principal, desktop.deviceId, toolCallId)).resolves.toMatchObject({
        toolName: 'terminal',
        args: { operation: 'run', command: 'npm test' },
      })
    })

    it('lists a call that was never held for approval as claimable, whatever its tool', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId, 'terminal', {
        operation: 'run',
        command: 'ls',
      })
      expect((await inbox(desktop)).items).toMatchObject([{ kind: 'call', toolCallId }])
    })

    it('never hands over a call the user declined', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(
        run.runId,
        'terminal',
        { operation: 'run', command: 'rm -rf build' },
        { awaitingApproval: true }
      )
      await db
        .update(copilotAsyncToolCalls)
        .set({ permissionDecision: 'skip', permissionDecidedAt: new Date() })
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
      await expect(claim(desktop.principal, desktop.deviceId, toolCallId)).rejects.toMatchObject({
        code: 'forbidden',
        message: expect.stringContaining('not approved'),
      })
      expect((await inbox(desktop)).items).toEqual([])
    })
  })

  describe('leases and Stop', () => {
    it('renews a held lease and refuses one that has lapsed', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId)
      const { executionToken } = await claim(desktop.principal, desktop.deviceId, toolCallId)
      const input = { deviceId: desktop.deviceId, toolCallId, executionToken }

      await db
        .update(copilotAsyncToolCalls)
        .set({ executionLeaseExpiresAt: sql`clock_timestamp() + interval '5 seconds'` })
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
      await expect(
        renewDesktopToolLease.execute({ principal: desktop.principal, input })
      ).resolves.toEqual({ renewed: true })
      expect((await row(toolCallId)).executionLeaseExpiresAt?.getTime()).toBeGreaterThan(
        Date.now() + 50_000
      )
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
    })

    it('after Stop, refuses the stopped calls, revokes the running one and lists it to cancel', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const running = await pendingCall(run.runId)
      const waiting = await pendingCall(run.runId, 'browser_snapshot', {})
      const { executionToken } = await claim(desktop.principal, desktop.deviceId, running)

      await requestRunStop({
        userId: desktop.userId,
        workspaceId: run.workspaceId,
        streamId: run.streamId,
      })

      await expect(claim(desktop.principal, desktop.deviceId, waiting)).rejects.toThrow(
        'ended or was stopped'
      )
      await expect(
        renewDesktopToolLease.execute({
          principal: desktop.principal,
          input: { deviceId: desktop.deviceId, toolCallId: running, executionToken },
        })
      ).rejects.toBeInstanceOf(DesktopCallRevokedError)
      expect((await inbox(desktop)).items).toEqual([{ kind: 'cancel', toolCallId: running }])

      /** Stop already answered the turn: even a success after it is superseded, and acknowledges it. */
      await expect(
        completeDesktopTool.execute({
          principal: desktop.principal,
          input: {
            deviceId: desktop.deviceId,
            toolCallId: running,
            executionToken,
            status: 'success',
          },
        })
      ).resolves.toEqual({ outcome: 'superseded', status: 'cancelled' })
      expect((await row(running)).status).toBe('cancelled')
      expect((await inbox(desktop)).items).toEqual([])
    })
  })

  describe('completion', () => {
    it('records a result once, wakes the waiting run, and answers a retry as a duplicate', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId)
      const { executionToken } = await claim(desktop.principal, desktop.deviceId, toolCallId)
      const waiting = waitForToolConfirmation(toolCallId, 10_000, undefined, {
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
      ).resolves.toMatchObject({ outcome: 'recorded', status: 'completed' })
      const woken = await waiting
      expect(woken?.status).toBe('success')
      /** The wake-up itself: the confirmation every waiter's pub/sub wakes on, published durably. */
      await expect
        .poll(() => getRedisClient()?.get(`copilot:tool-confirmation:${toolCallId}`))
        .toContain('"status":"success"')
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

      /** The claim and the recorded result are audited once each; the retry changed nothing. */
      const audited = () =>
        db
          .select({
            action: auditLog.action,
            workspaceId: auditLog.workspaceId,
            actorId: auditLog.actorId,
            resourceType: auditLog.resourceType,
            resourceId: auditLog.resourceId,
            metadata: auditLog.metadata,
          })
          .from(auditLog)
          .where(eq(auditLog.resourceId, desktop.deviceId))
          .orderBy(auditLog.createdAt)
      await expect.poll(async () => (await audited()).length).toBe(2)
      const entry = (action: string) => ({
        action,
        workspaceId: run.workspaceId,
        actorId: desktop.userId,
        resourceType: 'desktop_device',
        resourceId: desktop.deviceId,
        metadata: expect.objectContaining({
          toolCallId,
          toolName: 'browser_click',
          chatId: run.chatId,
        }),
      })
      expect(await audited()).toEqual([
        entry('desktop_tool_call.claimed'),
        entry('desktop_tool_call.completed'),
      ])
      expect(JSON.stringify(await audited())).not.toContain('Clicked Save')
    })

    it('accepts a late result whose lease lapsed before anything settled the call', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId)
      const { executionToken } = await claim(desktop.principal, desktop.deviceId, toolCallId)
      await db
        .update(copilotAsyncToolCalls)
        .set({ executionLeaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
      await expect(
        completeDesktopTool.execute({
          principal: desktop.principal,
          input: { deviceId: desktop.deviceId, toolCallId, executionToken, status: 'success' },
        })
      ).resolves.toMatchObject({ outcome: 'recorded', status: 'completed' })
    })

    it('refuses a result presented with the wrong token or by another device', async () => {
      const desktop = await signedInDesktop()
      const otherMac = await signedInDesktop(desktop.userId)
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId)
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

    it('answers a late result for a call Sim settled as lost as superseded, without changing it', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId)
      const { executionToken } = await claim(desktop.principal, desktop.deviceId, toolCallId)
      /** Sim settled the lost call when its lease lapsed. */
      await db
        .update(copilotAsyncToolCalls)
        .set({ status: 'failed', error: 'lost', executionRevokedAt: sql`now()` })
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
      expect((await inbox(desktop)).items).toEqual([{ kind: 'cancel', toolCallId }])

      await expect(
        completeDesktopTool.execute({
          principal: desktop.principal,
          input: { deviceId: desktop.deviceId, toolCallId, executionToken, status: 'success' },
        })
      ).resolves.toEqual({ outcome: 'superseded', status: 'failed' })
      expect((await row(toolCallId)).error).toBe('lost')
      expect((await inbox(desktop)).items).toEqual([])
    })

    it('never records a result over a settlement that commits while it waits on the row', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = await pendingCall(run.runId)
      const { executionToken } = await claim(desktop.principal, desktop.deviceId, toolCallId)

      /** Stop's settlement writes the row; the result arrives while that write is uncommitted. */
      const completing = await whileHolding(
        (tx) =>
          tx
            .update(copilotAsyncToolCalls)
            .set({ status: 'cancelled', error: 'stopped' })
            .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId)),
        () =>
          completeDesktopTool.execute({
            principal: desktop.principal,
            input: { deviceId: desktop.deviceId, toolCallId, executionToken, status: 'success' },
          })
      )

      expect(completing).toEqual({
        status: 'fulfilled',
        value: { outcome: 'superseded', status: 'cancelled' },
      })
      expect((await row(toolCallId)).status).toBe('cancelled')
    })
  })

  describe('presence and the inbox', () => {
    it('lists pending calls in persistence order even when their doorbell was never heard', async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const first = await pendingCall(run.runId, 'browser_navigate', { url: 'https://sim.ai' })
      const second = await pendingCall(run.runId, 'read_local_file', { path: '/tmp/notes.md' })
      const vfs = await pendingCall(run.runId, 'grep', {
        path: 'user-local/Project--mount-1',
        pattern: 'TODO',
      })
      await pendingCall(run.runId, 'run_workflow', {})
      /** Rung while no stream was open: nobody heard it. */
      ringDesktopInbox(desktop.deviceId, 'call')

      expect(
        (await inbox(desktop)).items.map((item) => item.kind === 'call' && item.toolCallId)
      ).toEqual([first, second, vfs])
    })

    it('counts the device online after a pull or a stream open, and keeps it online when the stream closes', async () => {
      const desktop = await signedInDesktop()
      const presenceKey = `desktop:presence:${desktop.deviceId}`
      const redis = getRedisClient()
      await redis?.del(presenceKey)
      expect(await isDesktopPresent(desktop.deviceId)).toBe(false)
      await inbox(desktop)
      expect(await isDesktopPresent(desktop.deviceId)).toBe(true)

      await redis?.del(presenceKey)
      const stream = await openDesktopInboxStream.execute({
        principal: desktop.principal,
        input: { deviceId: desktop.deviceId },
      })
      expect(await isDesktopPresent(desktop.deviceId)).toBe(true)
      /** A deploy or rotation closes the stream on the server; only the TTL ends presence. */
      stream.subscribe(() => {})()
      expect(await isDesktopPresent(desktop.deviceId)).toBe(true)
      expect(await redis?.ttl(presenceKey)).toBeLessThanOrEqual(45)
    })

    it('rings only the device whose inbox changed', async () => {
      const desktop = await signedInDesktop()
      const stream = await openDesktopInboxStream.execute({
        principal: desktop.principal,
        input: { deviceId: desktop.deviceId },
      })
      const heard: Array<{ event: string; data: Record<string, unknown> }> = []
      const close = stream.subscribe((event, data) => heard.push({ event, data }))
      try {
        /**
         * A Redis subscription is acknowledged asynchronously, so each poll rings both devices
         * until this one hears it; the other device's doorbell must never reach this stream.
         */
        await expect
          .poll(() => {
            ringDesktopInbox(generateId(), 'call')
            ringDesktopInbox(desktop.deviceId, 'cancel')
            return heard.length
          })
          .toBeGreaterThan(0)
        expect(heard.every(({ data }) => data.reason === 'cancel')).toBe(true)
        expect(heard[0]).toEqual({ event: 'inbox_changed', data: { reason: 'cancel' } })
      } finally {
        close()
      }
    })

    it('ends a stream whose session was signed out at its next revalidation', async () => {
      const desktop = await signedInDesktop()
      const stream = await openDesktopInboxStream.execute({
        principal: desktop.principal,
        input: { deviceId: desktop.deviceId },
      })
      const close = stream.subscribe(() => {})
      try {
        await expect(stream.revalidate()).resolves.toBeUndefined()
        await db.delete(session).where(eq(session.id, desktop.sessionId))
        /** The SSE transport closes a stream whose revalidation rejects. */
        await expect(stream.revalidate()).rejects.toBeInstanceOf(DesktopDeviceUnrecognizedError)
      } finally {
        close()
      }
    })
  })
})
