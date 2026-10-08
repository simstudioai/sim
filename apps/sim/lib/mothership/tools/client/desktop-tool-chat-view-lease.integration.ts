/**
 * An import the chat view runs keeps its turn waiting for as long as it works: its claim takes the
 * execution lease under the claiming session, the chat view renews it through the same lease route
 * a desktop's background executor uses, and the turn's wait budget runs to the end of that lease.
 * Runs against real PostgreSQL and Redis through the production pre-persist path, the authorize
 * route, the lease route and the confirm route.
 */
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedEnv } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const url = readTestRedisUrl()
  const inheritedEnv = { REDIS_URL: process.env.REDIS_URL }
  /** The real Redis module (rate limits, the confirmation channel) reads this at import. */
  if (url) process.env.REDIS_URL = url
  return { redisUrl: url, inheritedEnv }
})

vi.mock('@/lib/auth', () => authMock)

import { db } from '@sim/db'
import {
  copilotAsyncToolCalls,
  copilotChats,
  copilotRuns,
  desktopDevices,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { closeRedisConnection } from '@/lib/core/config/redis'
import {
  DESKTOP_TOOL_CLAIM_OWNER,
  SIM_TOOL_EXECUTION_VERSION,
} from '@/lib/mothership/async-runs/lifecycle'
import {
  claimDesktopToolCall,
  getChatViewDesktopLeaseRemainingMs,
} from '@/lib/mothership/async-runs/repository'
import { prePersistClientExecutableToolCall } from '@/lib/mothership/request/handlers'
import { TraceCollector } from '@/lib/mothership/request/trace'
import type { StreamingContext } from '@/lib/mothership/request/types'
import { chatViewDesktopLeaseOwnerToken } from '@/lib/mothership/tools/desktop-tools'
import { POST as confirmPOST } from '@/app/api/copilot/confirm/route'
import { POST as authorizePOST } from '@/app/api/desktop/tool/authorize/route'
import { POST as leasePOST } from '@/app/api/desktop/tool/lease/route'

const APP_ORIGIN = 'http://localhost:3000'
const LEASE_MS = 60_000

function post(handler: typeof authorizePOST, path: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    handler(
      new NextRequest(new URL(path, APP_ORIGIN), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      {}
    )
  )
}

const desktopClaims = (toolCallId: string) =>
  post(authorizePOST, '/api/desktop/tool/authorize', { toolCallId, claim: true })

/** The chat view renewing an import's lease through the desktop lease route. */
const chatViewRenews = (toolCallId: string) =>
  leasePOST(
    new NextRequest(new URL('/api/desktop/tool/lease', APP_ORIGIN), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolCallId, chatView: true }),
    })
  )

/** Moves a call's lease end to `seconds` from now on the database clock. */
async function leaseEndsIn(toolCallId: string, seconds: number) {
  await db
    .update(copilotAsyncToolCalls)
    .set({
      executionLeaseExpiresAt: sql`clock_timestamp() + ${seconds} * interval '1 second'`,
    })
    .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
}

afterAll(async () => {
  const channels = globalThis as typeof globalThis & {
    _toolConfirmationChannel?: { dispose(): void }
  }
  channels._toolConfirmationChannel?.dispose()
  channels._toolConfirmationChannel = undefined
  await closeRedisConnection()
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe.runIf(Boolean(redisUrl))('a chat-view import kept alive by its lease', () => {
  const userId = generateId()
  const otherUserId = generateId()
  const workspaceId = generateId()
  const chatId = generateId()
  const sessionId = generateId()

  function signedInAs(id: string, session: string) {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id, email: `${id}@chat-view-lease.test`, name: 'Desktop' },
      session: { id: session, userId: id },
    })
  }

  async function startRun(desktopDeviceId?: string) {
    const runId = generateId()
    await db.insert(copilotRuns).values({
      id: runId,
      executionId: generateId(),
      chatId,
      userId,
      workspaceId,
      streamId: generateId(),
      toolExecutionVersion: SIM_TOOL_EXECUTION_VERSION,
      status: 'active',
      requestContext: { source: 'headless_lifecycle' },
      ...(desktopDeviceId ? { desktopDeviceId } : {}),
    })
    return runId
  }

  /** The production pre-persist path for a desktop call the agent issues on `runId`. */
  async function agentCalls(runId: string, toolName: string, args: Record<string, unknown>) {
    const toolCallId = generateId()
    const context: StreamingContext = {
      runId,
      chatId,
      messageId: generateId(),
      accumulatedContent: '',
      finalAssistantContent: '',
      sawMainToolCall: false,
      trace: new TraceCollector(),
      contentBlocks: [],
      toolCalls: new Map(),
      pendingToolPromises: new Map(),
      activeFileIntents: new Map(),
      filePreviewBudget: { contentBytes: 0 },
      seenToolCalls: new Set(),
      seenToolResults: new Set(),
      currentThinkingBlock: null,
      subagentThinkingBlocks: new Map(),
      isInThinkingBlock: false,
      subAgentContent: {},
      subAgentToolCalls: {},
      pendingContent: '',
      streamComplete: false,
      wasAborted: false,
      errors: [],
      toolPermissions: { enabled: false, autoAllowed: new Set(), autoAllowPermitted: true },
    }
    await prePersistClientExecutableToolCall(
      {
        type: 'tool',
        payload: {
          toolCallId,
          toolName,
          arguments: args,
          executor: 'client',
          mode: 'async',
          phase: 'call',
        },
      },
      context,
      {}
    )
    return toolCallId
  }

  /** An import the chat view claimed, as the desktop app's manifest request does. */
  async function chatViewImports() {
    const runId = await startRun()
    const toolCallId = await agentCalls(runId, 'import_local_files', {
      path: '/Users/fixture/Reports',
      targetWorkspaceId: workspaceId,
    })
    const claim = await desktopClaims(toolCallId)
    expect(claim.status).toBe(200)
    return { runId, toolCallId }
  }

  beforeAll(async () => {
    const now = new Date()
    for (const id of [userId, otherUserId])
      await db.insert(user).values({
        id,
        name: 'Chat-view lease fixture',
        email: `${id}@chat-view-lease.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Chat-view lease fixture',
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
    await db.insert(copilotChats).values({
      id: chatId,
      userId,
      workspaceId,
      type: 'mothership',
      conversationId: generateId(),
    })
  })

  afterAll(async () => {
    await db.delete(copilotChats).where(eq(copilotChats.id, chatId))
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
    await db.delete(user).where(eq(user.id, otherUserId))
  })

  it('an import claim takes a lease as long as the default budget, which lapses without renewals', async () => {
    signedInAs(userId, sessionId)
    const { toolCallId } = await chatViewImports()
    const remaining = await getChatViewDesktopLeaseRemainingMs(toolCallId)
    expect(remaining).toBeGreaterThan(LEASE_MS - 5_000)
    expect(remaining).toBeLessThanOrEqual(LEASE_MS)

    await leaseEndsIn(toolCallId, -1)
    expect(await getChatViewDesktopLeaseRemainingMs(toolCallId)).toBeNull()
    // A lapsed lease is not revived: the turn has already given the import up.
    expect((await chatViewRenews(toolCallId)).status).toBe(410)
  })

  it('the claiming session renews it, which keeps the turn waiting', async () => {
    signedInAs(userId, sessionId)
    const { toolCallId } = await chatViewImports()
    await leaseEndsIn(toolCallId, 10)
    const renewal = await chatViewRenews(toolCallId)
    expect(renewal.status).toBe(200)
    expect(await renewal.json()).toEqual({ renewed: true })
    expect(await getChatViewDesktopLeaseRemainingMs(toolCallId)).toBeGreaterThan(LEASE_MS - 5_000)
  })

  it('a read claims without a lease and keeps the default budget', async () => {
    signedInAs(userId, sessionId)
    const runId = await startRun()
    const toolCallId = await agentCalls(runId, 'read_local_file', { path: '/Users/fixture/a.txt' })
    expect((await desktopClaims(toolCallId)).status).toBe(200)
    expect(await getChatViewDesktopLeaseRemainingMs(toolCallId)).toBeNull()
    expect((await chatViewRenews(toolCallId)).status).toBe(410)
  })

  it('another session of the same user cannot renew it', async () => {
    signedInAs(userId, sessionId)
    const { toolCallId } = await chatViewImports()
    await leaseEndsIn(toolCallId, 10)
    signedInAs(userId, generateId())
    expect((await chatViewRenews(toolCallId)).status).toBe(410)
    expect(await getChatViewDesktopLeaseRemainingMs(toolCallId)).toBeLessThanOrEqual(10_000)
  })

  it('another user cannot renew it', async () => {
    signedInAs(userId, sessionId)
    const { toolCallId } = await chatViewImports()
    await leaseEndsIn(toolCallId, 10)
    signedInAs(otherUserId, sessionId)
    expect((await chatViewRenews(toolCallId)).status).toBe(410)
    expect(await getChatViewDesktopLeaseRemainingMs(toolCallId)).toBeLessThanOrEqual(10_000)
  })

  it('a settled import cannot be renewed', async () => {
    signedInAs(userId, sessionId)
    const { toolCallId } = await chatViewImports()
    const report = await post(confirmPOST, '/api/copilot/confirm', {
      toolCallId,
      status: 'success',
      message: 'Imported',
      data: { success: true, files: [], folders: [] },
    })
    expect(report.status).toBe(200)
    expect((await chatViewRenews(toolCallId)).status).toBe(410)
    expect(await getChatViewDesktopLeaseRemainingMs(toolCallId)).toBeNull()
  })

  it("a call a desktop device holds is not the chat view's to renew", async () => {
    signedInAs(userId, sessionId)
    const deviceId = generateId()
    await db.insert(desktopDevices).values({
      id: deviceId,
      userId,
      name: 'Fixture desktop',
      appVersion: '0.9.0',
      platform: 'darwin-arm64',
      capabilities: { executor: 1, browser: true, terminal: true, localFiles: true },
    })
    try {
      const runId = await startRun(deviceId)
      const toolCallId = await agentCalls(runId, 'read_local_file', {
        path: '/Users/fixture/a.txt',
      })
      // Offered to the device, as Sim does for a bound run's call.
      await db
        .update(copilotAsyncToolCalls)
        .set({ pickupDeadlineAt: sql`clock_timestamp() + interval '60 seconds'` })
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
      // Even under the token the chat view would use, a bound run's call stays the device's.
      const claim = await claimDesktopToolCall({
        toolCallId,
        runId,
        userId,
        claimedBy: DESKTOP_TOOL_CLAIM_OWNER.files,
        executor: { deviceId, ownerToken: chatViewDesktopLeaseOwnerToken(sessionId) },
      })
      expect(claim.outcome).toBe('claimed')
      expect((await chatViewRenews(toolCallId)).status).toBe(410)
      expect(await getChatViewDesktopLeaseRemainingMs(toolCallId)).toBeNull()
    } finally {
      await db.delete(copilotRuns).where(eq(copilotRuns.desktopDeviceId, deviceId))
      await db.delete(desktopDevices).where(eq(desktopDevices.id, deviceId))
    }
  })
})
