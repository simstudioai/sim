import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
/**
 * The schedule tick's job lane against real PostgreSQL and Redis: claiming occurrences, starting
 * each as a durable unattended turn in its job's chat through the production admission and chat
 * lifecycle, reconciling lost dispatches, surviving the death of the Sim process driving a turn,
 * and finalizing each occurrence once. A local HTTP server stands in for the worker; each POST
 * for a turn is one leg, which ends the turn, fails it, or stays open until the test acts.
 */
import { envFlagsMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedEnv, worker } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const { createServer } = await import('node:http')
  type Leg = { text: string; mode: 'end' | 'hang' | 'fail' }
  const worker = {
    requests: [] as Array<{ path: string; body: Record<string, unknown> }>,
    /** The legs each stream's successive POSTs answer; a stream with none completes at once. */
    legs: new Map<string, Leg[]>(),
    open: new Map<string, { response: import('node:http').ServerResponse; offset: number }>(),
  }
  const frame = (streamId: string, chatId: unknown, seq: number, type: string, payload: unknown) =>
    `data: ${JSON.stringify({
      v: 1,
      type,
      seq,
      ts: new Date().toISOString(),
      stream: { streamId, chatId },
      payload,
    })}\n\n`
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
    if (path !== '/api/mothership') {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'Run not found' }))
      return
    }
    const streamId = String(body.messageId ?? '')
    const leg = worker.legs.get(streamId)?.shift() ?? { text: 'Nothing to do.', mode: 'end' }
    if (leg.mode === 'fail') {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'internal' }))
      return
    }
    const offset = Number(body.receivedTextChars ?? 0)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(frame(streamId, body.chatId, 1, 'session', { kind: 'start' }))
    response.write(
      frame(streamId, body.chatId, 2, 'text', {
        channel: 'assistant',
        text: leg.text,
        textOffset: offset,
      })
    )
    const textLength = offset + leg.text.length
    if (leg.mode === 'end') {
      response.write(
        frame(streamId, body.chatId, 3, 'complete', { status: 'complete', textLength })
      )
      response.end('data: [DONE]\n\n')
      return
    }
    worker.open.set(streamId, { response, offset: textLength })
  })
  /** Ends a turn's open leg as complete, as the worker does when the agent finishes. */
  const finish = (streamId: string, chatId: string) => {
    const open = worker.open.get(streamId)
    if (!open) throw new Error('No open leg to finish')
    worker.open.delete(streamId)
    open.response.write(
      frame(streamId, chatId, 3, 'complete', { status: 'complete', textLength: open.offset })
    )
    open.response.end('data: [DONE]\n\n')
  }
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const url = readTestRedisUrl()
  const inheritedEnv = {
    REDIS_URL: process.env.REDIS_URL,
    SIM_AGENT_API_URL: process.env.SIM_AGENT_API_URL,
    COPILOT_API_KEY: process.env.COPILOT_API_KEY,
  }
  if (url) process.env.REDIS_URL = url
  process.env.COPILOT_API_KEY = 'job-lane-fixture-key'
  process.env.SIM_AGENT_API_URL = `http://127.0.0.1:${port}`
  return { redisUrl: url, inheritedEnv, worker: Object.assign(worker, { server, finish }) }
})

vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)

/** Spied so the idle tick can prove it neither claims nor reconciles. */
vi.mock('@/lib/mothership/jobs/claim', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mothership/jobs/claim')>()
  return { ...actual, claimDueJobOccurrences: vi.fn(actual.claimDueJobOccurrences) }
})
vi.mock('@/lib/mothership/jobs/reconcile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mothership/jobs/reconcile')>()
  return { ...actual, reconcileJobRuns: vi.fn(actual.reconcileJobRuns) }
})
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
/** Spied so a test can answer the hosted usage gate without a billing ledger. */
vi.mock('@/lib/billing/core/attribution', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/core/attribution')>()
  return { ...actual, checkAttributedUsageLimits: vi.fn(actual.checkAttributedUsageLimits) }
})
/** Spied so a test can tell an automatic turn-off, which emails the job's people, from none. */
vi.mock('@/lib/workflows/schedules/disable-notifications', () => ({
  notifyScheduleAutoDisabled: vi.fn(async () => {}),
}))

const { controllers } = vi.hoisted(() => ({ controllers: new Map<string, AbortController>() }))
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

import { db } from '@sim/db'
import {
  copilotChats,
  copilotMessages,
  copilotRuns,
  jobExecutionLogs,
  permissions,
  user,
  workflowSchedule,
  workspace,
} from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import {
  checkAttributedUsageLimits,
  resolveBillingAttribution,
} from '@/lib/billing/core/attribution'
import {
  acquireLock,
  closeRedisConnection,
  getRedisClient,
  releaseLock,
} from '@/lib/core/config/redis'
import { ABANDONED_RUN_CURSOR_KEY } from '@/lib/mothership/async-runs/orphaned-runs'
import { chatPubSub } from '@/lib/mothership/chat-status'
import { recordJobRunSpend } from '@/lib/mothership/jobs/budget'
import { claimDueJobOccurrences } from '@/lib/mothership/jobs/claim'
import { dispatchJobOccurrence } from '@/lib/mothership/jobs/dispatch'
import { finalizeJobRun } from '@/lib/mothership/jobs/finalize'
import { jobLaneWorkQuery, runJobLane } from '@/lib/mothership/jobs/lane'
import { jobOccurrenceId, MIN_JOB_CADENCE_MS } from '@/lib/mothership/jobs/occurrence'
import { JOB_DISPATCH_GRACE_MS, reconcileJobRuns } from '@/lib/mothership/jobs/reconcile'
import { takeOverAbandonedRuns } from '@/lib/mothership/request/application/abandoned-runs'
import { startUnattendedTurn } from '@/lib/mothership/request/lifecycle/unattended'
import {
  chatStreamLockKey,
  StreamControllerSupersededError,
} from '@/lib/mothership/request/session/controller-lease'
import { notifyScheduleAutoDisabled } from '@/lib/workflows/schedules/disable-notifications'

interface QueryPlan {
  'Node Type': string
  'Index Name'?: string
  'Shared Hit Blocks': number
  'Shared Read Blocks': number
  Plans?: QueryPlan[]
}

function planNodes(plan: QueryPlan): QueryPlan[] {
  return [plan, ...(plan.Plans ?? []).flatMap(planNodes)]
}

const userId = generateId()
const workspaceId = generateId()

/** The fixture user's billing attribution, which the caller of an unattended turn resolves. */
const payer = () => resolveBillingAttribution({ actorUserId: userId, workspaceId })
const chatIds: string[] = []
const scheduleIds: string[] = []

function redis() {
  const client = getRedisClient()
  if (!client) throw new Error('The integration suite requires TEST_REDIS_URL')
  return client
}

async function waitFor(condition: () => Promise<boolean>, what: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await sleep(50)
  }
  throw new Error(`Timed out waiting for ${what}`)
}

interface JobFixture {
  cronExpression?: string | null
  dueAt?: Date
  maxRuns?: number | null
  runCount?: number
  lifecycle?: 'persistent' | 'until_complete'
}

async function seedJob(options: JobFixture = {}) {
  const chatId = generateId()
  chatIds.push(chatId)
  await db
    .insert(copilotChats)
    .values({ id: chatId, userId, workspaceId, type: 'mothership', title: 'Job chat' })
  const scheduleId = generateId()
  scheduleIds.push(scheduleId)
  const dueAt = options.dueAt ?? new Date(Date.now() - 1_000)
  await db.insert(workflowSchedule).values({
    id: scheduleId,
    triggerType: 'schedule',
    sourceType: 'job',
    jobTitle: 'Nightly triage',
    prompt: 'Triage the overnight queue.',
    successCondition: 'The queue is empty.',
    lifecycle: options.lifecycle ?? 'persistent',
    cronExpression: options.cronExpression === undefined ? '0 * * * *' : options.cronExpression,
    nextRunAt: dueAt,
    maxRuns: options.maxRuns ?? null,
    runCount: options.runCount ?? 0,
    sourceUserId: userId,
    sourceWorkspaceId: workspaceId,
    sourceChatId: chatId,
    secretScope: 'selected',
    mountedSecrets: [],
  })
  return { chatId, scheduleId, occurrenceId: jobOccurrenceId(scheduleId, dueAt), dueAt }
}

async function schedule(scheduleId: string) {
  const [row] = await db
    .select({
      status: workflowSchedule.status,
      nextRunAt: workflowSchedule.nextRunAt,
      runCount: workflowSchedule.runCount,
      failedCount: workflowSchedule.failedCount,
    })
    .from(workflowSchedule)
    .where(eq(workflowSchedule.id, scheduleId))
  return row
}

async function runsOf(scheduleId: string) {
  return db
    .select({
      executionId: jobExecutionLogs.executionId,
      status: jobExecutionLogs.status,
      outcome: jobExecutionLogs.outcome,
      summary: jobExecutionLogs.summary,
      dispatchFailures: sql<
        number | null
      >`(${jobExecutionLogs.executionData}->>'dispatchFailures')::int`,
    })
    .from(jobExecutionLogs)
    .where(eq(jobExecutionLogs.scheduleId, scheduleId))
}

/** The usage gate's answer when the payer's usage can't be read. */
const usageOutage = {
  isExceeded: true,
  message: 'Usage could not be checked.',
  reason: 'usage_unavailable' as const,
}

/** Makes a schedule due again now, as its next occurrence arriving would. */
async function dueAgain(scheduleId: string) {
  const dueAt = new Date(Date.now() - 1_000)
  await db
    .update(workflowSchedule)
    .set({ nextRunAt: dueAt })
    .where(eq(workflowSchedule.id, scheduleId))
  return jobOccurrenceId(scheduleId, dueAt)
}

function legsFor(streamId: string) {
  return worker.requests.filter(
    (request) => request.path === '/api/mothership' && request.body.messageId === streamId
  )
}

/** Reconciler passes (as successive ticks run them) until the occurrence's record is closed. */
async function reconcileUntilSettled(executionId: string) {
  await waitFor(async () => {
    await reconcileJobRuns(new Date())
    const [row] = await db
      .select({ status: jobExecutionLogs.status })
      .from(jobExecutionLogs)
      .where(eq(jobExecutionLogs.executionId, executionId))
    return row?.status === 'complete' || row?.status === 'error'
  }, 'the occurrence to settle')
}

afterAll(async () => {
  /** A test that failed before ending its stream must not hold the server open. */
  worker.server.closeAllConnections()
  await new Promise<void>((resolve) => worker.server.close(() => resolve()))
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe.runIf(Boolean(redisUrl))('the scheduled job lane', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Job lane fixture',
      email: `${userId}@job-lane.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Job lane fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
  })

  beforeEach(async () => {
    worker.requests.length = 0
    resetEnvFlagsMock()
    featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(false)
    await db
      .insert(permissions)
      .values({
        id: generateId(),
        userId,
        entityType: 'workspace',
        entityId: workspaceId,
        permissionType: 'admin',
      })
      .onConflictDoNothing()
    /** Each test sees only its own jobs as due. */
    await db
      .update(workflowSchedule)
      .set({ status: 'disabled' })
      .where(eq(workflowSchedule.sourceWorkspaceId, workspaceId))
  })

  afterAll(async () => {
    for (const scheduleId of scheduleIds) {
      await db.delete(jobExecutionLogs).where(eq(jobExecutionLogs.scheduleId, scheduleId))
      await db.delete(workflowSchedule).where(eq(workflowSchedule.id, scheduleId))
    }
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

  it('does nothing but one indexed probe on a tick with no live jobs', async () => {
    /** What the archive migration leaves behind: retired jobs and their finished run logs. */
    const archivedIds = Array.from({ length: 2_000 }, () => generateId())
    await db.insert(workflowSchedule).values(
      archivedIds.map((id) => ({
        id,
        triggerType: 'schedule',
        sourceType: 'job',
        status: 'disabled',
        archivedAt: new Date(),
        nextRunAt: new Date(Date.now() - 60_000),
        sourceUserId: userId,
        sourceWorkspaceId: workspaceId,
      }))
    )
    await db.insert(jobExecutionLogs).values(
      Array.from({ length: 5_000 }, () => {
        const id = generateId()
        return {
          id,
          executionId: id,
          workspaceId,
          level: 'info',
          status: 'completed',
          trigger: 'mothership',
          startedAt: new Date(Date.now() - 60_000),
        }
      })
    )
    await db.execute(sql`ANALYZE workflow_schedule, job_execution_logs`)
    const now = new Date()
    vi.mocked(claimDueJobOccurrences).mockClear()
    vi.mocked(reconcileJobRuns).mockClear()

    try {
      expect(await runJobLane(now)).toEqual({ claimed: 0 })
      expect(claimDueJobOccurrences).not.toHaveBeenCalled()
      expect(reconcileJobRuns).not.toHaveBeenCalled()

      const plans = await db.execute<{ 'QUERY PLAN': { Plan: QueryPlan }[] }>(
        sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${jobLaneWorkQuery(now)}`
      )
      const plan = plans[0]['QUERY PLAN'][0].Plan
      const nodes = planNodes(plan)
      expect(nodes.some((node) => node['Node Type'] === 'Seq Scan')).toBe(false)
      expect(nodes.map((node) => node['Index Name']).filter(Boolean)).toEqual(
        expect.arrayContaining(['workflow_schedule_due_job_idx', 'job_execution_logs_open_idx'])
      )
      expect(plan['Shared Hit Blocks'] + plan['Shared Read Blocks']).toBeLessThan(20)
    } finally {
      await db.delete(jobExecutionLogs).where(eq(jobExecutionLogs.workspaceId, workspaceId))
      await db.delete(workflowSchedule).where(inArray(workflowSchedule.id, archivedIds))
    }
  })

  it('records an occurrence once when two ticks claim it at the same time, and starts it once', async () => {
    const { scheduleId, occurrenceId, dueAt } = await seedJob()
    const now = new Date()

    const [first, second] = await Promise.all([
      claimDueJobOccurrences(now, 10),
      claimDueJobOccurrences(now, 10),
    ])
    const claims = [...first, ...second].filter((claim) => claim.scheduleId === scheduleId)
    expect(claims).toEqual([{ executionId: occurrenceId, scheduleId, occurrenceAt: dueAt }])
    expect(await runsOf(scheduleId)).toHaveLength(1)
    expect(await schedule(scheduleId)).toMatchObject({ status: 'active', runCount: 1 })
    /** The next occurrence is the cron's next hour, never sooner than the minimum cadence. */
    const { nextRunAt } = await schedule(scheduleId)
    expect(nextRunAt?.getTime()).toBeGreaterThanOrEqual(dueAt.getTime() + MIN_JOB_CADENCE_MS)

    const outcomes = await Promise.all([
      dispatchJobOccurrence(occurrenceId),
      dispatchJobOccurrence(occurrenceId),
    ])
    expect(outcomes.filter((outcome) => outcome === 'started')).toHaveLength(1)
    await reconcileUntilSettled(occurrenceId)
    expect(legsFor(occurrenceId)).toHaveLength(1)
    expect(await runsOf(scheduleId)).toEqual([
      expect.objectContaining({
        status: 'complete',
        outcome: 'not_met',
        summary: 'Nothing to do.',
      }),
    ])
  })

  it('dispatches an occurrence whose claim committed but whose dispatch was lost, once', async () => {
    const { scheduleId, occurrenceId } = await seedJob()
    await claimDueJobOccurrences(new Date(), 10)

    /** Within the grace the dispatch may still be in flight elsewhere: nothing happens. */
    await reconcileJobRuns(new Date())
    expect(legsFor(occurrenceId)).toHaveLength(0)

    const later = new Date(Date.now() + JOB_DISPATCH_GRACE_MS + 1_000)
    await Promise.all([reconcileJobRuns(later), reconcileJobRuns(later)])
    await reconcileUntilSettled(occurrenceId)
    await reconcileJobRuns(later)

    expect(legsFor(occurrenceId)).toHaveLength(1)
    expect(await dispatchJobOccurrence(occurrenceId)).toBe('not_queued')
    const [chatRun] = await db
      .select({ chatId: copilotRuns.chatId })
      .from(copilotRuns)
      .where(eq(copilotRuns.streamId, occurrenceId))
    expect(
      await startUnattendedTurn({
        userId,
        workspaceId,
        chatId: chatRun.chatId,
        messageId: occurrenceId,
        message: 'again',
        origin: 'job',
        billingAttribution: await payer(),
        secretAuthority: {
          secretMountPolicy: { secretScope: 'selected', mountedSecrets: [] },
          secretActorUserId: userId,
        },
      })
    ).toBe('duplicate')
    expect(await runsOf(scheduleId)).toHaveLength(1)
  })

  it('finishes an occurrence whose Sim process died mid-run, finalizing it exactly once', async () => {
    const { chatId, scheduleId, occurrenceId } = await seedJob()
    worker.legs.set(occurrenceId, [
      { text: 'Started triage. ', mode: 'hang' },
      { text: 'Finished triage.', mode: 'end' },
    ])
    await runJobLane(new Date())
    await waitFor(async () => worker.open.has(occurrenceId), 'the first leg')

    controllers.get(occurrenceId)?.abort(new StreamControllerSupersededError())
    worker.open.get(occurrenceId)?.response.socket?.destroy()
    worker.open.delete(occurrenceId)
    await waitFor(async () => !(await redis().get(chatStreamLockKey(chatId))), 'the lock to lapse')
    /** Before the takeover the turn is unfinished, so the occurrence stays running. */
    expect(await finalizeJobRun(occurrenceId)).toBe(false)
    await db
      .update(copilotRuns)
      .set({ updatedAt: sql`now() - interval '2 minutes'` })
      .where(eq(copilotRuns.streamId, occurrenceId))
    await waitFor(async () => {
      await redis().del(ABANDONED_RUN_CURSOR_KEY)
      await takeOverAbandonedRuns()
      return legsFor(occurrenceId).length === 2
    }, 'the takeover')
    await waitFor(async () => {
      const [run] = await db
        .select({ status: copilotRuns.status })
        .from(copilotRuns)
        .where(eq(copilotRuns.streamId, occurrenceId))
      return run?.status === 'complete'
    }, 'the turn to complete')

    const settled = await Promise.all([
      finalizeJobRun(occurrenceId),
      finalizeJobRun(occurrenceId),
      finalizeJobRun(occurrenceId),
    ])
    expect(settled.filter(Boolean)).toHaveLength(1)
    expect(await runsOf(scheduleId)).toEqual([
      expect.objectContaining({
        status: 'complete',
        outcome: 'not_met',
        summary: 'Started triage. Finished triage.',
      }),
    ])
    expect(await schedule(scheduleId)).toMatchObject({ failedCount: 0, status: 'active' })
  }, 60_000)

  it('stops a run at its time limit as a person pressing Stop would, ending it interrupted', async () => {
    const { scheduleId, occurrenceId } = await seedJob()
    worker.legs.set(occurrenceId, [{ text: 'Still triaging. ', mode: 'hang' }])
    await runJobLane(new Date())
    await waitFor(async () => worker.open.has(occurrenceId), 'the first leg')

    await reconcileJobRuns(new Date(Date.now() + 6 * 60 * 60_000 + 60_000))
    await reconcileUntilSettled(occurrenceId)

    expect(
      worker.requests.filter(
        (request) =>
          request.path === '/api/streams/explicit-abort' && request.body.messageId === occurrenceId
      )
    ).toHaveLength(1)
    expect(await runsOf(scheduleId)).toEqual([
      expect.objectContaining({
        status: 'complete',
        outcome: 'interrupted',
        summary: 'Stopped at the run time limit.',
      }),
    ])
    worker.open.get(occurrenceId)?.response.end()
    worker.open.delete(occurrenceId)
  }, 60_000)

  it('delivers a time-limit Stop an earlier pass recorded but died delivering, before finalizing', async () => {
    const { scheduleId, occurrenceId } = await seedJob()
    worker.legs.set(occurrenceId, [{ text: 'Still triaging. ', mode: 'hang' }])
    await runJobLane(new Date())
    await waitFor(async () => worker.open.has(occurrenceId), 'the first leg')
    /** What a pass leaves when it dies after recording why the run stops, before delivering it. */
    await db
      .update(jobExecutionLogs)
      .set({ executionData: sql`jsonb_build_object('deadlineStopRequestedAt', now())` })
      .where(eq(jobExecutionLogs.executionId, occurrenceId))

    await reconcileUntilSettled(occurrenceId)

    expect(
      worker.requests.filter(
        (request) =>
          request.path === '/api/streams/explicit-abort' && request.body.messageId === occurrenceId
      )
    ).toHaveLength(1)
    expect(await runsOf(scheduleId)).toEqual([
      expect.objectContaining({
        outcome: 'interrupted',
        summary: 'Stopped at the run time limit.',
      }),
    ])
    worker.open.get(occurrenceId)?.response.end()
    worker.open.delete(occurrenceId)
  }, 60_000)

  it('does not report a job a person turned off as turned off by its failures', async () => {
    vi.mocked(notifyScheduleAutoDisabled).mockClear()
    const { scheduleId, occurrenceId } = await seedJob()
    worker.legs.set(occurrenceId, [{ text: 'Still triaging. ', mode: 'hang' }])
    await runJobLane(new Date())
    await waitFor(async () => worker.open.has(occurrenceId), 'the first leg')
    /** Off by hand with two failures behind it, while this run is still live. */
    await db
      .update(workflowSchedule)
      .set({ status: 'disabled', failedCount: 2 })
      .where(eq(workflowSchedule.id, scheduleId))

    await reconcileJobRuns(new Date(Date.now() + 6 * 60 * 60_000 + 60_000))
    await reconcileUntilSettled(occurrenceId)

    expect(await schedule(scheduleId)).toMatchObject({ status: 'disabled', failedCount: 3 })
    expect(notifyScheduleAutoDisabled).not.toHaveBeenCalled()
    worker.open.get(occurrenceId)?.response.end()
    worker.open.delete(occurrenceId)
  }, 60_000)

  it('briefs a retried occurrence with its own run number, not the job count a later claim moved', async () => {
    const { scheduleId, occurrenceId } = await seedJob()
    await claimDueJobOccurrences(new Date(), 10)
    const later = await dueAgain(scheduleId)
    await claimDueJobOccurrences(new Date(), 10)
    expect(await schedule(scheduleId)).toMatchObject({ runCount: 2 })

    for (const id of [occurrenceId, later]) {
      await dispatchJobOccurrence(id)
      await reconcileUntilSettled(id)
    }

    expect(legsFor(occurrenceId)[0]?.body.message).toContain('(Run 1, scheduled for')
    expect(legsFor(later)[0]?.body.message).toContain('(Run 2, scheduled for')
  })

  it('leaves an occurrence another attempt is dispatching to that attempt', async () => {
    const { scheduleId, occurrenceId } = await seedJob()
    await claimDueJobOccurrences(new Date(), 10)
    const lock = `mothership:job-dispatch:${occurrenceId}`
    expect(await acquireLock(lock, 'another-attempt', 60)).toBe(true)
    try {
      expect(await dispatchJobOccurrence(occurrenceId)).toBe('already_started')
      expect(legsFor(occurrenceId)).toHaveLength(0)
      expect(await runsOf(scheduleId)).toEqual([expect.objectContaining({ status: 'queued' })])
    } finally {
      await releaseLock(lock, 'another-attempt')
    }
    expect(await dispatchJobOccurrence(occurrenceId)).toBe('started')
    await reconcileUntilSettled(occurrenceId)
  })

  it('retries an occurrence whose usage could not be read, and runs it once usage reads again', async () => {
    setEnvFlags({ isHosted: true })
    const { scheduleId, occurrenceId } = await seedJob()
    vi.mocked(checkAttributedUsageLimits).mockResolvedValueOnce(usageOutage)
    await runJobLane(new Date())
    expect(await runsOf(scheduleId)).toEqual([
      expect.objectContaining({ status: 'queued', outcome: null, dispatchFailures: 1 }),
    ])

    vi.mocked(checkAttributedUsageLimits).mockResolvedValueOnce({ isExceeded: false })
    await reconcileJobRuns(new Date(Date.now() + JOB_DISPATCH_GRACE_MS + 1_000))
    await reconcileUntilSettled(occurrenceId)
    expect(legsFor(occurrenceId)).toHaveLength(1)
    expect(await runsOf(scheduleId)).toEqual([
      expect.objectContaining({ status: 'complete', outcome: 'not_met', dispatchFailures: 1 }),
    ])
  })

  it('ends an occurrence whose usage stays unreadable at its last attempt, and skips one whose billing is blocked', async () => {
    setEnvFlags({ isHosted: true })
    const outage = await seedJob()
    await claimDueJobOccurrences(new Date(), 10)
    for (let attempt = 1; attempt <= 5; attempt++) {
      vi.mocked(checkAttributedUsageLimits).mockResolvedValueOnce(usageOutage)
      expect(await dispatchJobOccurrence(outage.occurrenceId)).toBe(
        attempt < 5 ? 'retry' : 'failed'
      )
    }
    expect(await runsOf(outage.scheduleId)).toEqual([
      expect.objectContaining({ outcome: 'failed', summary: 'The run could not be started.' }),
    ])
    expect(legsFor(outage.occurrenceId)).toHaveLength(0)

    const blocked = await seedJob()
    await claimDueJobOccurrences(new Date(), 10)
    vi.mocked(checkAttributedUsageLimits).mockResolvedValueOnce({
      isExceeded: true,
      message: 'Billing is blocked for this account.',
      reason: 'billing_blocked',
    })
    expect(await dispatchJobOccurrence(blocked.occurrenceId)).toBe('skipped_budget')
    expect(await runsOf(blocked.scheduleId)).toEqual([
      expect.objectContaining({
        outcome: 'skipped_budget',
        summary: 'Billing is blocked for this account.',
      }),
    ])
  })

  it('runs a one-shot job once and completes it', async () => {
    const { scheduleId, occurrenceId } = await seedJob({ cronExpression: null })
    await runJobLane(new Date())
    await reconcileUntilSettled(occurrenceId)
    await runJobLane(new Date())

    expect(await schedule(scheduleId)).toMatchObject({
      status: 'completed',
      nextRunAt: null,
      runCount: 1,
    })
    expect(await runsOf(scheduleId)).toHaveLength(1)
    expect(legsFor(occurrenceId)).toHaveLength(1)
  })

  it('completes a job whose max_runs is spent without running it', async () => {
    const { scheduleId, occurrenceId } = await seedJob({ maxRuns: 2, runCount: 2 })
    await runJobLane(new Date())
    expect(await schedule(scheduleId)).toMatchObject({ status: 'completed', runCount: 2 })
    expect(await runsOf(scheduleId)).toEqual([])
    expect(legsFor(occurrenceId)).toHaveLength(0)
  })

  it('skips an occurrence while another turn holds the job chat', async () => {
    const { chatId, scheduleId, occurrenceId } = await seedJob()
    await redis().set(chatStreamLockKey(chatId), `${generateId()}\n${generateId()}`, 'EX', 60)
    try {
      await runJobLane(new Date())
    } finally {
      await redis().del(chatStreamLockKey(chatId))
    }
    expect(await runsOf(scheduleId)).toEqual([
      expect.objectContaining({ status: 'complete', outcome: 'skipped_busy' }),
    ])
    expect(legsFor(occurrenceId)).toHaveLength(0)
    expect(await schedule(scheduleId)).toMatchObject({ failedCount: 0, status: 'active' })
  })

  it('turns the job off, starting nothing, once its owner lost access', async () => {
    const { scheduleId, occurrenceId } = await seedJob()
    await db.delete(permissions).where(eq(permissions.userId, userId))
    await runJobLane(new Date())
    expect(await runsOf(scheduleId)).toEqual([
      expect.objectContaining({ status: 'complete', outcome: 'blocked' }),
    ])
    expect(await schedule(scheduleId)).toMatchObject({ status: 'disabled' })
    expect(legsFor(occurrenceId)).toHaveLength(0)
  })

  it('completes an until_complete job once a run reports its condition met', async () => {
    const { chatId, scheduleId, occurrenceId } = await seedJob({ lifecycle: 'until_complete' })
    worker.legs.set(occurrenceId, [{ text: 'The queue is empty.', mode: 'hang' }])
    await runJobLane(new Date())
    await waitFor(async () => worker.open.has(occurrenceId), 'the leg')
    /** What `jobs report --outcome met` records while the run is live. */
    await db
      .update(jobExecutionLogs)
      .set({ outcome: 'met', summary: 'Queue empty.' })
      .where(eq(jobExecutionLogs.executionId, occurrenceId))
    worker.finish(occurrenceId, chatId)
    await waitFor(async () => {
      const [run] = await db
        .select({ status: copilotRuns.status })
        .from(copilotRuns)
        .where(eq(copilotRuns.streamId, occurrenceId))
      return run?.status === 'complete'
    }, 'the turn to complete')
    /** The next occurrence comes due before any pass settled the met run. */
    await dueAgain(scheduleId)
    await runJobLane(new Date())

    expect(await runsOf(scheduleId)).toEqual([
      expect.objectContaining({ status: 'complete', outcome: 'met', summary: 'Queue empty.' }),
    ])
    expect(await schedule(scheduleId)).toMatchObject({ status: 'completed', nextRunAt: null })
  })

  it('gives a recovered run back the spend-cap link its dead process never wrote', async () => {
    const { chatId, scheduleId, occurrenceId } = await seedJob()
    worker.legs.set(occurrenceId, [{ text: 'Working.', mode: 'hang' }])
    await runJobLane(new Date())
    await waitFor(async () => worker.open.has(occurrenceId), 'the leg')
    const billingRequestId = generateId()
    /** Its admission was recorded on the run, then the process died before linking the record. */
    await db
      .update(copilotRuns)
      .set({
        requestContext: sql`jsonb_set(${copilotRuns.requestContext}, '{recovery,billingAdmission}', ${JSON.stringify({ billingRequestId, serializedAttribution: 'fixture' })}::jsonb)`,
      })
      .where(eq(copilotRuns.streamId, occurrenceId))
    await db
      .update(jobExecutionLogs)
      .set({ billingRequestId: null })
      .where(eq(jobExecutionLogs.executionId, occurrenceId))

    await reconcileJobRuns(new Date())

    const [record] = await db
      .select({ billingRequestId: jobExecutionLogs.billingRequestId })
      .from(jobExecutionLogs)
      .where(eq(jobExecutionLogs.scheduleId, scheduleId))
    expect(record?.billingRequestId).toBe(billingRequestId)
    worker.finish(occurrenceId, chatId)
    await reconcileUntilSettled(occurrenceId)
  })

  it('ends a running occurrence whose run was removed, instead of re-reading it forever', async () => {
    const { chatId, scheduleId, occurrenceId } = await seedJob()
    worker.legs.set(occurrenceId, [{ text: 'Working.', mode: 'hang' }])
    await runJobLane(new Date())
    await waitFor(async () => worker.open.has(occurrenceId), 'the leg')
    controllers.get(occurrenceId)?.abort(new StreamControllerSupersededError())
    worker.open.get(occurrenceId)?.response.socket?.destroy()
    worker.open.delete(occurrenceId)
    await waitFor(async () => !(await redis().get(chatStreamLockKey(chatId))), 'the lock to lapse')
    await db.delete(copilotRuns).where(eq(copilotRuns.streamId, occurrenceId))

    await reconcileJobRuns(new Date(Date.now() + 6 * 60 * 60_000 + 60_000))

    expect(await runsOf(scheduleId)).toEqual([
      expect.objectContaining({ status: 'complete', outcome: 'interrupted' }),
    ])
  }, 60_000)

  it('ends a queued occurrence whose job was deleted, so the lane goes idle', async () => {
    const { scheduleId, occurrenceId } = await seedJob()
    await claimDueJobOccurrences(new Date(), 10)
    await db.delete(workflowSchedule).where(eq(workflowSchedule.id, scheduleId))

    await reconcileJobRuns(new Date())

    const [record] = await db
      .select({ status: jobExecutionLogs.status, outcome: jobExecutionLogs.outcome })
      .from(jobExecutionLogs)
      .where(eq(jobExecutionLogs.executionId, occurrenceId))
    expect(record).toEqual({ status: 'complete', outcome: 'blocked' })
    await db.delete(jobExecutionLogs).where(eq(jobExecutionLogs.executionId, occurrenceId))
  })

  it('turns a job off after three failed runs in a row, and a verdict clears the streak', async () => {
    vi.mocked(notifyScheduleAutoDisabled).mockClear()
    const { scheduleId, occurrenceId } = await seedJob()
    const fail = (id: string) =>
      worker.legs.set(
        id,
        Array.from({ length: 6 }, () => ({ text: '', mode: 'fail' as const }))
      )
    fail(occurrenceId)
    await runJobLane(new Date())
    await reconcileUntilSettled(occurrenceId)
    expect(await schedule(scheduleId)).toMatchObject({ failedCount: 1, status: 'active' })

    const recovered = await dueAgain(scheduleId)
    await runJobLane(new Date())
    await reconcileUntilSettled(recovered)
    expect(await schedule(scheduleId)).toMatchObject({ failedCount: 0, status: 'active' })

    for (let failure = 1; failure <= 3; failure++) {
      const id = await dueAgain(scheduleId)
      fail(id)
      await runJobLane(new Date())
      await reconcileUntilSettled(id)
      expect(await schedule(scheduleId)).toMatchObject({
        failedCount: failure,
        status: failure < 3 ? 'active' : 'disabled',
      })
    }
    const outcomes = (await runsOf(scheduleId)).map((run) => run.outcome).sort()
    expect(outcomes).toEqual(['failed', 'failed', 'failed', 'failed', 'not_met'])
    expect(notifyScheduleAutoDisabled).toHaveBeenCalledExactlyOnceWith({
      scheduleId,
      reason: 'consecutive_failures',
    })

    await dueAgain(scheduleId)
    await runJobLane(new Date())
    expect(await runsOf(scheduleId)).toHaveLength(5)
  }, 120_000)

  it('pauses a job run once its settled cost reaches the cap, across out-of-order callbacks', async () => {
    const { scheduleId, occurrenceId } = await seedJob()
    await claimDueJobOccurrences(new Date(), 10)
    const billingRequestId = generateId()
    await db
      .update(jobExecutionLogs)
      .set({ billingRequestId })
      .where(eq(jobExecutionLogs.executionId, occurrenceId))
    await db
      .update(workflowSchedule)
      .set({ runBudgetUsd: '1.5000' })
      .where(eq(workflowSchedule.id, scheduleId))

    expect(await recordJobRunSpend(billingRequestId, 0.9)).toBeNull()
    expect(await recordJobRunSpend(billingRequestId, 1.6)).toMatchObject({
      reason: 'job_run_budget',
      action: 'increase_limit',
    })
    /** A late, lower cumulative callback never lowers the recorded spend. */
    expect(await recordJobRunSpend(billingRequestId, 1.2)).toMatchObject({
      reason: 'job_run_budget',
    })
    const [row] = await db
      .select({ cost: jobExecutionLogs.cost })
      .from(jobExecutionLogs)
      .where(eq(jobExecutionLogs.executionId, occurrenceId))
    expect(row.cost).toEqual({ total: 1.6 })
    expect(await recordJobRunSpend(generateId(), 100)).toBeNull()
  })
})
