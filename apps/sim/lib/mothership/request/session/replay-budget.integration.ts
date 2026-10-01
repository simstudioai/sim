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
  const hooks = {
    onAbort: undefined as (() => Promise<void>) | undefined,
    /** The read-only replay's answer; a worker that does not know the run by default. */
    replay: { status: 404, frames: [] as unknown[] },
    /** How many coming reads of the controller's own lease fail, as a Redis error would. */
    leaseReadFailures: 0,
  }
  const replayRequests: Array<Record<string, unknown>> = []
  const server = createHttpServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    if (request.url === '/api/streams/replay') {
      replayRequests.push(JSON.parse(body))
      if (hooks.replay.status !== 200) {
        response.writeHead(hooks.replay.status, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'Run not found' }))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const frame of hooks.replay.frames) response.write(`data: ${JSON.stringify(frame)}\n\n`)
      response.end('data: [DONE]\n\n')
      return
    }
    if (request.url === '/api/streams/explicit-abort') {
      abortRequests.push(JSON.parse(body))
      await hooks.onAbort?.()
    }
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
      replayRequests,
      hooks,
      /** Events, or steps to run between them, that the scripted worker streams in order. */
      script: [] as unknown[],
      /** Controller lifecycles started, and what each sink call threw. */
      runs: [] as Array<{
        dispatched: unknown[]
        sinkErrors: unknown[]
        recoveredEvents?: unknown[]
      }>,
    },
  }
})

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/mothership/request/session/controller-lease', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/mothership/request/session/controller-lease')>()
  return {
    ...actual,
    assertChatStreamLease: async (...args: Parameters<typeof actual.assertChatStreamLease>) => {
      if (worker.hooks.leaseReadFailures > 0) {
        worker.hooks.leaseReadFailures--
        throw new Error('simulated Redis read failure')
      }
      return actual.assertChatStreamLease(...args)
    },
  }
})
vi.mock('@/lib/mothership/request/lifecycle/run', () => ({
  /**
   * Stands in for the worker leg: forwards each scripted event to the controller's
   * sink and dispatches it only once the sink accepted it, as the real loop does.
   */
  runCopilotLifecycle: async (
    _payload: unknown,
    options: {
      onEvent?: (event: unknown) => Promise<void>
      abortSignal?: AbortSignal
      recovery?: { events: unknown[] }
    }
  ) => {
    const run = {
      dispatched: [] as unknown[],
      sinkErrors: [] as unknown[],
      recoveredEvents: options.recovery?.events,
    }
    worker.runs.push(run)
    for (const event of worker.script) {
      if (typeof event === 'function') {
        await event(options)
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

import { trace } from '@opentelemetry/api'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { db } from '@sim/db'
import { copilotChats, copilotRuns, permissions, user, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import { getRedisBudgetKeys, getRedisBudgetLimits } from '@/lib/core/redis/byte-budget.server'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/mothership/generated/trace-spans-v1'
import { readChatStream } from '@/lib/mothership/request/application/recover-stream'
import { createStreamingContext } from '@/lib/mothership/request/context/request-context'
import { restoreStreamingContext } from '@/lib/mothership/request/context/restore'
import {
  createFilePreviewAdapterState,
  processFilePreviewStreamEvent,
} from '@/lib/mothership/request/go/file-preview-adapter'
import { finalizeStream } from '@/lib/mothership/request/lifecycle/finalize'
import { createSSEStream } from '@/lib/mothership/request/lifecycle/start'
import { acquirePendingChatStream } from '@/lib/mothership/request/session/abort'
import { appendEvents, readEvents } from '@/lib/mothership/request/session/buffer'
import {
  type ChatStreamLease,
  chatStreamLockKey,
  StreamControllerSupersededError,
} from '@/lib/mothership/request/session/controller-lease'
import { createEvent, eventToStreamEvent } from '@/lib/mothership/request/session/event'
import {
  REPLAY_BUDGET_EXHAUSTED_CODE,
  StreamReplayBudgetExhaustedError,
} from '@/lib/mothership/request/session/replay-budget'
import { STREAM_STRING_PREVIEW_UNITS } from '@/lib/mothership/request/session/replay-compaction'
import type { StreamEvent } from '@/lib/mothership/request/session/types'
import { StreamWriter } from '@/lib/mothership/request/session/writer'
import type { StreamingContext } from '@/lib/mothership/request/types'
import {
  type PendingFileIntent,
  storeFileIntent,
} from '@/lib/mothership/tools/server/files/file-intent-store'
import { GET as copilotChatGET } from '@/app/api/copilot/chat/queries'
import { GET as streamGET } from '@/app/api/copilot/chat/stream/route'
import { GET as mothershipChatGET } from '@/app/api/mothership/chats/[chatId]/route'

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

describe.runIf(Boolean(redisUrl))('the replay ring trimmed past its byte target', () => {
  /** A ring whose counter is already past the byte target, as after a long run. */
  async function overTargetRing(seqs: number[]) {
    const streamId = generateId()
    const [ownerBudgetKey] = getRedisBudgetKeys({ kind: 'copilot_stream', id: streamId })
    const persisted = await appendEvents(
      seqs.map((seq) => textEvent(streamId, seq)),
      { streamId }
    )
    expect(persisted).toEqual({ persisted: true })
    const { maxOwnerBytes } = getRedisBudgetLimits('copilot_stream')
    await redis().set(ownerBudgetKey, maxOwnerBytes - MB, 'EX', 3600)
    return { streamId, ownerBudgetKey }
  }

  function textEvent(streamId: string, seq: number) {
    return createEvent({
      streamId,
      cursor: String(seq),
      seq,
      requestId: 'replay-trim',
      type: 'text',
      payload: { channel: 'assistant', text: `part ${String(seq).padStart(6, '0')}` },
    })
  }

  const seqsOf = async (streamId: string) =>
    (await storedMembers(streamId)).map((member) => JSON.parse(member).seq as number)
  const bytesOf = (members: string[]) =>
    members.reduce((sum, member) => sum + Buffer.byteLength(member), 0)

  it('trims a replayed member below the ring with it, leaving a contiguous tail', async () => {
    const { streamId, ownerBudgetKey } = await overTargetRing([2, 3])
    const before = Number(await redis().get(ownerBudgetKey))
    const dropped = await storedMembers(streamId)
    const newest = textEvent(streamId, 4)

    expect(await appendEvents([textEvent(streamId, 1), newest], { streamId })).toEqual({
      persisted: true,
    })

    expect(await seqsOf(streamId)).toEqual([4])
    expect(Number(await redis().get(ownerBudgetKey))).toBe(
      before + Buffer.byteLength(JSON.stringify(newest)) - bytesOf(dropped)
    )
  })

  it('catches an oversized ring up over several appends', async () => {
    const seqs = Array.from({ length: 6000 }, (_, index) => index + 1)
    const { streamId, ownerBudgetKey } = await overTargetRing(seqs)

    await appendEvents([textEvent(streamId, 6001)], { streamId })
    const afterFirst = await seqsOf(streamId)
    expect(afterFirst.length).toBeGreaterThan(1)
    expect(afterFirst).toEqual(
      Array.from({ length: afterFirst.length }, (_, index) => 6001 - afterFirst.length + 1 + index)
    )

    await appendEvents([textEvent(streamId, 6002)], { streamId })
    expect(await seqsOf(streamId)).toEqual([6002])
    expect(Number(await redis().get(ownerBudgetKey))).toBeLessThan(
      getRedisBudgetLimits('copilot_stream').maxOwnerBytes - MB
    )
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
  /** Resolves when a controller's root span ends, the last step of its teardown. */
  const teardowns = new Map<string, () => void>()
  beforeAll(() => {
    trace.disable()
    trace.setGlobalTracerProvider(
      new BasicTracerProvider({
        spanProcessors: [
          {
            onStart: () => {},
            onEnd: (span) => {
              const streamId = span.attributes[TraceAttr.StreamId]
              if (span.name === TraceSpan.GenAiAgentExecute && typeof streamId === 'string') {
                teardowns.get(streamId)?.()
              }
            },
            forceFlush: async () => {},
            shutdown: async () => {},
          },
        ],
      })
    )
  })
  afterAll(() => trace.disable())

  async function runTurn(script: unknown[], prepare?: (streamId: string) => Promise<void>) {
    const streamId = generateId()
    const teardown = new Promise<void>((resolve) => teardowns.set(streamId, resolve))
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
    /** A controller whose teardown throws errors its client stream; its frames are then moot. */
    const frames = dataFrames(await new Response(response).text().catch(() => ''))
    await teardown
    return { streamId, runId, frames }
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
      expect(await redis().ttl(`mothership_stream:${streamId}:events`)).toBeGreaterThan(300)
      expect(await redis().get(chatStreamLockKey(chatId))).toBe(successorToken)
      const [stored] = await db.select().from(copilotRuns).where(eq(copilotRuns.id, runId))
      expect(stored.status).toBe('active')
      expect(worker.abortRequests).toEqual([])
      await redis().del(chatStreamLockKey(chatId))
    }
  )

  it('leaves a run it handed off recoverable after a transient append failure', async () => {
    let eventsKey = ''
    const { streamId, runId, frames } = await runTurn(
      [
        async () => {
          // A corrupt buffer key makes the next append fail while the lease is still held.
          await redis().set(eventsKey, 'corrupt', 'EX', 3600)
        },
        toolCall('call-unsaved', 'cli_blocks_get', { command: 'blocks get' }),
      ],
      async (id) => {
        eventsKey = `mothership_stream:${id}:events`
      }
    )

    expect(frames.map((frame) => frame.type)).toEqual(['session'])
    expect(await redis().ttl(`mothership_stream:${streamId}:events`)).toBeGreaterThan(300)
    const [stored] = await db.select().from(copilotRuns).where(eq(copilotRuns.id, runId))
    expect(stored.status).toBe('active')
    expect(worker.abortRequests).toEqual([])
  })

  it('settles a finished turn whose lease could not be read instead of handing it off', async () => {
    try {
      const { runId, frames } = await runTurn([
        text('Done.'),
        async () => {
          worker.hooks.leaseReadFailures = 1
        },
      ])

      expect(frames.at(-1)).toMatchObject({ type: 'complete', payload: { status: 'complete' } })
      const [stored] = await db.select().from(copilotRuns).where(eq(copilotRuns.id, runId))
      expect(stored.status).toBe('complete')
    } finally {
      worker.hooks.leaseReadFailures = 0
    }
  })

  it('still cleans up a finished turn whose terminal events could not be published', async () => {
    let eventsKey = ''
    const { streamId, runId } = await runTurn(
      [
        async () => {
          // A corrupt buffer key makes the terminal append fail while the lease is held.
          await redis().set(eventsKey, 'corrupt', 'EX', 3600)
        },
      ],
      async (id) => {
        eventsKey = `mothership_stream:${id}:events`
      }
    )

    const [stored] = await db.select().from(copilotRuns).where(eq(copilotRuns.id, runId))
    expect(stored.status).toBe('complete')
    expect(await redis().ttl(`mothership_stream:${streamId}:events`)).toBeLessThanOrEqual(300)
  })

  it('completes a turn that previews a file larger than one replay write', async () => {
    const editToolCallId = generateId()
    const previewToolCallId = generateId()
    const toolFrame = (payload: Record<string, unknown>): StreamEvent =>
      ({
        type: 'tool',
        payload: {
          toolCallId: editToolCallId,
          toolName: 'apply_file_edit',
          executor: 'sim',
          mode: 'async',
          ...payload,
        },
      }) as StreamEvent
    const { runId, frames } = await runTurn([
      async (options: { onEvent?: (event: unknown) => Promise<void> }) => {
        // The real preview adapter, fed the worker's patch of a 1.2 MB stored file.
        const fileId = generateId()
        const anchor = { strategy: 'anchored', mode: 'insert_after', anchor: 'ANCHOR' }
        await storeFileIntent(workspaceId, fileId, {
          operation: 'patch',
          fileId,
          workspaceId,
          userId,
          fileRecord: {} as PendingFileIntent['fileRecord'],
          existingContent: `ANCHOR\n${'existing line of the stored file\n'.repeat(40_000)}`,
          edit: anchor,
          createdAt: Date.now(),
        })
        const context = createStreamingContext()
        context.activeFileIntents.set('', {
          toolCallId: previewToolCallId,
          operation: 'patch',
          target: { kind: 'file_id', fileId, fileName: 'large.md' },
          edit: anchor,
        })
        const state = createFilePreviewAdapterState()
        const preview = (streamEvent: StreamEvent) =>
          processFilePreviewStreamEvent({
            streamId: generateId(),
            streamEvent,
            context,
            execContext: { userId, workflowId: '', workspaceId },
            options: { onEvent: (event) => options.onEvent?.(event) },
            state,
          })
        await preview(toolFrame({ phase: 'args_delta', argumentsDelta: '{"content":"' }))
        for (let chunk = 0; chunk < 3; chunk++) {
          await preview(
            toolFrame({ phase: 'args_delta', argumentsDelta: `inserted line ${chunk}` })
          )
        }
        await preview(toolFrame({ phase: 'result', success: true, status: 'success' }))
      },
      text('The file is updated.'),
    ])

    expect(frames.map((frame) => frame.type)).not.toContain('error')
    expect(frames.at(-1)).toMatchObject({ type: 'complete', payload: { status: 'complete' } })
    expect(frames.some((frame) => frame.payload.previewPhase === 'file_preview_complete')).toBe(
      true
    )
    const [stored] = await db.select().from(copilotRuns).where(eq(copilotRuns.id, runId))
    expect(stored.status).toBe('complete')
  })

  it('streams far past the owner budget without refusing, retaining a bounded contiguous tail', async () => {
    const { maxOwnerBytes, maxUserBytes } = getRedisBudgetLimits('copilot_stream')
    const chunk = 'x'.repeat(4 * 1024)
    const eventCount = Math.ceil((maxOwnerBytes * 1.3) / chunk.length)
    const { streamId, runId, frames } = await runTurn(
      Array.from({ length: eventCount }, (_, index) => text(`${index}:${chunk}`))
    )

    expect(frames.map((frame) => frame.type)).not.toContain('error')
    expect(frames.at(-1)).toMatchObject({ type: 'complete', payload: { status: 'complete' } })
    const [stored] = await db.select().from(copilotRuns).where(eq(copilotRuns.id, runId))
    expect(stored.status).toBe('complete')

    const members = await storedMembers(streamId)
    const retainedBytes = members.reduce((sum, member) => sum + Buffer.byteLength(member), 0)
    const [ownerBudgetKey, userBudgetKey] = getRedisBudgetKeys({
      kind: 'copilot_stream',
      id: streamId,
      userId,
    })
    expect(Number(await redis().get(ownerBudgetKey))).toBe(retainedBytes)
    expect(retainedBytes).toBeLessThan(maxOwnerBytes)
    expect(Number(await redis().get(userBudgetKey))).toBeLessThan(maxUserBytes)

    const seqs = members.map((member) => JSON.parse(member).seq as number)
    const oldestSeq = seqs[0]
    const latestSeq = seqs.at(-1)!
    expect(oldestSeq).toBeGreaterThan(1)
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, index) => oldestSeq + index))

    const reconnect = async (after: number) =>
      dataFrames(
        await (
          await streamGET(
            new NextRequest(
              `http://localhost:3000/api/copilot/chat/stream?streamId=${streamId}&after=${after}`
            ),
            { params: Promise.resolve({}) }
          )
        ).text()
      )
    // A headless ring is re-synced from the log; this worker lacks the run, so replay_gap.
    worker.replayRequests.length = 0
    const inRange = await reconnect(oldestSeq - 1)
    expect(
      inRange.map((frame) => [frame.type, frame.payload.code ?? frame.payload.reason])
    ).toEqual([
      ['error', 'replay_gap'],
      ['complete', 'replay_gap'],
    ])
    const behind = await reconnect(oldestSeq - 2)
    expect(behind.map((frame) => [frame.type, frame.payload.code ?? frame.payload.reason])).toEqual(
      [
        ['error', 'replay_gap'],
        ['complete', 'replay_gap'],
      ]
    )
    expect(behind[0].payload.data).toEqual({
      oldestAvailableSeq: oldestSeq,
      requestedAfterSeq: oldestSeq - 2,
    })
    expect(behind[0].seq).toBe(latestSeq + 1)
    expect(worker.replayRequests).toEqual([
      { streamId, chatId, userId },
      { streamId, chatId, userId },
    ])
  }, 180_000)

  /**
   * An unfinished run with no live controller whose ring a byte trim has advanced past
   * its head: seqs 1–2 are gone and 3–4 remain.
   */
  async function trimmedRecoverableStream() {
    const streamId = generateId()
    const request = {
      message: 'Summarize the logs',
      userId,
      messageId: streamId,
      chatId,
      workspaceId,
    }
    await db.insert(copilotRuns).values({
      id: generateId(),
      executionId: generateId(),
      chatId,
      userId,
      workspaceId,
      streamId,
      requestContext: {
        requestId: generateId(),
        controllerToken: `dead\n${generateId()}`,
        recovery: {
          kind: 'interactive_stream',
          request,
          goRoute: '/api/mothership',
          clientToolPickupExpected: false,
        },
      },
    })
    await db
      .update(copilotChats)
      .set({ conversationId: streamId })
      .where(eq(copilotChats.id, chatId))
    const persisted = await appendEvents(
      [1, 2, 3, 4].map((seq) =>
        createEvent({
          streamId,
          cursor: String(seq),
          seq,
          requestId: generateId(),
          type: 'text',
          payload: { channel: 'assistant', text: `part ${seq} ` },
        })
      ),
      { streamId }
    )
    expect(persisted).toEqual({ persisted: true })
    await redis().zremrangebyrank(`mothership_stream:${streamId}:events`, 0, 1)
    worker.runs.length = 0
    worker.script = []
    return streamId
  }

  const resume = async (streamId: string, query: string) =>
    streamGET(
      new NextRequest(
        `http://localhost:3000/api/copilot/chat/stream?streamId=${streamId}&${query}`
      ),
      { params: Promise.resolve({}) }
    )

  describe('when a byte trim has removed the head of an unfinished turn', () => {
    afterAll(async () => {
      await db.update(copilotChats).set({ conversationId: null }).where(eq(copilotChats.id, chatId))
      await redis().del(chatStreamLockKey(chatId))
    })

    it.each(['after=4', 'after=0'])(
      'recovers from an empty context, not the tail, and shows the full turn from the log (%s)',
      async (query) => {
        const streamId = await trimmedRecoverableStream()
        worker.hooks.replay = {
          status: 200,
          frames: [
            {
              v: 1,
              type: 'text',
              seq: 1,
              ts: new Date().toISOString(),
              stream: { streamId, chatId },
              payload: {
                channel: 'assistant',
                text: 'part 1 part 2 part 3 part 4 ',
                textOffset: 0,
              },
            },
            {
              v: 1,
              type: 'run',
              seq: 2,
              ts: new Date().toISOString(),
              stream: { streamId, chatId },
              payload: { kind: 'replay_end', reason: 'stalled', textLength: 28 },
            },
          ],
        }
        try {
          const frames = dataFrames(await (await resume(streamId, query)).text())

          expect(frames.map((frame) => frame.type)).toEqual(['text'])
          expect(frames[0].payload.text).toBe('part 1 part 2 part 3 part 4 ')
          expect(worker.runs.map((run) => run.recoveredEvents)).toEqual([[]])
        } finally {
          worker.hooks.replay = { status: 404, frames: [] }
        }
      }
    )

    it('serves a batch reconnect no tail events', async () => {
      const streamId = await trimmedRecoverableStream()

      const batch = await (await resume(streamId, 'after=0&batch=true')).json()

      expect(batch.events).toEqual([])
      expect(worker.runs.map((run) => run.recoveredEvents)).toEqual([[]])
    })

    it.each([
      [
        'mothership chat',
        () =>
          mothershipChatGET(
            new NextRequest(`http://localhost:3000/api/mothership/chats/${chatId}`),
            {
              params: Promise.resolve({ chatId }),
            }
          ),
      ],
      [
        'copilot chat',
        () =>
          copilotChatGET(
            new NextRequest(`http://localhost:3000/api/copilot/chat?chatId=${chatId}`)
          ),
      ],
    ])('leaves the %s snapshot to the resume route', async (_label, load) => {
      const streamId = await trimmedRecoverableStream()

      const body = await (await load()).json()

      expect(body.success).toBe(true)
      expect(body.chat.streamSnapshot).toBeUndefined()
      expect(JSON.stringify(body.chat.messages)).not.toContain('part 3')
      expect(await storedMembers(streamId)).toHaveLength(2)
    })
  })

  it("leaves its successor's stream untouched when the lease is lost while ending a refused turn", async () => {
    const successorToken = `successor\n${generateId()}`
    worker.hooks.onAbort = async () => {
      await redis().set(chatStreamLockKey(chatId), successorToken, 'EX', 60)
    }
    try {
      const { streamId, frames } = await runTurn(
        [toolCall('call-refused', 'cli_blocks_get', { command: `blocks get ${'b'.repeat(1024)}` })],
        async (streamId) => {
          const { maxOwnerBytes } = getRedisBudgetLimits('copilot_stream')
          const [ownerBudgetKey] = getRedisBudgetKeys({ kind: 'copilot_stream', id: streamId })
          await redis().set(ownerBudgetKey, String(maxOwnerBytes - 512), 'EX', 3600)
        }
      )

      expect(frames.map((frame) => frame.type)).toEqual(['session', 'error', 'complete'])
      expect(await redis().ttl(`mothership_stream:${streamId}:events`)).toBeGreaterThan(300)
      expect(await redis().get(chatStreamLockKey(chatId))).toBe(successorToken)
    } finally {
      worker.hooks.onAbort = undefined
      await redis().del(chatStreamLockKey(chatId))
    }
  })

  async function pausedRun(controllerToken: string) {
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
      requestContext: { requestId: generateId(), controllerToken },
    })
    return { streamId, runId }
  }

  async function finalizeAsError(publisher: StreamWriter, runId: string) {
    return finalizeStream(
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
  }

  it('marks its run terminal even when the final events cannot be published', async () => {
    const controllerToken = `owner\n${generateId()}`
    const { streamId, runId } = await pausedRun(controllerToken)
    const lease = { key: chatStreamLockKey(generateId()), value: controllerToken }
    await redis().set(lease.key, lease.value, 'EX', 60)
    /** A corrupt buffer key makes every append fail while the lease is still held. */
    await redis().set(`mothership_stream:${streamId}:events`, 'not a sorted set', 'EX', 60)
    const publisher = new StreamWriter({ streamId, requestId: generateId(), lease })

    const failure = await finalizeAsError(publisher, runId).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(StreamControllerSupersededError)
    const [stored] = await db.select().from(copilotRuns).where(eq(copilotRuns.id, runId))
    expect(stored.status).toBe('error')
    await redis().del(lease.key)
  })

  it('leaves its run for a successor when it lost the lease while publishing', async () => {
    const controllerToken = `stale\n${generateId()}`
    const { streamId, runId } = await pausedRun(controllerToken)
    const lease = { key: chatStreamLockKey(generateId()), value: controllerToken }
    const publisher = new StreamWriter({ streamId, requestId: generateId(), lease })

    await expect(finalizeAsError(publisher, runId)).rejects.toBeInstanceOf(
      StreamControllerSupersededError
    )

    const [stored] = await db.select().from(copilotRuns).where(eq(copilotRuns.id, runId))
    expect(stored.status).toBe('paused_waiting_for_tool')
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
