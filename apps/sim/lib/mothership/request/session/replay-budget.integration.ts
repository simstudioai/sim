/**
 * The leased Chat stream writer and its replay-budget failure path against real
 * Redis and PostgreSQL. A local HTTP server stands in for the worker's abort
 * endpoint, and a scripted lifecycle stands in for the worker's event stream;
 * everything between them — the writer, the Redis append script, the chat lock,
 * run finalization, the reconnect route, and stream recovery — is production code.
 */
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { toRecord } from '@sim/utils/object'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedEnv, worker } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const { createServer: createHttpServer } = await import('node:http')
  const abortRequests: Array<Record<string, unknown>> = []
  const server = createHttpServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    if (request.url === '/api/streams/explicit-abort') abortRequests.push(JSON.parse(body))
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ settled: true }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const url = readTestRedisUrl()
  const inheritedEnv = {
    REDIS_URL: process.env.REDIS_URL,
    SIM_AGENT_API_URL: process.env.SIM_AGENT_API_URL,
  }
  /** The real Redis module and worker URL resolution read these at import. */
  process.env.REDIS_URL = url
  process.env.SIM_AGENT_API_URL = `http://127.0.0.1:${port}`
  return {
    redisUrl: url,
    inheritedEnv,
    worker: {
      server,
      abortRequests,
      /** Events the scripted worker streams through the controller's sink, in order. */
      /** Events, or steps to run between them, that the scripted worker streams in order. */
      script: [] as unknown[],
      /** Controller lifecycles started, and what each sink call threw. */
      runs: [] as Array<{ dispatched: unknown[]; sinkErrors: unknown[] }>,
    },
  }
})

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/mothership/request/lifecycle/run', () => ({
  /**
   * Stands in for the worker leg: forwards each scripted event to the controller's
   * sink and dispatches it only once the sink accepted it, as the real loop does.
   */
  runCopilotLifecycle: async (
    _payload: unknown,
    options: { onEvent?: (event: unknown) => Promise<void>; abortSignal?: AbortSignal }
  ) => {
    const run = { dispatched: [] as unknown[], sinkErrors: [] as unknown[] }
    worker.runs.push(run)
    for (const event of worker.script) {
      if (typeof event === 'function') {
        await event()
        continue
      }
      try {
        await options.onEvent?.(event)
      } catch (error) {
        run.sinkErrors.push(error)
        break
      }
      run.dispatched.push(event)
    }
    return {
      success: run.sinkErrors.length === 0,
      cancelled: options.abortSignal?.aborted ?? false,
      content: '',
      contentBlocks: [],
      toolCalls: [],
    }
  },
}))

import { db } from '@sim/db'
import { copilotChats, copilotRuns, permissions, user, workspace } from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import { getRedisBudgetKeys, getRedisBudgetLimits } from '@/lib/core/redis/byte-budget.server'
import { readChatStream } from '@/lib/mothership/request/application/recover-stream'
import { createStreamingContext } from '@/lib/mothership/request/context/request-context'
import { restoreStreamingContext } from '@/lib/mothership/request/context/restore'
import { finalizeStream } from '@/lib/mothership/request/lifecycle/finalize'
import { createSSEStream } from '@/lib/mothership/request/lifecycle/start'
import { acquirePendingChatStream } from '@/lib/mothership/request/session/abort'
import { readEvents } from '@/lib/mothership/request/session/buffer'
import {
  type ChatStreamLease,
  chatStreamLockKey,
  StreamControllerSupersededError,
} from '@/lib/mothership/request/session/controller-lease'
import { eventToStreamEvent } from '@/lib/mothership/request/session/event'
import {
  REPLAY_BUDGET_EXHAUSTED_CODE,
  StreamReplayBudgetExhaustedError,
} from '@/lib/mothership/request/session/replay-budget'
import { STREAM_STRING_PREVIEW_UNITS } from '@/lib/mothership/request/session/replay-compaction'
import type { StreamEvent } from '@/lib/mothership/request/session/types'
import { StreamWriter } from '@/lib/mothership/request/session/writer'
import type { StreamingContext } from '@/lib/mothership/request/types'
import { GET as streamGET } from '@/app/api/copilot/chat/stream/route'

const MB = 1024 * 1024

function redis() {
  const client = getRedisClient()
  if (!client) throw new Error('The integration suite requires TEST_REDIS_URL')
  return client
}

/** A writer that owns a real chat lock, with the frames it delivers to its client. */
async function leasedWriter(options: { lease?: ChatStreamLease; ownLock?: boolean } = {}) {
  const streamId = generateId()
  const lease = options.lease ?? {
    key: chatStreamLockKey(generateId()),
    value: `${streamId}\n${generateId()}`,
  }
  if (options.ownLock !== false) await redis().set(lease.key, lease.value, 'EX', 60)
  const writer = new StreamWriter({
    streamId,
    requestId: generateId(),
    userId: generateId(),
    lease,
  })
  const delivered: string[] = []
  const client = new ReadableStream<Uint8Array>({
    start: (controller) => writer.attach(controller),
  })
  const received = client.pipeTo(
    new WritableStream({
      write: (chunk) => {
        delivered.push(
          new TextDecoder()
            .decode(chunk)
            .replace(/^data: /, '')
            .trim()
        )
      },
    })
  )
  /** The frames the client received, once the writer has closed its stream. */
  const frames = async () => {
    await received
    return delivered
  }
  return { streamId, writer, frames }
}

async function storedMembers(streamId: string): Promise<string[]> {
  return redis().zrange(`mothership_stream:${streamId}:events`, 0, -1)
}

function toolCall(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
  executor: 'sim' | 'go' | 'client' = 'sim'
): StreamEvent {
  return {
    type: 'tool',
    payload: { toolCallId, toolName, executor, mode: 'async', phase: 'call', arguments: args },
  }
}

function dataFrames(body: string) {
  return body
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice('data: '.length)))
}

function text(value: string): StreamEvent {
  return { type: 'text', payload: { channel: 'assistant', text: value } }
}

afterAll(async () => {
  await closeRedisConnection()
  await new Promise<void>((resolve) => worker.server.close(() => resolve()))
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe.runIf(Boolean(redisUrl))('leased Chat stream writer with Redis', () => {
  it('delivers and persists the same bounded copy of a 2 MB tool call, leaving the dispatched event whole', async () => {
    const { streamId, writer, frames } = await leasedWriter()
    const stdout = 'o'.repeat(2 * MB)
    const call = toolCall('call-large', 'cli_logs_get', {
      activity: { id: 'activity-1', title: 'Reading logs' },
      command: 'logs get --run latest',
      stdout,
    })

    await writer.publish(text('before '))
    await writer.publish(call)
    await writer.publish(text('after'))
    await writer.close()

    expect(await frames()).toEqual(await storedMembers(streamId))
    const replayed = await readEvents(streamId, '0')
    expect(replayed.map((envelope) => envelope.seq)).toEqual([1, 2, 3])
    const payload = toRecord(replayed[1].payload)
    expect(payload).toMatchObject({
      toolCallId: 'call-large',
      toolName: 'cli_logs_get',
      phase: 'call',
      arguments: {
        activity: { id: 'activity-1', title: 'Reading logs' },
        command: 'logs get --run latest',
        stdout: `${stdout.slice(0, STREAM_STRING_PREVIEW_UNITS)}…[truncated, 2 MB total]`,
      },
    })
    expect(toRecord(call.payload).arguments).toMatchObject({ stdout })
  })

  it('publishes a bounded preview of a committed 1.6 MB tool result and keeps persisting later events', async () => {
    const { streamId, writer, frames } = await leasedWriter()
    const resources = [{ type: 'file', id: 'file-1', title: 'report.csv' }]

    await writer.publish({
      type: 'tool',
      payload: {
        toolCallId: 'call-result',
        toolName: 'run_code',
        executor: 'sim',
        mode: 'async',
        phase: 'result',
        success: true,
        status: 'success',
        output: { stdout: 'r'.repeat(1.6 * MB), exitCode: 0, resources },
      },
    })
    await writer.publish(text('The report is ready.'))
    await writer.close()

    expect(await frames()).toEqual(await storedMembers(streamId))
    const replayed = await readEvents(streamId, '0')
    expect(replayed.map((envelope) => envelope.type)).toEqual(['tool', 'text'])
    expect(toRecord(replayed[0].payload)).toMatchObject({
      success: true,
      status: 'success',
      output: {
        exitCode: 0,
        resources,
        stdout: `${'r'.repeat(STREAM_STRING_PREVIEW_UNITS)}…[truncated, 1.6 MB total]`,
      },
    })
    expect(writer.persistenceStopped).toBe(false)
  })

  it('restores the same tool calls, text, and activity from a compacted buffer as from the full events, without dispatching', async () => {
    const { streamId, writer } = await leasedWriter()
    const workflowArgs = {
      workflowId: generateId(),
      input: { rows: 'w'.repeat(400 * 1024) },
    }
    const events: StreamEvent[] = [
      text('Checking the logs. '),
      toolCall('call-logs', 'cli_logs_get', {
        activity: { id: 'activity-logs', title: 'Reading logs' },
        command: 'logs get',
        stdout: 'l'.repeat(2 * MB),
      }),
      {
        type: 'tool',
        payload: {
          toolCallId: 'call-logs',
          toolName: 'cli_logs_get',
          executor: 'sim',
          mode: 'async',
          phase: 'result',
          success: true,
          status: 'success',
          output: { stdout: 'l'.repeat(1.6 * MB), exitCode: 0 },
        },
      },
      toolCall('call-workflow', 'run_workflow', workflowArgs, 'client'),
      text('Done.'),
    ]
    for (const event of events) await writer.publish(event)
    await writer.close()

    const restore = async (source: readonly StreamEvent[]): Promise<StreamingContext> => {
      const context = createStreamingContext({ messageId: streamId })
      await restoreStreamingContext(source, context, { userId: generateId(), workflowId: '' })
      return context
    }
    const summary = (context: StreamingContext) => ({
      text: context.accumulatedContent,
      calls: [...context.toolCalls.values()].map((call) => ({
        id: call.id,
        name: call.name,
        status: call.status,
        activity: call.params?.activity,
      })),
      pending: context.pendingToolPromises.size,
    })
    const fromBuffer = await restore((await readEvents(streamId, '0')).map(eventToStreamEvent))
    const fromFull = await restore(events)

    expect(summary(fromBuffer)).toEqual(summary(fromFull))
    expect(summary(fromBuffer).pending).toBe(0)
    expect(JSON.stringify(fromBuffer.toolCalls.get('call-workflow')?.params)).toBe(
      JSON.stringify(workflowArgs)
    )
  })

  it('still refuses a controller whose lease was taken over', async () => {
    const lease = { key: chatStreamLockKey(generateId()), value: `stale\n${generateId()}` }
    await redis().set(lease.key, `successor\n${generateId()}`, 'EX', 60)
    const { writer, frames } = await leasedWriter({ lease, ownLock: false })

    const published = writer.publish(text('from the stale controller'))

    await expect(published).rejects.toBeInstanceOf(StreamControllerSupersededError)
    await expect(writer.close()).rejects.toBeInstanceOf(StreamControllerSupersededError)
    expect(await frames()).toEqual([])
  })
})

describe.runIf(Boolean(redisUrl))('a turn whose stream exhausts its replay budget', () => {
  const userId = generateId()
  const workspaceId = generateId()
  const chatId = generateId()
  const ownerMessage = new StreamReplayBudgetExhaustedError({
    resource: 'owner_redis_bytes',
    currentBytes: 0,
    limitBytes: 0,
    attemptedBytes: 0,
  }).userMessage

  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Replay budget fixture',
      email: `${userId}@replay-budget.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Replay budget fixture',
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
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: userId },
      session: { id: generateId() },
    })
  })

  afterAll(async () => {
    await db.delete(copilotChats).where(eq(copilotChats.id, chatId))
    await db.delete(permissions).where(eq(permissions.userId, userId))
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
  })

  /** Admits a turn the way the chat POST does, runs its controller, and returns its frames. */
  async function runTurn(script: unknown[], prepare?: (streamId: string) => Promise<void>) {
    const streamId = generateId()
    const runId = generateId()
    expect(await acquirePendingChatStream(chatId, streamId, 0)).toBe(true)
    const controllerToken = (await redis().get(chatStreamLockKey(chatId)))!
    const request = {
      message: 'Summarize the logs',
      userId,
      messageId: streamId,
      chatId,
      workspaceId,
    }
    const [run] = await db
      .insert(copilotRuns)
      .values({
        id: runId,
        executionId: generateId(),
        chatId,
        userId,
        workspaceId,
        streamId,
        requestContext: {
          requestId: generateId(),
          controllerToken,
          recovery: {
            kind: 'interactive_stream',
            request,
            goRoute: '/api/mothership',
            clientToolPickupExpected: false,
          },
        },
      })
      .returning()
    await prepare?.(streamId)
    worker.runs.length = 0
    worker.abortRequests.length = 0
    worker.script = script
    const response = createSSEStream({
      requestPayload: request,
      userId,
      streamId,
      executionId: run.executionId,
      runId,
      chatId,
      currentChat: { title: 'Existing title' },
      message: request.message,
      titleModel: '',
      requestId: generateId(),
      workspaceId,
      admittedRun: run,
      orchestrateOptions: { userId, workspaceId, chatId, runId, interactive: true },
    })
    return { streamId, runId, frames: dataFrames(await new Response(response).text()) }
  }

  it('ends as an error, marks its run terminal, stops the worker, and starts no recovery controller', async () => {
    const { streamId, runId, frames } = await runTurn(
      [
        toolCall('call-refused', 'cli_blocks_get', { command: `blocks get ${'b'.repeat(1024)}` }),
        text('never delivered'),
      ],
      async (streamId) => {
        const { maxOwnerBytes } = getRedisBudgetLimits('copilot_stream')
        const [ownerBudgetKey] = getRedisBudgetKeys({ kind: 'copilot_stream', id: streamId })
        /** Room for the turn's opening session frame, not for the worker's tool call. */
        await redis().set(ownerBudgetKey, String(maxOwnerBytes - 512), 'EX', 3600)
      }
    )

    expect(frames.map((frame) => [frame.type, frame.payload.code ?? frame.payload.status])).toEqual(
      [
        ['session', undefined],
        ['error', REPLAY_BUDGET_EXHAUSTED_CODE],
        ['complete', 'error'],
      ]
    )
    expect(frames[1].payload.message).toBe(ownerMessage)
    const [stored] = await db.select().from(copilotRuns).where(eq(copilotRuns.id, runId))
    expect(stored).toMatchObject({ status: 'error', error: ownerMessage })
    expect(worker.abortRequests).toEqual([expect.objectContaining({ messageId: streamId })])
    expect(await redis().get(chatStreamLockKey(chatId))).toBeNull()

    const reconnect = await streamGET(
      new NextRequest(`http://localhost:3000/api/copilot/chat/stream?streamId=${streamId}&after=0`),
      { params: Promise.resolve({}) }
    )
    const replayed = dataFrames(await reconnect.text())
    expect(replayed.map((frame) => frame.type)).toEqual(['session', 'error', 'complete'])
    expect(replayed[1].payload.message).toBe(ownerMessage)
    expect(replayed[2].payload.status).toBe('error')

    const recovered = await readChatStream.execute({
      principal: { kind: 'session', userId, sessionId: generateId() },
      input: { streamId },
    })
    expect(recovered?.status).toBe('error')
    expect(worker.runs).toHaveLength(1)
    expect(await redis().get(chatStreamLockKey(chatId))).toBeNull()

    const [controllerRun] = worker.runs
    expect(controllerRun.dispatched).toEqual([])
    expect(controllerRun.sinkErrors[0]).toBeInstanceOf(StreamReplayBudgetExhaustedError)
  })

  it.each([
    [
      'is refused an oversized frame',
      toolCall('call-oversized', 'run_workflow', {
        workflowId: generateId(),
        input: 'w'.repeat(1.5 * MB),
      }),
    ],
    [
      'fails its worker leg',
      async () => {
        throw new Error('worker leg failed')
      },
    ],
  ])(
    "leaves its successor's stream untouched when a superseded controller %s",
    async (_label, step) => {
      const successorToken = `successor\n${generateId()}`
      const { streamId, runId, frames } = await runTurn([
        async () => {
          await redis().set(chatStreamLockKey(chatId), successorToken, 'EX', 60)
        },
        step,
      ])

      expect(frames.map((frame) => frame.type)).toEqual(['session'])
      /** The client stream closes before the controller's teardown; let teardown finish. */
      await sleep(500)
      expect(await redis().ttl(`mothership_stream:${streamId}:events`)).toBeGreaterThan(300)
      expect(await redis().get(chatStreamLockKey(chatId))).toBe(successorToken)
      const [stored] = await db.select().from(copilotRuns).where(eq(copilotRuns.id, runId))
      expect(stored.status).toBe('active')
      expect(worker.abortRequests).toEqual([])
      await redis().del(chatStreamLockKey(chatId))
    }
  )

  it('marks its run terminal even when the final events cannot be published', async () => {
    const streamId = generateId()
    const runId = generateId()
    const controllerToken = `${streamId}\n${generateId()}`
    await db.insert(copilotRuns).values({
      id: runId,
      executionId: generateId(),
      chatId,
      userId,
      workspaceId,
      streamId,
      status: 'paused_waiting_for_tool',
      requestContext: { requestId: generateId(), controllerToken },
    })
    /** No chat lock holds this lease, so publishing the terminal events throws. */
    const lease = { key: chatStreamLockKey(generateId()), value: controllerToken }
    const publisher = new StreamWriter({ streamId, requestId: generateId(), lease })

    await expect(
      finalizeStream(
        {
          success: false,
          error: 'The agent service is temporarily unavailable. Please try again.',
          content: '',
          contentBlocks: [],
          toolCalls: [],
        },
        publisher,
        runId,
        'error',
        generateId()
      )
    ).rejects.toBeInstanceOf(StreamControllerSupersededError)

    const [stored] = await db.select().from(copilotRuns).where(eq(copilotRuns.id, runId))
    expect(stored.status).toBe('error')
  })

  it('does not settle a run another controller has claimed', async () => {
    const streamId = generateId()
    const runId = generateId()
    await db.insert(copilotRuns).values({
      id: runId,
      executionId: generateId(),
      chatId,
      userId,
      workspaceId,
      streamId,
      status: 'paused_waiting_for_tool',
      requestContext: { requestId: generateId(), controllerToken: `successor\n${generateId()}` },
    })
    const lease = { key: chatStreamLockKey(generateId()), value: `stale\n${generateId()}` }
    const publisher = new StreamWriter({ streamId, requestId: generateId(), lease })

    await expect(
      finalizeStream(
        { success: false, error: 'failed', content: '', contentBlocks: [], toolCalls: [] },
        publisher,
        runId,
        'error',
        generateId()
      )
    ).rejects.toBeInstanceOf(StreamControllerSupersededError)

    const [stored] = await db.select().from(copilotRuns).where(eq(copilotRuns.id, runId))
    expect(stored.status).toBe('paused_waiting_for_tool')
  })
})
