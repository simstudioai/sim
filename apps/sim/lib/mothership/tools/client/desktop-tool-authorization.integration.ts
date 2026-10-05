/**
 * The desktop app may act on the user's machine only for a call the server still admits: one the
 * user approved (when it asked), on a run nobody stopped. Runs against real PostgreSQL and Redis:
 * the call is persisted by the production pre-persist path, the desktop claims it through the
 * authorize route, the user answers through the tool-permission route, Stop goes through the
 * durable Stop write, and results arrive through the confirm route.
 */
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedEnv } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const url = readTestRedisUrl()
  const inheritedEnv = {
    REDIS_URL: process.env.REDIS_URL,
    COPILOT_TOOL_PERMISSIONS_ENABLED: process.env.COPILOT_TOOL_PERMISSIONS_ENABLED,
  }
  /** The real Redis module, the confirmation channel and the permission flag read these at import. */
  if (url) process.env.REDIS_URL = url
  process.env.COPILOT_TOOL_PERMISSIONS_ENABLED = 'true'
  return { redisUrl: url, inheritedEnv }
})

vi.mock('@/lib/auth', () => authMock)

import { db } from '@sim/db'
import { copilotAsyncToolCalls, copilotChats, copilotRuns, user, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { closeRedisConnection } from '@/lib/core/config/redis'
import { SIM_TOOL_EXECUTION_VERSION } from '@/lib/mothership/async-runs/lifecycle'
import {
  claimPendingAsyncToolCall,
  closeStreamToolAdmission,
  requestRunStop,
} from '@/lib/mothership/async-runs/repository'
import { prePersistClientExecutableToolCall } from '@/lib/mothership/request/handlers'
import { waitForClientToolCompletion } from '@/lib/mothership/request/tools/client'
import { TraceCollector } from '@/lib/mothership/request/trace'
import type { StreamingContext } from '@/lib/mothership/request/types'
import { POST as confirmPOST } from '@/app/api/copilot/confirm/route'
import { POST as toolPermissionPOST } from '@/app/api/copilot/tool-permission/route'
import { POST as authorizePOST } from '@/app/api/desktop/tool/authorize/route'

const APP_ORIGIN = 'http://localhost:3000'

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

/** The desktop main process asking to act on a call: the claim happens here, before any effect. */
const desktopClaims = (toolCallId: string) =>
  post(authorizePOST, '/api/desktop/tool/authorize', { toolCallId })

const reportsResult = (toolCallId: string, status: 'success' | 'error' = 'success') =>
  post(confirmPOST, '/api/copilot/confirm', {
    toolCallId,
    status,
    message: 'Done',
    data: { ok: true },
  })

const userAnswers = (toolCallId: string, decision: 'allow' | 'skip') =>
  post(toolPermissionPOST, '/api/copilot/tool-permission', {
    decisions: [{ toolCallId, decision }],
  })

async function storedCall(toolCallId: string) {
  const [row] = await db
    .select({
      status: copilotAsyncToolCalls.status,
      claimedBy: copilotAsyncToolCalls.claimedBy,
      result: copilotAsyncToolCalls.result,
    })
    .from(copilotAsyncToolCalls)
    .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
  return row
}

afterAll(async () => {
  const channels = globalThis as typeof globalThis & {
    _toolConfirmationChannel?: { dispose(): void }
    _toolPermissionChannel?: { dispose(): void }
  }
  channels._toolConfirmationChannel?.dispose()
  channels._toolConfirmationChannel = undefined
  channels._toolPermissionChannel?.dispose()
  channels._toolPermissionChannel = undefined
  await closeRedisConnection()
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe.runIf(Boolean(redisUrl))('desktop tool calls the server no longer admits', () => {
  const userId = generateId()
  const workspaceId = generateId()
  const chatId = generateId()

  /** One run per test, so a Stop in one test cannot close another's admission. */
  async function startRun() {
    const runId = generateId()
    const streamId = generateId()
    await db.insert(copilotRuns).values({
      id: runId,
      executionId: generateId(),
      chatId,
      userId,
      workspaceId,
      streamId,
      toolExecutionVersion: SIM_TOOL_EXECUTION_VERSION,
      status: 'active',
      requestContext: { source: 'headless_lifecycle' },
    })
    return { runId, streamId }
  }

  /** The production pre-persist path, with the tool permission gate turned on for this user. */
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
      toolPermissions: { enabled: true, autoAllowed: new Set(), autoAllowPermitted: true },
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

  async function desktopIsRunning(runId: string, toolName: string) {
    const toolCallId = await agentCalls(runId, toolName, {})
    const claim = await desktopClaims(toolCallId)
    expect(claim.status).toBe(200)
    return toolCallId
  }

  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Desktop authorization fixture',
      email: `${userId}@desktop-authorization.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Desktop authorization fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(copilotChats).values({
      id: chatId,
      userId,
      workspaceId,
      type: 'mothership',
      conversationId: generateId(),
    })
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: userId, email: `${userId}@desktop-authorization.test`, name: 'Desktop' },
      session: { id: generateId(), userId },
    })
  })

  afterAll(async () => {
    await db.delete(copilotChats).where(eq(copilotChats.id, chatId))
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
  })

  it('refuses to run a gated terminal command until the user approves it', async () => {
    const { runId } = await startRun()
    const toolCallId = await agentCalls(runId, 'terminal', {
      operation: 'run',
      args: { command: 'rm -rf build' },
    })

    const beforeApproval = await desktopClaims(toolCallId)
    expect(beforeApproval.status).toBe(403)
    expect(await storedCall(toolCallId)).toMatchObject({ status: 'pending', claimedBy: null })

    expect((await userAnswers(toolCallId, 'allow')).status).toBe(200)
    const afterApproval = await desktopClaims(toolCallId)
    expect(afterApproval.status).toBe(200)
    expect(await storedCall(toolCallId)).toMatchObject({
      status: 'running',
      claimedBy: 'desktop-terminal',
    })
  })

  it('refuses to run a gated terminal command the user declined', async () => {
    const { runId } = await startRun()
    const toolCallId = await agentCalls(runId, 'terminal', {
      operation: 'run',
      args: { command: 'git push --force' },
    })

    expect((await userAnswers(toolCallId, 'skip')).status).toBe(200)
    expect((await desktopClaims(toolCallId)).status).toBe(403)
    expect(await storedCall(toolCallId)).toMatchObject({ status: 'pending', claimedBy: null })
  })

  it('refuses a pending desktop call after Stop, and settles it as never started', async () => {
    const { runId, streamId } = await startRun()
    const toolCallId = await agentCalls(runId, 'browser_click', { ref: 'e12' })

    await requestRunStop({ userId, workspaceId, streamId, chatId })

    expect((await desktopClaims(toolCallId)).status).toBe(410)
    expect(await storedCall(toolCallId)).toMatchObject({
      status: 'cancelled',
      claimedBy: null,
      result: expect.objectContaining({ notStarted: true }),
    })
  })

  it('refuses a pending desktop call once a newer turn closed tool admission', async () => {
    const { runId, streamId } = await startRun()
    const toolCallId = await agentCalls(runId, 'browser_click', { ref: 'e12' })

    await closeStreamToolAdmission(streamId, userId)

    expect((await desktopClaims(toolCallId)).status).toBe(410)
    expect(await storedCall(toolCallId)).toMatchObject({ status: 'pending', claimedBy: null })
  })

  it('refuses a local file read once a newer turn closed tool admission', async () => {
    const { runId, streamId } = await startRun()
    const toolCallId = await agentCalls(runId, 'read_local_file', { path: '/tmp/notes.txt' })

    await closeStreamToolAdmission(streamId, userId)

    expect((await desktopClaims(toolCallId)).status).toBe(410)
  })

  it('settles a read of a granted local folder when the user stops', async () => {
    const { runId, streamId } = await startRun()
    const toolCallId = await agentCalls(runId, 'read', { path: 'user-local/Project--mount-1/a.md' })

    await requestRunStop({ userId, workspaceId, streamId, chatId })

    expect(await storedCall(toolCallId)).toMatchObject({ status: 'cancelled' })
    expect((await desktopClaims(toolCallId)).status).toBe(410)
  })

  it('refuses the claim itself once admission closed, so a claim racing Stop cannot win', async () => {
    const { runId, streamId } = await startRun()
    const toolCallId = await agentCalls(runId, 'terminal', { operation: 'read' })

    await closeStreamToolAdmission(streamId, userId)

    expect(await claimPendingAsyncToolCall(toolCallId, 'desktop-terminal')).toBe('admission_closed')
    expect(await storedCall(toolCallId)).toMatchObject({ status: 'pending', claimedBy: null })
  })

  it('wakes the waiting turn when Stop cancels a call the desktop already claimed', async () => {
    const { runId, streamId } = await startRun()
    const toolCallId = await desktopIsRunning(runId, 'terminal')
    const agentAnswer = waitForClientToolCompletion({
      toolCallId,
      runId,
      userId,
      timeoutMs: 10_000,
    })

    await requestRunStop({ userId, workspaceId, streamId, chatId })

    expect(await agentAnswer).toMatchObject({ status: 'cancelled' })
    expect(await storedCall(toolCallId)).toMatchObject({ status: 'cancelled' })
  })

  it('acknowledges a desktop result that lands after Stop without reviving the call', async () => {
    const { runId, streamId } = await startRun()
    const toolCallId = await desktopIsRunning(runId, 'browser_click')
    await requestRunStop({ userId, workspaceId, streamId, chatId })
    expect(await storedCall(toolCallId)).toMatchObject({
      status: 'cancelled',
      result: expect.objectContaining({ outcomeUnknown: true, doNotRetry: true }),
    })

    const lateResult = await reportsResult(toolCallId)

    expect(lateResult.status).toBe(200)
    expect(await lateResult.json()).toMatchObject({ toolCallId, status: 'cancelled' })
    expect(await storedCall(toolCallId)).toMatchObject({ status: 'cancelled' })
  })

  it.each([
    ['a claimed browser action', 'browser_find'],
    ['a local file read', 'read_local_file'],
  ])(
    'acknowledges a retried result delivery for %s without changing the stored outcome',
    async (_label, toolName) => {
      const { runId } = await startRun()
      const toolCallId =
        toolName === 'read_local_file'
          ? await agentCalls(runId, toolName, { path: '/tmp/notes.txt' })
          : await desktopIsRunning(runId, toolName)

      expect((await reportsResult(toolCallId, 'success')).status).toBe(200)
      const retry = await reportsResult(toolCallId, 'error')

      expect(retry.status).toBe(200)
      expect(await retry.json()).toMatchObject({ toolCallId, status: 'success' })
      expect(await storedCall(toolCallId)).toMatchObject({ status: 'completed' })
    }
  )
})
