import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
/**
 * An unattended turn (a scheduled job's occurrence) started with no browser attached survives
 * the death of the Sim process driving it, against real Redis and PostgreSQL through the
 * production admission, chat lifecycle, abandoned-run takeover and finalization. A local HTTP
 * server stands in for the worker: each POST for the turn is one leg, and a leg either ends the
 * turn or stays open until the test kills its controller, as a pod deploy or crash would.
 *
 * A controller is killed by aborting it as superseded (it stops without finalizing, exactly as
 * a process that lost its chat lock) and cutting its worker connection; the run is then left
 * looking as a dead pod leaves it: unfinished, its last write older than the takeover window.
 */
import { envFlagsMock, resetEnvFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedEnv, worker } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const { createServer } = await import('node:http')
  type Leg = { text: string; end: boolean }
  const worker = {
    /** Every POST the worker received, in order. */
    requests: [] as Array<{ path: string; body: Record<string, unknown> }>,
    /** The legs each stream's successive POSTs to /api/mothership answer, in order. */
    legs: new Map<string, Leg[]>(),
    /** The open response of each stream's leg that has not ended. */
    open: new Map<string, import('node:http').ServerResponse>(),
  }
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    const path = request.url ?? ''
    worker.requests.push({ path, body })
    if (path === '/api/streams/explicit-abort') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ settled: true }))
      return
    }
    const streamId = String(body.messageId ?? '')
    const leg = path === '/api/mothership' ? worker.legs.get(streamId)?.shift() : undefined
    if (!leg) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'Run not found' }))
      return
    }
    /** A re-attach names how much text it already holds; the worker sends only what follows. */
    const offset = Number(body.receivedTextChars ?? 0)
    const frame = (seq: number, type: string, payload: unknown) =>
      `data: ${JSON.stringify({
        v: 1,
        type,
        seq,
        ts: new Date().toISOString(),
        stream: { streamId, chatId: body.chatId },
        payload,
      })}\n\n`
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(frame(1, 'session', { kind: 'start' }))
    response.write(frame(2, 'text', { channel: 'assistant', text: leg.text, textOffset: offset }))
    if (leg.end) {
      response.write(
        frame(3, 'complete', { status: 'complete', textLength: offset + leg.text.length })
      )
      response.end('data: [DONE]\n\n')
      return
    }
    worker.open.set(streamId, response)
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

vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

/** Each live controller by stream, so a test can kill the one driving its turn. */
const { controllers, legOptions } = vi.hoisted(() => ({
  controllers: new Map<string, AbortController>(),
  legOptions: [] as Array<{
    streamId: string
    interactive: boolean | undefined
    recovered: boolean
    secretMountPolicy: unknown
  }>,
}))
vi.mock('@/lib/mothership/request/session/abort', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mothership/request/session/abort')>()
  return {
    ...actual,
    registerActiveStream: (streamId: string, controller: AbortController) => {
      controllers.set(streamId, controller)
      actual.registerActiveStream(streamId, controller)
    },
  }
})
/** Records how each leg's lifecycle ran: the first and every recovered one. */
vi.mock('@/lib/mothership/request/lifecycle/run', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mothership/request/lifecycle/run')>()
  return {
    ...actual,
    runCopilotLifecycle: (...args: Parameters<typeof actual.runCopilotLifecycle>) => {
      const [, options] = args
      legOptions.push({
        streamId: String(options.recovery?.streamId ?? args[0].messageId),
        interactive: options.interactive,
        recovered: Boolean(options.recovery),
        secretMountPolicy: options.secretMountPolicy,
      })
      return actual.runCopilotLifecycle(...args)
    },
  }
})

import { db } from '@sim/db'
import {
  copilotChats,
  copilotMessages,
  copilotRuns,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { asc, eq, sql } from 'drizzle-orm'
import { resolveBillingAttribution } from '@/lib/billing/core/attribution'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import { ABANDONED_RUN_CURSOR_KEY } from '@/lib/mothership/async-runs/orphaned-runs'
import { chatPubSub } from '@/lib/mothership/chat-status'
import { takeOverAbandonedRuns } from '@/lib/mothership/request/application/abandoned-runs'
import { startUnattendedTurn } from '@/lib/mothership/request/lifecycle/unattended'
import {
  chatStreamLockKey,
  StreamControllerSupersededError,
} from '@/lib/mothership/request/session/controller-lease'

const userId = generateId()
const workspaceId = generateId()

/** The fixture user's billing attribution, which the caller of an unattended turn resolves. */
const payer = () => resolveBillingAttribution({ actorUserId: userId, workspaceId })
const chatIds: string[] = []
const JOB_SECRETS = { secretScope: 'selected' as const, mountedSecrets: ['REPORT_TOKEN'] }

function redis() {
  const client = getRedisClient()
  if (!client) throw new Error('The integration suite requires TEST_REDIS_URL')
  return client
}

async function jobChat() {
  const chatId = generateId()
  chatIds.push(chatId)
  await db
    .insert(copilotChats)
    .values({ id: chatId, userId, workspaceId, type: 'mothership', title: 'Nightly triage' })
  return chatId
}

async function storedRun(runId: string) {
  const [run] = await db
    .select({
      status: copilotRuns.status,
      requestContext: copilotRuns.requestContext,
      updatedAt: copilotRuns.updatedAt,
    })
    .from(copilotRuns)
    .where(eq(copilotRuns.id, runId))
  return run
}

async function messagesOf(chatId: string) {
  return db
    .select({ role: copilotMessages.role, content: copilotMessages.content })
    .from(copilotMessages)
    .where(eq(copilotMessages.chatId, chatId))
    .orderBy(asc(copilotMessages.seq))
}

function legsFor(streamId: string) {
  return worker.requests.filter(
    (request) => request.path === '/api/mothership' && request.body.messageId === streamId
  )
}

async function waitFor(condition: () => Promise<boolean>, what: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await sleep(50)
  }
  throw new Error(`Timed out waiting for ${what}`)
}

/**
 * The process driving the turn dies mid-leg: its controller stops without finalizing and its
 * worker connection drops. Afterwards the run looks as a dead pod leaves it, its lock gone and
 * its last write older than the takeover's idle window.
 */
async function killController(chatId: string, streamId: string) {
  const controller = controllers.get(streamId)
  if (!controller) throw new Error('No live controller to kill')
  controller.abort(new StreamControllerSupersededError())
  worker.open.get(streamId)?.socket?.destroy()
  worker.open.delete(streamId)
  await waitFor(async () => !(await redis().get(chatStreamLockKey(chatId))), 'the lock to lapse')
  await db
    .update(copilotRuns)
    .set({ updatedAt: sql`now() - interval '2 minutes'` })
    .where(eq(copilotRuns.streamId, streamId))
}

/** Sim's periodic takeover rounds, until one re-drives the run (after any recovery backoff). */
async function takeOverUntilReattached(streamId: string) {
  const before = legsFor(streamId).length
  await waitFor(
    async () => {
      await redis().del(ABANDONED_RUN_CURSOR_KEY)
      await takeOverAbandonedRuns()
      return legsFor(streamId).length > before
    },
    'a takeover to re-attach the run',
    30_000
  )
}

afterAll(async () => {
  await new Promise<void>((resolve) => worker.server.close(() => resolve()))
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe.runIf(Boolean(redisUrl))('an unattended turn with no browser attached', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Unattended turn fixture',
      email: `${userId}@unattended-turn.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Unattended turn fixture',
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
  })

  beforeEach(() => {
    worker.requests.length = 0
    legOptions.length = 0
    resetEnvFlagsMock()
    featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(false)
  })

  afterAll(async () => {
    for (const chatId of chatIds) {
      await db.delete(copilotMessages).where(eq(copilotMessages.chatId, chatId))
      await db.delete(copilotRuns).where(eq(copilotRuns.chatId, chatId))
      await db.delete(copilotChats).where(eq(copilotChats.id, chatId))
    }
    await db.delete(permissions).where(eq(permissions.userId, userId))
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
    chatPubSub?.dispose()
    await closeRedisConnection()
  })

  it('survives three Sim process deaths mid-run, finishing once as the same unattended run', async () => {
    const chatId = await jobChat()
    const occurrenceId = generateId()
    const parts = ['Checked the queue. ', 'Two items triaged. ', 'One escalated. ', 'Done.']
    worker.legs.set(occurrenceId, [
      { text: parts[0], end: false },
      { text: parts[1], end: false },
      { text: parts[2], end: false },
      { text: parts[3], end: true },
    ])
    const start = async () =>
      startUnattendedTurn({
        userId,
        workspaceId,
        chatId,
        messageId: occurrenceId,
        message: 'Triage the overnight queue.',
        origin: 'job',
        billingAttribution: await payer(),
        secretAuthority: { secretMountPolicy: JOB_SECRETS, secretActorUserId: userId },
      })

    expect(await start()).toBe('started')
    await waitFor(async () => worker.open.has(occurrenceId), 'the first leg')
    /** A dispatcher retry while the turn runs finds it, and starts nothing. */
    expect(await start()).toBe('duplicate')

    for (let death = 1; death <= 3; death++) {
      await killController(chatId, occurrenceId)
      await takeOverUntilReattached(occurrenceId)
      if (death < 3) await waitFor(async () => worker.open.has(occurrenceId), 'the next leg')
    }

    await waitFor(
      async () => (await storedRun(occurrenceId))?.status === 'complete',
      'the run to complete'
    )
    await waitFor(
      async () => !(await redis().get(chatStreamLockKey(chatId))),
      'the chat to be released'
    )

    const legs = legsFor(occurrenceId)
    expect(legs).toHaveLength(4)
    /** Every later leg is a re-attach of the same run carrying its receipt, never a fresh start. */
    expect(legs.map((leg) => leg.body.receivedTextChars)).toEqual([
      0,
      parts[0].length,
      parts[0].length + parts[1].length,
      parts[0].length + parts[1].length + parts[2].length,
    ])
    expect(legs.every((leg) => leg.body.origin === 'job' && leg.body.chatId === chatId)).toBe(true)
    expect(worker.requests.filter((r) => r.path === '/api/streams/explicit-abort')).toHaveLength(0)

    /** Every leg ran as it was admitted: nobody to prompt, and only the job's mounted secrets. */
    const turnLegs = legOptions.filter((leg) => leg.streamId === occurrenceId)
    expect(turnLegs.map((leg) => leg.recovered)).toEqual([false, true, true, true])
    for (const leg of turnLegs) {
      expect(leg.interactive).toBe(false)
      expect(leg.secretMountPolicy).toEqual(JOB_SECRETS)
    }

    const messages = await messagesOf(chatId)
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(toRecord(messages[0].content)).toMatchObject({
      id: occurrenceId,
      origin: 'job',
      content: 'Triage the overnight queue.',
    })
    expect(toRecord(messages[1].content).content).toBe(parts.join(''))

    const run = await storedRun(occurrenceId)
    expect(toRecord(toRecord(run.requestContext).recovery).kind).toBe('unattended_stream')
    expect(toRecord(toRecord(run.requestContext).recoveryBackoff).attempts).toBe(3)
    const runs = await db
      .select({ id: copilotRuns.id })
      .from(copilotRuns)
      .where(eq(copilotRuns.chatId, chatId))
    expect(runs).toHaveLength(1)

    /** The finished occurrence is never admitted again. */
    expect(await start()).toBe('duplicate')
    expect(legsFor(occurrenceId)).toHaveLength(4)
  }, 120_000)

  it('answers busy, admitting nothing, while another turn holds the chat', async () => {
    const chatId = await jobChat()
    const typedTurn = generateId()
    await redis().set(chatStreamLockKey(chatId), `${typedTurn}\n${generateId()}`, 'EX', 60)
    const occurrenceId = generateId()
    try {
      expect(
        await startUnattendedTurn({
          userId,
          workspaceId,
          chatId,
          messageId: occurrenceId,
          message: 'Triage the overnight queue.',
          origin: 'job',
          billingAttribution: await payer(),
          secretAuthority: { secretMountPolicy: JOB_SECRETS, secretActorUserId: userId },
        })
      ).toBe('busy')
    } finally {
      await redis().del(chatStreamLockKey(chatId))
    }
    expect(await storedRun(occurrenceId)).toBeUndefined()
    expect(await messagesOf(chatId)).toEqual([])
    expect(legsFor(occurrenceId)).toHaveLength(0)
  })
})
