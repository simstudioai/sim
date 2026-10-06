/**
 * A turn bound to a desktop's background executor, against real PostgreSQL and Redis: the agent's
 * desktop calls are persisted and dispatched by the production stream handlers, the device acts
 * through the executor use cases, the user answers through the tool-permission route, Stop goes
 * through the real `requestRunStop`, and a waiter that dies is settled by the stale-execution cron.
 * Deadlines are moved on the row itself, which is all the server reads.
 */
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedEnv, worker } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const { createServer } = await import('node:http')
  /** Stands in for the agent worker, which Stop also tells to end the stream. */
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ settled: true }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const url = readTestRedisUrl()
  const inheritedEnv = {
    REDIS_URL: process.env.REDIS_URL,
    COPILOT_TOOL_PERMISSIONS_ENABLED: process.env.COPILOT_TOOL_PERMISSIONS_ENABLED,
    SIM_AGENT_API_URL: process.env.SIM_AGENT_API_URL,
  }
  /** The real Redis module, the confirmation channel, the permission flag and worker URL read these at import. */
  if (url) process.env.REDIS_URL = url
  process.env.COPILOT_TOOL_PERMISSIONS_ENABLED = 'true'
  process.env.SIM_AGENT_API_URL = `http://127.0.0.1:${port}`
  return { redisUrl: url, inheritedEnv, worker: { server } }
})

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  auditLog,
  copilotAsyncToolCalls,
  copilotChats,
  copilotRuns,
  desktopDevices,
  permissions,
  session,
  user,
  workspace,
} from '@sim/db/schema'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import {
  claimDesktopTool,
  completeDesktopTool,
  listDesktopInbox,
  registerDesktopDevice,
  renewDesktopToolLease,
  resolveTurnDesktopDevice,
} from '@/lib/desktop/application/executor'
import {
  type DesktopInboxChangeReason,
  onDesktopInboxDoorbell,
} from '@/lib/desktop/executor/doorbell'
import { DesktopCallRevokedError } from '@/lib/desktop/executor/errors'
import { SIM_TOOL_EXECUTION_VERSION } from '@/lib/mothership/async-runs/lifecycle'
import {
  areStreamToolExecutionsSettled,
  claimToolExecution,
  prepareWorkbenchAccess,
  revokeExpiredSimToolExecutions,
} from '@/lib/mothership/async-runs/repository'
import { abortRun } from '@/lib/mothership/request/application/controls'
import { prePersistClientExecutableToolCall, sseHandlers } from '@/lib/mothership/request/handlers'
import { waitForClientToolCompletion } from '@/lib/mothership/request/tools/client'
import { TraceCollector } from '@/lib/mothership/request/trace'
import type { StreamEvent, StreamingContext } from '@/lib/mothership/request/types'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session-key'
import { POST as toolPermissionPOST } from '@/app/api/copilot/tool-permission/route'
import { POST as authorizePOST } from '@/app/api/desktop/tool/authorize/route'
import { runCleanupStaleExecutions } from '@/background/cleanup-stale-executions'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const APP_ORIGIN = 'http://localhost:3000'
const CAPABILITIES = { executor: 1, browser: true, terminal: true, localFiles: true }
/** The turn's budget for a call: far past every deadline a test exercises. */
const TURN_WAIT_MS = 60_000
/** One durable poll of the waiter (5 s), plus slack for a loaded machine. */
const POLL_SETTLES_MS = 8_000

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

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) throw new Error('Timed out waiting for the expected state')
    await sleep(50)
  }
}

async function storedCall(toolCallId: string) {
  const [row] = await db
    .select()
    .from(copilotAsyncToolCalls)
    .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
  return row
}

afterAll(async () => {
  const channels = globalThis as typeof globalThis & {
    _toolConfirmationChannel?: { dispose(): void }
    _toolPermissionChannel?: { dispose(): void }
    _desktopInboxDoorbell?: { dispose(): void }
  }
  for (const name of [
    '_toolConfirmationChannel',
    '_toolPermissionChannel',
    '_desktopInboxDoorbell',
  ] as const) {
    channels[name]?.dispose()
    channels[name] = undefined
  }
  await closeRedisConnection()
  await new Promise<void>((resolve) => worker.server.close(() => resolve()))
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe.runIf(Boolean(redisUrl))("a turn bound to a desktop's background executor", () => {
  const userId = generateId()
  const workspaceId = generateId()
  const chatIds: string[] = []
  const deviceIds: string[] = []

  /** A desktop signed in as the fixture user and registered as an executor. */
  async function signedInDesktop(capabilities: Record<string, unknown> = CAPABILITIES) {
    const sessionId = generateId()
    const now = new Date()
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
    await registerDesktopDevice.execute({
      principal,
      input: {
        deviceId,
        name: 'Fixture Mac',
        appVersion: '0.9.0',
        platform: 'darwin-arm64',
        capabilities: { ...CAPABILITIES, ...capabilities },
      },
    })
    const rings: DesktopInboxChangeReason[] = []
    const stopListening = onDesktopInboxDoorbell(deviceId, (reason) => rings.push(reason))
    return {
      principal,
      deviceId,
      rings,
      stopListening,
      /** The device's inbox pull, which is also what keeps it present. */
      pull: () => listDesktopInbox.execute({ principal, input: { deviceId } }),
      claim: (toolCallId: string) =>
        claimDesktopTool.execute({ principal, input: { deviceId, toolCallId } }),
      renew: (toolCallId: string, executionToken: string) =>
        renewDesktopToolLease.execute({
          principal,
          input: { deviceId, toolCallId, executionToken },
        }),
      complete: (toolCallId: string, executionToken: string, data: unknown) =>
        completeDesktopTool.execute({
          principal,
          input: { deviceId, toolCallId, executionToken, status: 'success', message: 'Done', data },
        }),
    }
  }

  type Desktop = Awaited<ReturnType<typeof signedInDesktop>>

  /** A run admitted with its desktop calls bound to `desktop`, in a new chat or in `chatId`. */
  async function boundRun(desktop: Desktop, existingChatId?: string) {
    const chatId = existingChatId ?? generateId()
    const runId = generateId()
    const streamId = generateId()
    if (!existingChatId) {
      chatIds.push(chatId)
      await db.insert(copilotChats).values({
        id: chatId,
        userId,
        workspaceId,
        type: 'mothership',
        title: 'Bound turn',
        conversationId: streamId,
      })
    }
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
      desktopDeviceId: desktop.deviceId,
    })
    return { chatId, runId, streamId }
  }

  /**
   * The agent issues a desktop call on the run: the production pre-persist and dispatch path,
   * sealed with the turn's secret registry like a live turn. `abortSignal` is the run loop's.
   */
  async function agentCalls(
    run: { runId: string; chatId: string },
    toolName: string,
    args: Record<string, unknown>,
    options: { gated?: boolean; abortSignal?: AbortSignal } = {}
  ) {
    const toolCallId = generateId()
    const context: StreamingContext = {
      runId: run.runId,
      chatId: run.chatId,
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
      toolPermissions: {
        enabled: options.gated === true,
        autoAllowed: new Set(),
        autoAllowPermitted: true,
      },
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
    const registry = new ResolvedSecretTraceRegistry()
    const execContext = {
      userId,
      chatId: run.chatId,
      workspaceId,
      workflowId: generateId(),
      resolvedSecretTraceRegistry: registry,
    }
    const turnOptions = {
      timeout: TURN_WAIT_MS,
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    }
    await prePersistClientExecutableToolCall(event, context, turnOptions, execContext)
    await sseHandlers.tool(event, context, execContext, turnOptions)
    const answer = context.pendingToolPromises.get(toolCallId)
    if (!answer) throw new Error('The desktop call was not dispatched to a waiter')
    return { toolCallId, answer, context, registry }
  }

  /** The turn reads the call's result the way the run loop does: from its settled tool state. */
  function resultOf(context: StreamingContext, toolCallId: string) {
    return context.toolCalls.get(toolCallId)?.result
  }

  /** Waits until the call was offered to the device, which opens its pickup window. */
  const offered = (toolCallId: string) =>
    until(
      () => storedCall(toolCallId),
      (row) => row?.pickupDeadlineAt !== null
    )

  /** Moves a deadline into the past on the database clock, as time passing would. */
  async function lapse(toolCallId: string, column: 'pickup' | 'lease', agoMs = 1_000) {
    const past = sql`clock_timestamp() - ${agoMs} * interval '1 millisecond'`
    await db
      .update(copilotAsyncToolCalls)
      .set(column === 'pickup' ? { pickupDeadlineAt: past } : { executionLeaseExpiresAt: past })
      .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
  }

  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Bound turn fixture',
      email: `${userId}@bound-turn.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Bound turn fixture',
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
      user: { id: userId, email: `${userId}@bound-turn.test`, name: 'Bound turn' },
      session: { id: generateId(), userId },
    })
  })

  beforeEach(() => {
    featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
      async (flag) => flag === 'mothership-desktop-background-executor'
    )
  })

  afterAll(async () => {
    if (chatIds.length > 0) await db.delete(copilotChats).where(inArray(copilotChats.id, chatIds))
    if (deviceIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.resourceId, deviceIds))
      await db.delete(desktopDevices).where(inArray(desktopDevices.id, deviceIds))
    }
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
  })

  it('binds a turn only to an executor registered to this very session, with the flag on', async () => {
    const desktop = await signedInDesktop()
    const viewer = await signedInDesktop({ executor: 0 })
    const otherSession: SessionPrincipal = { ...desktop.principal, sessionId: generateId() }

    expect(await resolveTurnDesktopDevice(desktop.principal, desktop.deviceId)).toBe(
      desktop.deviceId
    )
    expect(await resolveTurnDesktopDevice(otherSession, desktop.deviceId)).toBeNull()
    expect(await resolveTurnDesktopDevice(viewer.principal, viewer.deviceId)).toBeNull()
    featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(false)
    expect(await resolveTurnDesktopDevice(desktop.principal, desktop.deviceId)).toBeNull()
  })

  it(
    'offers a call to its present desktop, and delivers the result it reports',
    async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      await desktop.pull()

      const { toolCallId, answer, context } = await agentCalls(run, 'browser_snapshot', {})
      await offered(toolCallId)
      await until(
        async () => [...desktop.rings],
        (rings) => rings.includes('call')
      )
      const chatView = await post(authorizePOST, '/api/desktop/tool/authorize', { toolCallId })
      const { executionToken } = await desktop.claim(toolCallId)
      await desktop.complete(toolCallId, executionToken, { text: 'the page' })
      await answer

      expect(chatView.status).toBe(409)
      expect(resultOf(context, toolCallId)).toMatchObject({
        success: true,
        output: { text: 'the page' },
      })
    },
    TURN_WAIT_MS
  )

  it(
    'hands a local read to the executor too, whatever the composer declared about reads',
    async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      await desktop.pull()

      const { toolCallId, answer, context } = await agentCalls(run, 'read_local_file', {
        path: '/Users/me/notes.txt',
      })
      await offered(toolCallId)
      const { executionToken } = await desktop.claim(toolCallId)
      await desktop.complete(toolCallId, executionToken, { text: 'notes' })
      await answer

      expect(resultOf(context, toolCallId)).toMatchObject({
        success: true,
        output: { text: 'notes' },
      })
    },
    TURN_WAIT_MS
  )

  it(
    'fails a call at once as not started when its desktop is offline',
    async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      /** Its last pull was minutes ago, and its presence lapsed long since. */
      await db
        .update(desktopDevices)
        .set({ lastSeenAt: sql`now() - interval '10 minutes'` })
        .where(eq(desktopDevices.id, desktop.deviceId))

      const startedAt = Date.now()
      const { toolCallId, answer, context } = await agentCalls(run, 'terminal', {
        operation: 'run',
        args: { command: 'ls' },
      })
      await answer

      expect(Date.now() - startedAt).toBeLessThan(POLL_SETTLES_MS)
      expect(resultOf(context, toolCallId)).toMatchObject({
        success: false,
        output: { notStarted: true, reason: 'offline' },
      })
      expect((await storedCall(toolCallId)).status).toBe('failed')
      await expect(desktop.claim(toolCallId)).rejects.toThrow('no longer waiting')
    },
    TURN_WAIT_MS
  )

  it(
    'fails an offered call as not started once its pickup window closes unclaimed',
    async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      await desktop.pull()

      const { toolCallId, answer, context } = await agentCalls(run, 'browser_click', { ref: 'e1' })
      await offered(toolCallId)
      expect((await storedCall(toolCallId)).status).toBe('pending')
      await lapse(toolCallId, 'pickup')
      /** Before the wait's next check settles it, the closed window already refuses the device. */
      expect((await desktop.pull()).items).toEqual([])
      await expect(desktop.claim(toolCallId)).rejects.toThrow('no longer waiting')
      await answer

      expect(resultOf(context, toolCallId)).toMatchObject({
        success: false,
        output: { notStarted: true, reason: 'not_responding' },
      })
    },
    TURN_WAIT_MS
  )

  it(
    'keeps a renewed call running, and fails one whose lease lapsed as outcome unknown',
    async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      await desktop.pull()

      const { toolCallId, answer, context } = await agentCalls(run, 'terminal', {
        operation: 'run',
        args: { command: 'bun run build' },
      })
      await offered(toolCallId)
      const { executionToken } = await desktop.claim(toolCallId)
      await lapse(toolCallId, 'pickup')
      await sleep(POLL_SETTLES_MS)
      await desktop.renew(toolCallId, executionToken)
      expect((await storedCall(toolCallId)).status).toBe('running')

      await lapse(toolCallId, 'lease')
      /** A Sim tool waiting on the same run sweeps its expired executions; this one is not its. */
      await revokeExpiredSimToolExecutions({ runId: run.runId, userId })
      expect((await storedCall(toolCallId)).status).toBe('running')
      await answer
      const late = await desktop.complete(toolCallId, executionToken, { output: 'built' })

      expect(resultOf(context, toolCallId)).toMatchObject({
        success: false,
        output: { outcomeUnknown: true, doNotRetry: true },
      })
      await until(
        async () => [...desktop.rings],
        (rings) => rings.includes('cancel')
      )
      expect(late).toEqual({ outcome: 'superseded', status: 'failed' })
      await expect(desktop.renew(toolCallId, executionToken)).rejects.toBeInstanceOf(
        DesktopCallRevokedError
      )
    },
    TURN_WAIT_MS
  )

  it(
    'rings the desktop for approval, again on the answer, and offers the call once allowed',
    async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      await desktop.pull()

      const { toolCallId, answer, context } = await agentCalls(
        run,
        'terminal',
        { operation: 'run', args: { command: 'rm -rf build' } },
        { gated: true }
      )
      await until(
        async () => [...desktop.rings],
        (rings) => rings.length > 0
      )
      expect(desktop.rings).toEqual(['approval'])
      expect((await desktop.pull()).items).toMatchObject([
        { kind: 'approval_needed', toolCallId, summary: 'rm -rf build' },
      ])

      const decided = await post(toolPermissionPOST, '/api/copilot/tool-permission', {
        decisions: [{ toolCallId, decision: 'allow' }],
      })
      expect(decided.status).toBe(200)
      await offered(toolCallId)
      await until(
        async () => [...desktop.rings],
        (rings) => rings.length >= 3
      )
      expect(desktop.rings).toEqual(['approval', 'approval', 'call'])
      const { executionToken } = await desktop.claim(toolCallId)
      await desktop.complete(toolCallId, executionToken, { output: 'removed' })
      await answer

      expect(resultOf(context, toolCallId)).toMatchObject({ success: true })
    },
    TURN_WAIT_MS
  )

  it(
    'runs no pickup window while the user decides, and offers the call afresh once allowed',
    async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      await desktop.pull()

      const { toolCallId, answer, context } = await agentCalls(
        run,
        'terminal',
        { operation: 'run', args: { command: 'make release' } },
        { gated: true }
      )
      /** The user takes longer than a pickup window to answer, with a deadline already on the row. */
      await db
        .update(copilotAsyncToolCalls)
        .set({
          createdAt: new Date(Date.now() - 600_000),
          pickupDeadlineAt: sql`now() - interval '5 minutes'`,
        })
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
      await runCleanupStaleExecutions()
      expect((await storedCall(toolCallId)).status).toBe('pending')
      expect((await desktop.pull()).items).toMatchObject([{ kind: 'approval_needed', toolCallId }])

      const decided = await post(toolPermissionPOST, '/api/copilot/tool-permission', {
        decisions: [{ toolCallId, decision: 'allow' }],
      })
      expect(decided.status).toBe(200)
      await until(
        () => storedCall(toolCallId),
        (row) => row.pickupDeadlineAt !== null && row.pickupDeadlineAt.getTime() > Date.now()
      )
      const { executionToken } = await desktop.claim(toolCallId)
      await desktop.complete(toolCallId, executionToken, { output: 'released' })
      await answer

      expect(resultOf(context, toolCallId)).toMatchObject({ success: true })
    },
    TURN_WAIT_MS
  )

  it(
    'ends a running call on Stop without the device, and tells the device to cancel it',
    async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      await desktop.pull()

      const { toolCallId, answer, context } = await agentCalls(run, 'terminal', {
        operation: 'run',
        args: { command: 'bun run dev' },
      })
      await offered(toolCallId)
      const { executionToken } = await desktop.claim(toolCallId)
      await abortRun.execute({
        principal: { kind: 'session', userId, sessionId: generateId() },
        input: { streamId: run.streamId, chatId: run.chatId, workspaceId },
      })
      await answer
      /** Stop rings the device to cancel what it runs; it never acknowledges here. */
      await until(
        async () => [...desktop.rings],
        (rings) => rings.includes('cancel')
      )

      expect(resultOf(context, toolCallId)).toMatchObject({
        success: false,
        output: { outcomeUnknown: true },
      })
      expect((await storedCall(toolCallId)).status).toBe('cancelled')
      /**
       * The device never acknowledges (it is asleep, offline or signed out), yet the stopped turn
       * has no Sim execution left running, and the chat's next turn gets its workbench.
       */
      expect(await areStreamToolExecutionsSettled(run.streamId, userId)).toBe(true)
      const nextTurn = await boundRun(desktop, run.chatId)
      const simCallId = generateId()
      await db.insert(copilotAsyncToolCalls).values({
        runId: nextTurn.runId,
        toolCallId: simCallId,
        toolName: 'run_code',
        args: {},
      })
      const owner = {
        toolCallId: simCallId,
        runId: nextTurn.runId,
        userId,
        ownerToken: generateId(),
      }
      expect(await claimToolExecution(owner)).toEqual({ outcome: 'claimed' })
      await expect(
        prepareWorkbenchAccess({ ...owner, sessionKey: chatSandboxSessionKey(run.chatId) })
      ).resolves.toMatchObject({ handlersPending: false })

      await expect(desktop.renew(toolCallId, executionToken)).rejects.toBeInstanceOf(
        DesktopCallRevokedError
      )
      expect((await desktop.pull()).items).toEqual([{ kind: 'cancel', toolCallId }])
    },
    TURN_WAIT_MS
  )

  it(
    'never fails an awake device’s call early because its presence write was lost',
    async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const redis = getRedisClient()
      if (!redis) throw new Error('Redis is required')
      const writes = vi.spyOn(redis, 'set').mockRejectedValue(new Error('Redis unavailable'))
      try {
        /** The pull succeeds, but its presence write fails: the key reads as absent. */
        await desktop.pull()
      } finally {
        writes.mockRestore()
      }

      const { toolCallId, answer, context } = await agentCalls(run, 'browser_click', { ref: 'e1' })
      await offered(toolCallId)
      await sleep(POLL_SETTLES_MS)
      expect((await storedCall(toolCallId)).status).toBe('pending')
      const { executionToken } = await desktop.claim(toolCallId)
      await desktop.complete(toolCallId, executionToken, { clicked: true })
      await answer

      expect(resultOf(context, toolCallId)).toMatchObject({ success: true })
    },
    TURN_WAIT_MS
  )

  it(
    'enforces the pickup window when presence cannot be read, without failing a call early',
    async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const redis = getRedisClient()
      if (!redis) throw new Error('Redis is required')
      const reads = vi.spyOn(redis, 'exists').mockRejectedValue(new Error('Redis unavailable'))
      try {
        const { toolCallId, answer, context } = await agentCalls(run, 'browser_click', {
          ref: 'e1',
        })
        await offered(toolCallId)
        await sleep(POLL_SETTLES_MS)
        expect((await storedCall(toolCallId)).status).toBe('pending')

        await lapse(toolCallId, 'pickup')
        await answer
        expect(resultOf(context, toolCallId)).toMatchObject({
          success: false,
          output: { notStarted: true, reason: 'not_responding' },
        })
      } finally {
        reads.mockRestore()
      }
    },
    TURN_WAIT_MS
  )

  it(
    'leaves a bound run’s calls the desktop never runs to their own path',
    async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const longAgo = new Date(Date.now() - 600_000)
      const workflowCall = generateId()
      const simFileRead = generateId()
      await db.insert(copilotAsyncToolCalls).values([
        {
          runId: run.runId,
          toolCallId: workflowCall,
          toolName: 'run_workflow',
          args: {},
          createdAt: longAgo,
        },
        {
          runId: run.runId,
          toolCallId: simFileRead,
          toolName: 'read',
          args: { path: 'workspace/notes.md' },
          createdAt: longAgo,
        },
      ])

      await runCleanupStaleExecutions()

      expect((await storedCall(workflowCall)).status).toBe('pending')
      expect((await storedCall(simFileRead)).status).toBe('pending')
    },
    TURN_WAIT_MS
  )

  it(
    'reaches an abandoned desktop call however many older Sim-file reads the run left pending',
    async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      await db.insert(copilotAsyncToolCalls).values(
        Array.from({ length: 201 }, () => ({
          runId: run.runId,
          toolCallId: generateId(),
          toolName: 'read',
          args: { path: 'workspace/notes.md' },
          createdAt: new Date(Date.now() - 900_000),
        }))
      )
      const abandoned = generateId()
      await db.insert(copilotAsyncToolCalls).values({
        runId: run.runId,
        toolCallId: abandoned,
        toolName: 'browser_click',
        args: { ref: 'e1' },
        createdAt: new Date(Date.now() - 600_000),
      })

      await runCleanupStaleExecutions()

      expect((await storedCall(abandoned)).status).toBe('failed')
    },
    TURN_WAIT_MS
  )

  it(
    'still settles a call that stayed overdue for days, however long the backstop missed it',
    async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = generateId()
      await db.insert(copilotAsyncToolCalls).values({
        runId: run.runId,
        toolCallId,
        toolName: 'browser_click',
        args: { ref: 'e1' },
        createdAt: new Date(Date.now() - 2 * 24 * 3_600_000),
      })

      await runCleanupStaleExecutions()

      expect((await storedCall(toolCallId)).status).toBe('failed')
    },
    TURN_WAIT_MS
  )

  it(
    'settles a call whose window lapsed recently on a run that started long ago',
    async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      await db
        .update(copilotRuns)
        .set({ startedAt: new Date(Date.now() - 2 * 24 * 3_600_000) })
        .where(eq(copilotRuns.id, run.runId))
      const toolCallId = generateId()
      await db.insert(copilotAsyncToolCalls).values({
        runId: run.runId,
        toolCallId,
        toolName: 'browser_click',
        args: { ref: 'e1' },
        createdAt: new Date(Date.now() - 600_000),
      })

      await runCleanupStaleExecutions()

      expect((await storedCall(toolCallId)).status).toBe('failed')
    },
    TURN_WAIT_MS
  )

  it(
    'keeps the pickup window of a call that was never gated when a decision is posted for it',
    async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      await desktop.pull()

      const { toolCallId, answer, context } = await agentCalls(run, 'browser_click', { ref: 'e1' })
      const offeredRow = await offered(toolCallId)
      const decided = await post(toolPermissionPOST, '/api/copilot/tool-permission', {
        decisions: [{ toolCallId, decision: 'allow' }],
      })
      expect(decided.status).toBe(200)

      expect((await storedCall(toolCallId)).pickupDeadlineAt).toEqual(offeredRow.pickupDeadlineAt)
      const { executionToken } = await desktop.claim(toolCallId)
      await desktop.complete(toolCallId, executionToken, { clicked: true })
      await answer
      expect(resultOf(context, toolCallId)).toMatchObject({ success: true })
    },
    TURN_WAIT_MS
  )

  it(
    'settles a call Sim never offered once its pickup window would have closed',
    async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      const toolCallId = generateId()
      await db.insert(copilotAsyncToolCalls).values({
        runId: run.runId,
        toolCallId,
        toolName: 'browser_click',
        args: { ref: 'e1' },
        createdAt: new Date(Date.now() - 600_000),
      })

      await runCleanupStaleExecutions()

      expect(await storedCall(toolCallId)).toMatchObject({ status: 'failed' })
    },
    TURN_WAIT_MS
  )

  it(
    'settles a call whose waiter died from the stale-execution cron, sealed for the resumed run',
    async () => {
      const desktop = await signedInDesktop()
      const run = await boundRun(desktop)
      await desktop.pull()

      const runLoop = new AbortController()
      const unclaimed = await agentCalls(
        run,
        'browser_click',
        { ref: 'e1' },
        {
          abortSignal: runLoop.signal,
        }
      )
      const running = await agentCalls(
        run,
        'terminal',
        { operation: 'run', args: { command: 'make' } },
        { abortSignal: runLoop.signal }
      )
      await offered(unclaimed.toolCallId)
      await offered(running.toolCallId)
      await desktop.claim(running.toolCallId)
      runLoop.abort()
      await Promise.all([unclaimed.answer, running.answer])
      expect((await storedCall(unclaimed.toolCallId)).status).toBe('pending')
      expect((await storedCall(running.toolCallId)).status).toBe('running')

      await lapse(unclaimed.toolCallId, 'pickup', 120_000)
      await lapse(running.toolCallId, 'lease', 120_000)
      const swept = await runCleanupStaleExecutions()

      expect(swept.chatRuns.abandonedDesktopCallsSettled).toBeGreaterThanOrEqual(2)
      /** The resumed run waits again with the turn's restored secret registry. */
      const resumed = (call: typeof unclaimed) =>
        waitForClientToolCompletion({
          toolCallId: call.toolCallId,
          runId: run.runId,
          userId,
          timeoutMs: 5_000,
          registry: call.registry,
        })
      expect(await resumed(unclaimed)).toMatchObject({
        status: 'error',
        data: { notStarted: true, reason: 'not_responding' },
      })
      expect(await resumed(running)).toMatchObject({
        status: 'error',
        data: { outcomeUnknown: true, doNotRetry: true },
      })
    },
    TURN_WAIT_MS
  )
})
