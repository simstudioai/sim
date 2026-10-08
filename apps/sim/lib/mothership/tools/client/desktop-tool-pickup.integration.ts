/**
 * A desktop tool call reaches the user's machine only through the chat view that is showing that
 * chat. When nothing picks the call up (the user is on another chat, another page, or the app is
 * closed) the turn must learn quickly and truthfully that the call never started, instead of
 * hanging until a watchdog calls it "hung". Runs against real PostgreSQL and Redis: the call is
 * persisted and dispatched by the production stream handlers, the desktop claims it through the
 * authorize route and reports through the confirm route.
 */
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedEnv } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const url = readTestRedisUrl()
  const inheritedEnv = { REDIS_URL: process.env.REDIS_URL }
  /** The real Redis module and the confirmation channel read this at import. */
  if (url) process.env.REDIS_URL = url
  return { redisUrl: url, inheritedEnv }
})

vi.mock('@/lib/auth', () => authMock)

import { db } from '@sim/db'
import { copilotAsyncToolCalls, copilotChats, copilotRuns, user, workspace } from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { closeRedisConnection } from '@/lib/core/config/redis'
import { SIM_TOOL_EXECUTION_VERSION } from '@/lib/mothership/async-runs/lifecycle'
import { prePersistClientExecutableToolCall, sseHandlers } from '@/lib/mothership/request/handlers'
import { TraceCollector } from '@/lib/mothership/request/trace'
import type { StreamEvent, StreamingContext } from '@/lib/mothership/request/types'
import { POST as confirmPOST } from '@/app/api/copilot/confirm/route'
import { POST as authorizePOST } from '@/app/api/desktop/tool/authorize/route'

const APP_ORIGIN = 'http://localhost:3000'
/** Longer than the pickup grace, far shorter than the budget the call used to wait out. */
const TURN_WAIT_MS = 25_000

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

const desktopClaims = (toolCallId: string, claim?: true) =>
  post(authorizePOST, '/api/desktop/tool/authorize', { toolCallId, ...(claim ? { claim } : {}) })

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

describe.runIf(Boolean(redisUrl))('a desktop tool call nobody picks up', () => {
  const userId = generateId()
  const workspaceId = generateId()
  const chatId = generateId()
  const runId = generateId()

  /** The agent issues a desktop call: the production pre-persist and dispatch path. */
  /** `desktopClaimsLocalReads`: the turn came from a desktop that claims its local reads. */
  async function agentCalls(
    toolName: string,
    args: Record<string, unknown>,
    desktopClaimsLocalReads = false
  ) {
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
    const event: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId,
        toolName,
        arguments: args,
        executor: 'client',
        mode: 'async',
        phase: 'call',
      },
    }
    const options = { timeout: TURN_WAIT_MS, desktopClaimsLocalReads }
    await prePersistClientExecutableToolCall(event, context, options)
    await sseHandlers.tool(
      event,
      context,
      { userId, chatId, workspaceId, workflowId: generateId() },
      options
    )
    const answer = context.pendingToolPromises.get(toolCallId)
    if (!answer) throw new Error('The desktop call was not dispatched to a client waiter')
    return { toolCallId, answer }
  }

  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Desktop pickup fixture',
      email: `${userId}@desktop-pickup.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Desktop pickup fixture',
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
    await db.insert(copilotRuns).values({
      id: runId,
      executionId: generateId(),
      chatId,
      userId,
      workspaceId,
      streamId: generateId(),
      toolExecutionVersion: SIM_TOOL_EXECUTION_VERSION,
      status: 'paused_waiting_for_tool',
      requestContext: { source: 'headless_lifecycle' },
    })
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: userId, email: `${userId}@desktop-pickup.test`, name: 'Desktop pickup' },
      session: { id: generateId(), userId },
    })
  })

  afterAll(async () => {
    await db.delete(copilotChats).where(eq(copilotChats.id, chatId))
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
  })

  it.each([
    ['browser_snapshot', {}],
    ['terminal', { operation: 'run', args: { command: 'ls' } }],
  ])(
    'tells the agent a %s call never started, and refuses a late pickup',
    async (toolName, args) => {
      const startedAt = Date.now()
      const { toolCallId, answer } = await agentCalls(toolName, args)

      const completion = await answer

      expect(Date.now() - startedAt).toBeLessThan(TURN_WAIT_MS - 5_000)
      expect(completion).toMatchObject({
        status: 'error',
        data: { notStarted: true, error: expect.stringContaining('never started') },
      })
      const [row] = await db
        .select({ status: copilotAsyncToolCalls.status })
        .from(copilotAsyncToolCalls)
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
      expect(row.status).toBe('failed')
      expect((await desktopClaims(toolCallId)).ok).toBe(false)
    },
    TURN_WAIT_MS + 10_000
  )

  it(
    'keeps waiting for a call the desktop picked up in time, past the pickup grace',
    async () => {
      const { toolCallId, answer } = await agentCalls('browser_snapshot', {})
      expect((await desktopClaims(toolCallId)).status).toBe(200)

      await sleep(17_000)
      const report = await post(confirmPOST, '/api/copilot/confirm', {
        toolCallId,
        status: 'success',
        message: 'Done',
        data: { text: 'page' },
      })

      expect(report.status).toBe(200)
      expect(await answer).toMatchObject({ status: 'success' })
    },
    TURN_WAIT_MS + 10_000
  )

  it(
    'never lets a stale "not started" report end a call the desktop is running',
    async () => {
      const { toolCallId, answer } = await agentCalls('terminal', {
        operation: 'run',
        args: { command: 'bun run test' },
      })
      expect((await desktopClaims(toolCallId)).status).toBe(200)

      const staleReport = await post(confirmPOST, '/api/copilot/confirm', {
        toolCallId,
        status: 'error',
        message: 'Not run: delivered too late',
        data: { error: 'Not run: delivered too late', notStarted: true },
      })
      const realResult = await post(confirmPOST, '/api/copilot/confirm', {
        toolCallId,
        status: 'success',
        message: 'Done',
        data: { output: 'tests passed' },
      })

      expect(staleReport.status).toBe(409)
      expect(realResult.status).toBe(200)
      expect(await answer).toMatchObject({ status: 'success' })
    },
    TURN_WAIT_MS + 10_000
  )

  it(
    'tells the agent a local read nobody picked up never started, for a desktop that claims reads',
    async () => {
      const startedAt = Date.now()
      const { toolCallId, answer } = await agentCalls(
        'read_local_file',
        { path: '/Users/me/notes.txt' },
        true
      )

      const completion = await answer

      expect(Date.now() - startedAt).toBeLessThan(TURN_WAIT_MS - 5_000)
      expect(completion).toMatchObject({ status: 'error', data: { notStarted: true } })
      expect((await desktopClaims(toolCallId, true)).ok).toBe(false)
    },
    TURN_WAIT_MS + 10_000
  )

  it(
    'lets a desktop that claimed a local read keep reading it, past the pickup grace',
    async () => {
      const { toolCallId, answer } = await agentCalls(
        'grep',
        { path: 'user-local/Project--mount-1', pattern: 'TODO' },
        true
      )

      expect((await desktopClaims(toolCallId, true)).status).toBe(200)
      await sleep(17_000)
      expect((await desktopClaims(toolCallId, true)).status).toBe(200)
      const report = await post(confirmPOST, '/api/copilot/confirm', {
        toolCallId,
        status: 'success',
        message: 'Done',
        data: { matches: [] },
      })

      expect(report.status).toBe(200)
      expect(await answer).toMatchObject({ status: 'success' })
    },
    TURN_WAIT_MS + 10_000
  )

  it(
    'reads as before for a desktop that does not claim local reads',
    async () => {
      const { toolCallId, answer } = await agentCalls('read_local_file', {
        path: '/Users/me/notes.txt',
      })

      expect((await desktopClaims(toolCallId)).status).toBe(200)
      const report = await post(confirmPOST, '/api/copilot/confirm', {
        toolCallId,
        status: 'success',
        message: 'Done',
        data: { text: 'notes' },
      })

      expect(report.status).toBe(200)
      expect(await answer).toMatchObject({ status: 'success' })
    },
    TURN_WAIT_MS + 10_000
  )
})
