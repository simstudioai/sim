import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
/**
 * Sim's own takeover of a Chat run whose controller died with no browser attached (a deploy
 * stopping the process mid-tool), against real Redis and PostgreSQL through the production
 * takeover, reconnect route and chat lifecycle. A local HTTP server stands in for the worker:
 * it answers the new controller's re-attach by re-handing the parked call, as its
 * duplicate-send path does, then answers the tool resume that follows.
 */
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { envFlagsMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedEnv, worker } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const { createServer } = await import('node:http')
  const worker = {
    requests: [] as Array<{ path: string; body: Record<string, unknown> }>,
    /** SSE frames per worker path, per stream: other suites' runs never get this worker's reply. */
    replies: new Map<string, Record<string, unknown[]>>(),
  }
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    const streamId = String(body.messageId ?? body.streamId ?? '')
    const path = request.url ?? ''
    if (path === '/api/streams/explicit-abort') {
      worker.requests.push({ path, body })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ settled: true }))
      return
    }
    const frames = worker.replies.get(streamId)?.[path]
    if (!frames) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'Run not found' }))
      return
    }
    worker.requests.push({ path, body })
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const frame of frames) response.write(`data: ${JSON.stringify(frame)}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const url = readTestRedisUrl()
  const inheritedEnv = {
    REDIS_URL: process.env.REDIS_URL,
    SIM_AGENT_API_URL: process.env.SIM_AGENT_API_URL,
  }
  if (url) process.env.REDIS_URL = url
  process.env.SIM_AGENT_API_URL = `http://127.0.0.1:${port}`
  return { redisUrl: url, inheritedEnv, worker: Object.assign(worker, { server }) }
})

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
/**
 * Recovery's own workspace re-check runs only after authorization passed; `beforeRecheck` lets
 * a test change real access at exactly that point.
 */
const { workspacePermission } = vi.hoisted(() => ({
  workspacePermission: {
    rechecks: 0,
    beforeRecheck: undefined as (() => Promise<void>) | undefined,
  },
}))
vi.mock('@/lib/workspaces/permissions/utils', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/workspaces/permissions/utils')>()
  return {
    ...original,
    getUserEntityPermissions: async (
      ...args: Parameters<typeof original.getUserEntityPermissions>
    ) => {
      workspacePermission.rechecks++
      await workspacePermission.beforeRecheck?.()
      return original.getUserEntityPermissions(...args)
    },
  }
})

import { db } from '@sim/db'
import {
  copilotAsyncToolCalls,
  copilotChats,
  copilotMessages,
  copilotRuns,
  member,
  organization,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { toArray, toRecord } from '@sim/utils/object'
import { and, eq, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import {
  DEADLINE_SIM_TOOL_MESSAGE,
  EXHAUSTED_SIM_TOOL_MESSAGE,
  SIM_TOOL_EXECUTION_MAX_ATTEMPTS,
} from '@/lib/mothership/async-runs/execution-lease'
import {
  ABANDONED_RUN_CURSOR_KEY,
  findAbandonedRecoverableRuns,
  REVOKED_RUN_ERROR,
} from '@/lib/mothership/async-runs/orphaned-runs'
import {
  claimToolExecution,
  claimWorkflowToolExecution,
  prepareWorkbenchAccess,
  recordSimSandboxProcess,
  revokeExhaustedSimToolExecutions,
  revokeExpiredSimToolExecutions,
  upsertAsyncToolCall,
} from '@/lib/mothership/async-runs/repository'
import { createTrustedCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'
import { chatPubSub } from '@/lib/mothership/chat-status'
import { takeOverAbandonedRuns } from '@/lib/mothership/request/application/abandoned-runs'
import {
  RUN_TAKEOVER_AUDIENCE,
  takeOverStreamRun,
} from '@/lib/mothership/request/application/recover-stream'
import {
  createProviderToolCallIdentity,
  scopeProviderToolCallId,
} from '@/lib/mothership/request/go/tool-call-identity'
import { chatStreamLockKey } from '@/lib/mothership/request/session/controller-lease'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session-key'
import { GET as streamGET } from '@/app/api/copilot/chat/stream/route'

const ownerId = generateId()
const userId = generateId()
const workspaceId = generateId()
const organizationId = generateId()
const chatIds: string[] = []
const TOOL_NAME = 'get_credentials'
const TOOL_ARGS = {}

function redis() {
  const client = getRedisClient()
  if (!client) throw new Error('The integration suite requires TEST_REDIS_URL')
  return client
}

function frameFor(streamId: string, chatId: string) {
  return (seq: number, type: string, payload: unknown) => ({
    v: 1,
    type,
    seq,
    ts: new Date().toISOString(),
    stream: { streamId, chatId },
    payload,
  })
}

/**
 * A run whose controller died while its Sim tool was executing: no controller holds the
 * chat, and the tool's execution lease lapsed with no result recorded.
 */
async function runAbandonedMidTool(
  options: {
    attempts?: number
    leaseLive?: boolean
    toolName?: string
    runId?: string
    /** Seconds left of the deadline the worker named when it first handed the call. */
    deadlineInSeconds?: number
  } = {}
) {
  const chatId = generateId()
  chatIds.push(chatId)
  const streamId = generateId()
  const runId = options.runId ?? generateId()
  const request = { message: 'Run the report', userId, messageId: streamId, chatId, workspaceId }
  await db
    .insert(copilotChats)
    .values({ id: chatId, userId, workspaceId, type: 'mothership', conversationId: streamId })
  await db.insert(copilotMessages).values({
    chatId,
    messageId: streamId,
    role: 'user',
    streamId,
    seq: 0,
    content: { id: streamId, role: 'user', content: request.message },
  })
  await db.insert(copilotRuns).values({
    id: runId,
    executionId: generateId(),
    chatId,
    userId,
    workspaceId,
    streamId,
    status: 'paused_waiting_for_tool',
    toolExecutionVersion: 2,
    requestContext: {
      requestId: generateId(),
      controllerToken: `${streamId}\n${generateId()}`,
      recovery: {
        kind: 'interactive_stream',
        request,
        goRoute: '/api/mothership',
        clientToolPickupExpected: false,
      },
    },
  })
  const toolCallId = scopeProviderToolCallId('sim-call', createProviderToolCallIdentity(runId))
  await upsertAsyncToolCall({
    runId,
    toolCallId,
    toolName: options.toolName ?? TOOL_NAME,
    args: TOOL_ARGS,
  })
  expect(
    await claimToolExecution({ toolCallId, runId, userId, ownerToken: 'dead-controller' })
  ).toEqual({ outcome: 'claimed' })
  await db
    .update(copilotAsyncToolCalls)
    .set({
      executionAttempts: options.attempts ?? 1,
      ...(options.deadlineInSeconds === undefined
        ? {}
        : {
            executionDeadlineAt: sql`clock_timestamp() + ${options.deadlineInSeconds} * interval '1 second'`,
          }),
      ...(options.leaseLive
        ? {}
        : { executionLeaseExpiresAt: sql`clock_timestamp() - interval '1 second'` }),
    })
    .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
  /** Its controller last wrote the run before it died, longer ago than a chat lock lives. */
  await db
    .update(copilotRuns)
    .set({ updatedAt: sql`now() - interval '2 minutes'` })
    .where(eq(copilotRuns.id, runId))

  const frame = frameFor(streamId, chatId)
  const text = 'Running the report. '
  worker.replies.set(streamId, {
    '/api/mothership': [
      frame(1, 'session', { kind: 'start' }),
      frame(2, 'text', { channel: 'assistant', text, textOffset: 0 }),
      frame(3, 'tool', {
        phase: 'call',
        toolCallId: 'sim-call',
        toolName: TOOL_NAME,
        executor: 'sim',
        mode: 'async',
        arguments: TOOL_ARGS,
        ...(options.deadlineInSeconds === undefined ? {} : { deadlineMs: 900_000 }),
      }),
      frame(4, 'run', {
        kind: 'checkpoint_pause',
        checkpointId: generateId(),
        executionId: generateId(),
        runId: generateId(),
        pendingToolCallIds: ['sim-call'],
      }),
    ],
    '/api/tools/resume': [
      frame(5, 'text', { channel: 'assistant', text: 'done', textOffset: text.length }),
      frame(6, 'complete', { status: 'complete', textLength: text.length + 4 }),
    ],
  })
  return { chatId, streamId, runId, toolCallId }
}

async function storedRun(runId: string) {
  const [run] = await db
    .select({
      status: copilotRuns.status,
      error: copilotRuns.error,
      requestContext: copilotRuns.requestContext,
    })
    .from(copilotRuns)
    .where(eq(copilotRuns.id, runId))
  return run
}

async function storedTool(toolCallId: string) {
  const [tool] = await db
    .select({
      status: copilotAsyncToolCalls.status,
      attempts: copilotAsyncToolCalls.executionAttempts,
      ownerToken: copilotAsyncToolCalls.executionOwnerToken,
      error: copilotAsyncToolCalls.error,
      deadlineAt: copilotAsyncToolCalls.executionDeadlineAt,
    })
    .from(copilotAsyncToolCalls)
    .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
  return tool
}

async function waitForTerminal(runId: string) {
  let status: string | undefined
  for (let attempt = 0; attempt < 200; attempt++) {
    status = (await storedRun(runId))?.status
    if (status === 'complete' || status === 'error' || status === 'cancelled') return status
    await sleep(100)
  }
  return status
}

function requestsFor(streamId: string, path: string) {
  return worker.requests.filter(
    (request) =>
      request.path === path && (request.body.messageId ?? request.body.streamId) === streamId
  )
}

function resumedResult(streamId: string) {
  const resumes = requestsFor(streamId, '/api/tools/resume')
  expect(resumes).toHaveLength(1)
  const results = toArray(resumes[0].body.results).map((result) => toRecord(result))
  expect(results).toHaveLength(1)
  expect(results[0].callId).toBe('sim-call')
  return results[0]
}

function expectResumedSuccess(streamId: string) {
  const result = resumedResult(streamId)
  expect(result.success, JSON.stringify(result.data)).toBe(true)
}

/** Runs whether or not the suite does, so a skipped suite never leaks the worker or env. */
afterAll(async () => {
  await new Promise<void>((resolve) => worker.server.close(() => resolve()))
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe.runIf(Boolean(redisUrl))('taking over a run whose controller died', () => {
  beforeAll(async () => {
    const now = new Date()
    for (const id of [ownerId, userId]) {
      await db.insert(user).values({
        id,
        name: 'Run takeover fixture',
        email: `${id}@run-takeover.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
    }
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Run takeover fixture',
      ownerId,
      billedAccountUserId: ownerId,
    })
    await db
      .insert(organization)
      .values({ id: organizationId, name: 'Run takeover fixture', slug: organizationId })
    await db
      .insert(member)
      .values({ id: generateId(), organizationId, userId: ownerId, role: 'owner' })
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: userId },
      session: { id: generateId() },
    })
  })

  beforeEach(async () => {
    worker.requests.length = 0
    resetEnvFlagsMock()
    featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(false)
    workspacePermission.rechecks = 0
    workspacePermission.beforeRecheck = undefined
    await redis().del(ABANDONED_RUN_CURSOR_KEY)
    await db
      .insert(permissions)
      .values({
        id: generateId(),
        userId,
        entityType: 'workspace',
        entityId: workspaceId,
        permissionType: 'write',
      })
      .onConflictDoNothing()
  })

  afterAll(async () => {
    for (const chatId of chatIds) {
      await db.delete(copilotMessages).where(eq(copilotMessages.chatId, chatId))
      await db.delete(copilotRuns).where(eq(copilotRuns.chatId, chatId))
      await db.delete(copilotChats).where(eq(copilotChats.id, chatId))
    }
    await db.delete(permissions).where(eq(permissions.entityId, workspaceId))
    await db.delete(member).where(eq(member.organizationId, organizationId))
    await db.delete(organization).where(eq(organization.id, organizationId))
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    for (const id of [ownerId, userId]) await db.delete(user).where(eq(user.id, id))
    chatPubSub?.dispose()
    await closeRedisConnection()
  })

  it('re-runs the tool its dead controller was executing and finishes the run', async () => {
    const { streamId, runId, toolCallId } = await runAbandonedMidTool()

    await takeOverAbandonedRuns()

    expect(await waitForTerminal(runId)).toBe('complete')
    expect(requestsFor(streamId, '/api/mothership')).toHaveLength(1)
    expectResumedSuccess(streamId)
    const tool = await storedTool(toolCallId)
    expect(tool.status).toBe('completed')
    expect(tool.attempts).toBe(2)
    expect(tool.ownerToken).not.toBe('dead-controller')
  })

  it('never takes over a run whose controller still holds its chat', async () => {
    const { chatId, streamId, runId, toolCallId } = await runAbandonedMidTool()
    const before = await storedRun(runId)
    const lock = String(toRecord(before.requestContext).controllerToken)
    await redis().set(chatStreamLockKey(chatId), lock, 'EX', 60)
    try {
      await takeOverAbandonedRuns()
      await sleep(500)

      expect(requestsFor(streamId, '/api/mothership')).toHaveLength(0)
      expect(await storedRun(runId)).toEqual(before)
      expect((await storedTool(toolCallId)).attempts).toBe(1)
    } finally {
      await redis().del(chatStreamLockKey(chatId))
      await db.update(copilotRuns).set({ status: 'cancelled' }).where(eq(copilotRuns.id, runId))
    }
  })

  it('waits for a still-leased Sim tool to lapse before taking the run over', async () => {
    const { streamId, runId, toolCallId } = await runAbandonedMidTool({ leaseLive: true })

    await takeOverAbandonedRuns()
    await sleep(500)
    expect(requestsFor(streamId, '/api/mothership')).toHaveLength(0)
    expect((await storedTool(toolCallId)).attempts).toBe(1)

    await db
      .update(copilotAsyncToolCalls)
      .set({ executionLeaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
    await takeOverAbandonedRuns()

    expect(await waitForTerminal(runId)).toBe('complete')
    expectResumedSuccess(streamId)
    expect((await storedTool(toolCallId)).attempts).toBe(2)
  })

  it('starts one controller when a browser reconnect races the takeover', async () => {
    const { streamId, runId, toolCallId } = await runAbandonedMidTool()

    const [reconnect] = await Promise.all([
      streamGET(
        new NextRequest(
          `http://localhost:3000/api/copilot/chat/stream?streamId=${streamId}&after=0`
        ),
        { params: Promise.resolve({}) }
      ),
      takeOverAbandonedRuns(),
    ])
    await reconnect.body?.cancel()

    expect(await waitForTerminal(runId)).toBe('complete')
    expect(requestsFor(streamId, '/api/mothership')).toHaveLength(1)
    expectResumedSuccess(streamId)
    expect((await storedTool(toolCallId)).attempts).toBe(2)
  })

  it('settles the run as an error and stops the worker once its user lost access', async () => {
    const { chatId, streamId, runId, toolCallId } = await runAbandonedMidTool()
    await db
      .delete(permissions)
      .where(and(eq(permissions.userId, userId), eq(permissions.entityId, workspaceId)))

    await takeOverAbandonedRuns()

    const run = await storedRun(runId)
    expect(run.status).toBe('error')
    expect(run.error).toBe(REVOKED_RUN_ERROR)
    expect(requestsFor(streamId, '/api/mothership')).toHaveLength(0)
    expect(requestsFor(streamId, '/api/streams/explicit-abort')).toHaveLength(1)
    expect((await storedTool(toolCallId)).attempts).toBe(1)
    const [chat] = await db
      .select({ conversationId: copilotChats.conversationId })
      .from(copilotChats)
      .where(eq(copilotChats.id, chatId))
    expect(chat.conversationId).toBeNull()
  })

  it('fails a tool that already died with its executor every time it may run', async () => {
    const { streamId, runId, toolCallId } = await runAbandonedMidTool({
      attempts: SIM_TOOL_EXECUTION_MAX_ATTEMPTS,
    })

    await takeOverAbandonedRuns()

    expect(await waitForTerminal(runId)).toBe('complete')
    const result = resumedResult(streamId)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result)).toContain(EXHAUSTED_SIM_TOOL_MESSAGE)
    const tool = await storedTool(toolCallId)
    expect(tool.status).toBe('failed')
    expect(tool.attempts).toBe(SIM_TOOL_EXECUTION_MAX_ATTEMPTS)
  })

  it('fails an interrupted tool whose deadline leaves too little time to run it again', async () => {
    const { streamId, runId, toolCallId } = await runAbandonedMidTool({ deadlineInSeconds: 30 })

    await takeOverAbandonedRuns()

    expect(await waitForTerminal(runId)).toBe('complete')
    const result = resumedResult(streamId)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result)).toContain(DEADLINE_SIM_TOOL_MESSAGE)
    expect(await storedTool(toolCallId)).toMatchObject({ status: 'failed', attempts: 1 })
  })

  it('runs an interrupted tool again within what remains of its first deadline', async () => {
    const { streamId, runId, toolCallId } = await runAbandonedMidTool({ deadlineInSeconds: 600 })
    const recorded = (await storedTool(toolCallId)).deadlineAt

    await takeOverAbandonedRuns()

    expect(await waitForTerminal(runId)).toBe('complete')
    expectResumedSuccess(streamId)
    expect(await storedTool(toolCallId)).toMatchObject({ attempts: 2, deadlineAt: recorded })
  })

  /**
   * A workflow tool reaches the Sim executor through the browser-or-server pickup race; the
   * dead controller's server run left it claimed, so only the server may pick it up again.
   */
  it('lets only the server pick up an interrupted workflow run again', async () => {
    const { runId, toolCallId } = await runAbandonedMidTool({ toolName: 'run_workflow' })
    try {
      expect(await claimWorkflowToolExecution(toolCallId, generateId(), 'client')).toBeNull()
      expect(await claimWorkflowToolExecution(toolCallId, generateId(), 'sim')).not.toBeNull()
      expect(
        await claimToolExecution({ toolCallId, runId, userId, ownerToken: 'successor' })
      ).toEqual({ outcome: 'claimed' })
      expect(await storedTool(toolCallId)).toMatchObject({ attempts: 2, ownerToken: 'successor' })
    } finally {
      await db.update(copilotRuns).set({ status: 'cancelled' }).where(eq(copilotRuns.id, runId))
    }
  })

  it.each([
    [30, false],
    [600, true],
  ])(
    'a browser claims a workflow call with %is of its deadline left: %s',
    async (seconds, claimable) => {
      const { runId, toolCallId } = await runAbandonedMidTool({ toolName: 'run_workflow' })
      /** Offered to a browser and not yet picked up, with `seconds` of its deadline left. */
      await db
        .update(copilotAsyncToolCalls)
        .set({
          claimedBy: null,
          executionStartedAt: null,
          executionOwnerToken: null,
          executionDeadlineAt: sql`clock_timestamp() + ${seconds} * interval '1 second'`,
        })
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
      try {
        const claim = await claimWorkflowToolExecution(toolCallId, generateId(), 'client')
        expect(claim !== null).toBe(claimable)
      } finally {
        await db.update(copilotRuns).set({ status: 'cancelled' }).where(eq(copilotRuns.id, runId))
      }
    }
  )

  it('fails an exhausted workflow run before a takeover offers it to anyone', async () => {
    const { runId, toolCallId } = await runAbandonedMidTool({
      toolName: 'run_workflow',
      attempts: SIM_TOOL_EXECUTION_MAX_ATTEMPTS,
    })
    try {
      expect(await claimWorkflowToolExecution(toolCallId, generateId(), 'sim')).toBeNull()
      await revokeExhaustedSimToolExecutions(runId)
      expect(await storedTool(toolCallId)).toMatchObject({
        status: 'failed',
        error: EXHAUSTED_SIM_TOOL_MESSAGE,
      })
    } finally {
      await db.update(copilotRuns).set({ status: 'cancelled' }).where(eq(copilotRuns.id, runId))
    }
  })

  it('reaches an abandoned run behind live ones, examining a bounded window per scan', async () => {
    /** The lowest ids, so the scan meets the two live runs before the abandoned one. */
    const ids = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`)
    const live = [
      await runAbandonedMidTool({ runId: ids[0] }),
      await runAbandonedMidTool({ runId: ids[1] }),
    ]
    const abandoned = await runAbandonedMidTool({ runId: ids[2] })
    for (const run of live) {
      await redis().set(chatStreamLockKey(run.chatId), `${run.streamId}\nlive`, 'EX', 60)
    }
    try {
      const bound = { pageSize: 2, maxExamined: 2 }
      expect(await findAbandonedRecoverableRuns(1, bound)).toEqual([])
      expect((await findAbandonedRecoverableRuns(1, bound)).map((run) => run.id)).toEqual([
        abandoned.runId,
      ])
    } finally {
      for (const run of [...live, abandoned]) {
        await redis().del(chatStreamLockKey(run.chatId))
        await db
          .update(copilotRuns)
          .set({ status: 'cancelled' })
          .where(eq(copilotRuns.id, run.runId))
      }
    }
  })

  it("hands a re-run the earlier attempt's workbench commands to stop first", async () => {
    const { chatId, runId, toolCallId } = await runAbandonedMidTool({ leaseLive: true })
    const sessionKey = chatSandboxSessionKey(chatId)
    try {
      await recordSimSandboxProcess({
        toolCallId,
        runId,
        userId,
        ownerToken: 'dead-controller',
        process: { id: 'earlier-command', sandboxId: 'sandbox-1', sessionKey },
      })
      await db
        .update(copilotAsyncToolCalls)
        .set({ executionLeaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
      const successor = { toolCallId, runId, userId, ownerToken: 'successor' }
      expect(await claimToolExecution(successor)).toEqual({ outcome: 'claimed' })
      await recordSimSandboxProcess({
        ...successor,
        process: { id: 'own-command', sandboxId: 'sandbox-1', sessionKey },
      })

      const state = await prepareWorkbenchAccess({ ...successor, sessionKey })

      expect(state.processes.map((process) => process.id)).toEqual(['earlier-command'])
    } finally {
      await db.update(copilotRuns).set({ status: 'cancelled' }).where(eq(copilotRuns.id, runId))
    }
  })

  it('claims no run once its caller is shutting down', async () => {
    const { chatId, streamId, runId, toolCallId } = await runAbandonedMidTool()
    const before = await storedRun(runId)
    const shutdown = new AbortController()
    shutdown.abort()
    const principal = createTrustedCopilotPrincipal(
      { userId, workspaceId, chatId, delegationId: `test:${runId}` },
      { audience: RUN_TAKEOVER_AUDIENCE, ttlMs: 60_000 }
    )
    try {
      await expect(
        takeOverStreamRun.execute({
          principal,
          input: { streamId },
          request: { headers: new Headers(), signal: shutdown.signal },
        })
      ).rejects.toThrow()

      expect(await storedRun(runId)).toEqual(before)
      expect(requestsFor(streamId, '/api/mothership')).toHaveLength(0)
      expect((await storedTool(toolCallId)).attempts).toBe(1)
      expect(await redis().get(chatStreamLockKey(chatId))).toBeNull()
    } finally {
      await db.update(copilotRuns).set({ status: 'cancelled' }).where(eq(copilotRuns.id, runId))
    }
  })

  it('leaves a run recoverable when its takeover fails for a reason other than access', async () => {
    /** Hosted recovery refuses a run saved without its billing admission. */
    setEnvFlags({ isHosted: true })
    const { streamId, runId } = await runAbandonedMidTool()
    const before = await storedRun(runId)
    try {
      await takeOverAbandonedRuns()

      expect(await storedRun(runId)).toEqual(before)
      expect(requestsFor(streamId, '/api/streams/explicit-abort')).toHaveLength(0)
      expect(requestsFor(streamId, '/api/mothership')).toHaveLength(0)
    } finally {
      await db.update(copilotRuns).set({ status: 'cancelled' }).where(eq(copilotRuns.id, runId))
    }
  })

  it('re-claims a server workflow claim whose claimant died before starting it, once', async () => {
    const chatId = generateId()
    chatIds.push(chatId)
    const runId = generateId()
    const streamId = generateId()
    await db.insert(copilotChats).values({ id: chatId, userId, workspaceId, type: 'mothership' })
    await db.insert(copilotRuns).values({
      id: runId,
      executionId: generateId(),
      chatId,
      userId,
      workspaceId,
      streamId,
      status: 'paused_waiting_for_tool',
      toolExecutionVersion: 2,
    })
    const toolCallId = scopeProviderToolCallId(
      'workflow-call',
      createProviderToolCallIdentity(runId)
    )
    await upsertAsyncToolCall({ runId, toolCallId, toolName: 'run_workflow', args: {} })
    await db
      .update(copilotAsyncToolCalls)
      .set({ status: 'running' })
      .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
    try {
      /** The dead controller's server fallback claimed the call, then died before starting it. */
      expect(await claimWorkflowToolExecution(toolCallId, generateId(), 'sim')).not.toBeNull()

      expect(await claimWorkflowToolExecution(toolCallId, generateId(), 'client')).toBeNull()
      expect(await claimWorkflowToolExecution(toolCallId, generateId(), 'sim')).not.toBeNull()
      const successor = { toolCallId, runId, userId, ownerToken: 'successor' }
      expect(await claimToolExecution(successor)).toEqual({ outcome: 'claimed' })
      expect(await claimToolExecution({ ...successor, ownerToken: 'late-claimant' })).toEqual({
        outcome: 'existing',
      })
      expect(await claimWorkflowToolExecution(toolCallId, generateId(), 'sim')).toBeNull()
      expect(await storedTool(toolCallId)).toMatchObject({ attempts: 1, ownerToken: 'successor' })
    } finally {
      await db.update(copilotRuns).set({ status: 'cancelled' }).where(eq(copilotRuns.id, runId))
    }
  })

  it('adopts nothing while the takeover kill switch is on', async () => {
    featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
      async (flag) => flag === 'mothership-abandoned-run-takeover-disabled'
    )
    const { streamId, runId, toolCallId } = await runAbandonedMidTool()
    const before = await storedRun(runId)
    try {
      await takeOverAbandonedRuns()

      expect(await storedRun(runId)).toEqual(before)
      expect(requestsFor(streamId, '/api/mothership')).toHaveLength(0)
      expect((await storedTool(toolCallId)).attempts).toBe(1)
    } finally {
      await db.update(copilotRuns).set({ status: 'cancelled' }).where(eq(copilotRuns.id, runId))
    }
  })

  it("spares a call awaiting its re-run when a sibling's wait or workbench access revokes", async () => {
    const {
      chatId,
      runId,
      toolCallId: interrupted,
    } = await runAbandonedMidTool({ leaseLive: true })
    const sessionKey = chatSandboxSessionKey(chatId)
    const sibling = scopeProviderToolCallId('sibling-call', createProviderToolCallIdentity(runId))
    try {
      await recordSimSandboxProcess({
        toolCallId: interrupted,
        runId,
        userId,
        ownerToken: 'dead-controller',
        process: { id: 'interrupted-command', sandboxId: 'sandbox-1', sessionKey },
      })
      await db
        .update(copilotAsyncToolCalls)
        .set({ executionLeaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
        .where(eq(copilotAsyncToolCalls.toolCallId, interrupted))
      await upsertAsyncToolCall({ runId, toolCallId: sibling, toolName: TOOL_NAME, args: {} })
      const siblingOwner = { toolCallId: sibling, runId, userId, ownerToken: 'sibling' }
      expect(await claimToolExecution(siblingOwner)).toEqual({ outcome: 'claimed' })

      /** The re-handed sibling runs first: its wait and its workbench access both revoke. */
      await revokeExpiredSimToolExecutions({ runId, userId, toolCallId: sibling })
      const state = await prepareWorkbenchAccess({ ...siblingOwner, sessionKey })

      expect(state.handlersPending).toBe(false)
      expect(state.processes.map((process) => process.id)).toEqual(['interrupted-command'])
      expect((await storedTool(interrupted)).status).toBe('running')
      expect(
        await claimToolExecution({
          toolCallId: interrupted,
          runId,
          userId,
          ownerToken: 'successor',
        })
      ).toEqual({ outcome: 'claimed' })
    } finally {
      await db.update(copilotRuns).set({ status: 'cancelled' }).where(eq(copilotRuns.id, runId))
    }
  })

  it('settles the run as revoked when access is lost after authorization passed', async () => {
    const { streamId, runId, toolCallId } = await runAbandonedMidTool()
    /** The user is removed from the workspace after authorization admitted them. */
    workspacePermission.beforeRecheck = async () => {
      await db
        .delete(permissions)
        .where(and(eq(permissions.userId, userId), eq(permissions.entityId, workspaceId)))
    }

    await takeOverAbandonedRuns()

    expect(workspacePermission.rechecks).toBe(1)

    const run = await storedRun(runId)
    expect(run.status).toBe('error')
    expect(run.error).toBe(REVOKED_RUN_ERROR)
    expect(requestsFor(streamId, '/api/mothership')).toHaveLength(0)
    expect(requestsFor(streamId, '/api/streams/explicit-abort')).toHaveLength(1)
    expect((await storedTool(toolCallId)).attempts).toBe(1)
  })

  describe('an organization Assistant run', () => {
    async function runAbandonedInOrganization() {
      const chatId = generateId()
      chatIds.push(chatId)
      const streamId = generateId()
      const runId = generateId()
      const request = {
        message: 'Find the report',
        userId,
        messageId: streamId,
        chatId,
        organizationId,
        mode: 'assistant',
      }
      await db.insert(copilotChats).values({
        id: chatId,
        userId,
        organizationId,
        type: 'mothership',
        conversationId: streamId,
      })
      await db.insert(copilotRuns).values({
        id: runId,
        executionId: generateId(),
        chatId,
        userId,
        organizationId,
        streamId,
        status: 'active',
        toolExecutionVersion: 2,
        updatedAt: new Date(Date.now() - 120_000),
        requestContext: {
          requestId: generateId(),
          controllerToken: `${streamId}\n${generateId()}`,
          recovery: {
            kind: 'interactive_stream',
            request,
            goRoute: '/api/mothership',
            clientToolPickupExpected: false,
          },
        },
      })
      const frame = frameFor(streamId, chatId)
      const text = 'Here is the report.'
      worker.replies.set(streamId, {
        '/api/mothership': [
          frame(1, 'session', { kind: 'start' }),
          frame(2, 'text', { channel: 'assistant', text, textOffset: 0 }),
          frame(3, 'complete', { status: 'complete', textLength: text.length }),
        ],
      })
      return { streamId, runId }
    }

    it('takes over a member’s run as that member', async () => {
      await db.insert(member).values({ id: generateId(), organizationId, userId, role: 'member' })
      const { streamId, runId } = await runAbandonedInOrganization()
      try {
        await takeOverAbandonedRuns()

        expect(await waitForTerminal(runId)).toBe('complete')
        expect(requestsFor(streamId, '/api/mothership')).toHaveLength(1)
      } finally {
        await db
          .delete(member)
          .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
      }
    })

    it('settles a removed member’s run as revoked', async () => {
      const { streamId, runId } = await runAbandonedInOrganization()

      await takeOverAbandonedRuns()

      const run = await storedRun(runId)
      expect(run.status).toBe('error')
      expect(run.error).toBe(REVOKED_RUN_ERROR)
      expect(requestsFor(streamId, '/api/mothership')).toHaveLength(0)
      expect(requestsFor(streamId, '/api/streams/explicit-abort')).toHaveLength(1)
    })
  })
})
