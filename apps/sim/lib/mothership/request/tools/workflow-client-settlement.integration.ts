import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
/**
 * A browser claims a Chat workflow tool, the execute route runs it, and the browser may never
 * report back (tab closed, network lost, beacon dropped). Runs against real PostgreSQL and Redis:
 * the claim, settlement, execution log lookup, guarded completion, published confirmation and the
 * Chat-side waiter are production code.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedEnv } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const url = readTestRedisUrl()
  const inheritedEnv = { REDIS_URL: process.env.REDIS_URL }
  /** The real Redis module and the confirmation channel read this at import. */
  process.env.REDIS_URL = url
  return { redisUrl: url, inheritedEnv }
})

import { db } from '@sim/db'
import {
  copilotAsyncToolCalls,
  copilotChats,
  copilotRuns,
  pausedExecutions,
  user,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import { SIM_TOOL_EXECUTION_VERSION } from '@/lib/mothership/async-runs/lifecycle'
import {
  claimToolExecution,
  claimWorkflowToolExecution,
  completeAsyncToolCall,
  detachAsyncToolCall,
  getDetachedWorkflowExecutions,
  prepareWorkbenchAccess,
  settleClientWorkflowToolExecution,
  upsertAsyncToolCall,
} from '@/lib/mothership/async-runs/repository'
import { getToolConfirmation } from '@/lib/mothership/persistence/tool-confirm'
import { waitForWorkflowToolCompletion } from '@/lib/mothership/request/tools/client'
import { raceWorkflowToolClientPickup } from '@/lib/mothership/request/tools/workflow-client-fallback'
import {
  reportQueuedClientWorkflowTool,
  reportSettledClientWorkflowTool,
} from '@/lib/mothership/request/tools/workflow-client-settlement'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session-key'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'

/** Longer than the waiter's durable poll, far shorter than the hour it used to park for. */
const WAIT_MS = 10_000
const APPROVAL_CONTEXT_ID = 'approval'

/** Carries no snapshot metadata, so a resume of it fails the run. */
const UNRESUMABLE_SNAPSHOT = '{}'

/** The resume engine, private to the manager; the one piece a test of its settling stands in for. */
interface ResumeEngine {
  runResumeExecution: (...args: unknown[]) => Promise<unknown>
}

/**
 * The confirmation a report published for the worker's durable waiter. Reads on the publisher's
 * own connection, so it is ordered after any confirmation the report already sent.
 */
async function publishedConfirmation(toolCallId: string) {
  const client = getRedisClient()
  if (!client) throw new Error('The integration suite requires TEST_REDIS_URL')
  const value = await client.get(`copilot:tool-confirmation:${toolCallId}`)
  return value === null ? null : JSON.parse(value)
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

describe.runIf(Boolean(redisUrl))('settled client-claimed workflow tools', () => {
  const userId = generateId()
  const workspaceId = generateId()
  const workflowId = generateId()
  const chatId = generateId()
  const runId = generateId()
  const streamId = generateId()
  const snapshotIds: string[] = []

  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Workflow settlement fixture',
      email: `${userId}@workflow-settlement.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Workflow settlement fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(workflow).values({
      id: workflowId,
      userId,
      workspaceId,
      name: 'Workflow settlement fixture',
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
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
      streamId,
      toolExecutionVersion: SIM_TOOL_EXECUTION_VERSION,
      status: 'paused_waiting_for_tool',
      requestContext: { source: 'headless_lifecycle' },
    })
  })

  afterAll(async () => {
    await db.delete(copilotChats).where(eq(copilotChats.id, chatId))
    // Deleting a paused execution cascades to its resume queue entries.
    await db.delete(pausedExecutions).where(eq(pausedExecutions.workflowId, workflowId))
    await db.delete(workflowExecutionLogs).where(eq(workflowExecutionLogs.workspaceId, workspaceId))
    if (snapshotIds.length)
      await db
        .delete(workflowExecutionSnapshots)
        .where(inArray(workflowExecutionSnapshots.id, snapshotIds))
    await db.delete(workflow).where(eq(workflow.id, workflowId))
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
  })

  /** The execute route's durable log of one bound execution, as the Chat waiter reads it. */
  async function executionLog(
    toolCallId: string,
    executionId: string,
    status: 'completed' | 'failed' | 'cancelled' | 'pending' | 'running'
  ) {
    const snapshotId = generateId()
    snapshotIds.push(snapshotId)
    await db
      .insert(workflowExecutionSnapshots)
      .values({ id: snapshotId, stateHash: generateId(), stateData: {} })
    const now = new Date()
    await db.insert(workflowExecutionLogs).values({
      id: generateId(),
      workflowId,
      workspaceId,
      executionId,
      stateSnapshotId: snapshotId,
      level: status === 'completed' ? 'info' : 'error',
      status,
      trigger: 'copilot',
      startedAt: now,
      endedAt: now,
      executionData: { correlation: { copilotToolCallId: toolCallId } },
    })
  }

  /** A run_workflow call the browser claimed through the execute route. */
  async function claimed(args: Record<string, unknown> = { workflowId }) {
    const toolCallId = generateId()
    const executionId = generateId()
    await db.insert(copilotAsyncToolCalls).values({
      runId,
      toolCallId,
      toolName: 'run_workflow',
      args,
      status: 'running',
    })
    expect(await claimWorkflowToolExecution(toolCallId, executionId, 'client')).not.toBeNull()
    return { toolCallId, executionId }
  }

  /** A claimed call whose bound execution ran to `status`. */
  async function claimedAndSettled(status: 'completed' | 'failed' | 'cancelled' = 'completed') {
    const { toolCallId, executionId } = await claimed()
    await executionLog(toolCallId, executionId, status)
    await settleClientWorkflowToolExecution(toolCallId, executionId)
    return { toolCallId, executionId }
  }

  /**
   * A claimed call whose bound execution paused at a human approval: the execute route settled the
   * claim and its own report left the call running, as it does for every paused execution.
   */
  async function claimedAndPaused(snapshot: string = UNRESUMABLE_SNAPSHOT) {
    const { toolCallId, executionId } = await claimed()
    await executionLog(toolCallId, executionId, 'pending')
    await db.insert(pausedExecutions).values({
      id: generateId(),
      workflowId,
      executionId,
      executionSnapshot: { snapshot, triggerIds: [] },
      pausePoints: {
        [APPROVAL_CONTEXT_ID]: {
          contextId: APPROVAL_CONTEXT_ID,
          blockId: APPROVAL_CONTEXT_ID,
          response: {},
          registeredAt: new Date().toISOString(),
          resumeStatus: 'paused',
          snapshotReady: true,
          pauseKind: 'human',
        },
      },
      totalPauseCount: 1,
    })
    await settleClientWorkflowToolExecution(toolCallId, executionId)
    await reportSettledClientWorkflowTool({ toolCallId, executionId, workflowId })
    expect(await toolRow(toolCallId)).toMatchObject({ status: 'running', result: null })
    return { toolCallId, executionId }
  }

  async function setLogStatus(executionId: string, status: 'completed' | 'failed' | 'cancelled') {
    await db
      .update(workflowExecutionLogs)
      .set({ status, endedAt: new Date() })
      .where(eq(workflowExecutionLogs.executionId, executionId))
  }

  async function toolRow(toolCallId: string) {
    const [row] = await db
      .select()
      .from(copilotAsyncToolCalls)
      .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
    return row
  }

  it.each([
    ['completed', 'success', { success: true }],
    ['failed', 'error', { success: false }],
    ['cancelled', 'cancelled', { success: false, reason: 'user_cancelled', cancelledByUser: true }],
  ] as const)(
    'delivers a %s run to the waiting Chat turn when the browser never reports',
    async (logStatus, outcome, data) => {
      const { toolCallId, executionId } = await claimedAndSettled(logStatus)
      const waiting = waitForWorkflowToolCompletion({ toolCallId, workflowId, timeoutMs: WAIT_MS })

      await reportSettledClientWorkflowTool({ toolCallId, executionId, workflowId })

      const completion = await waiting
      expect(completion).toMatchObject({
        status: outcome,
        data: { ...data, workflowId, executionId },
      })
      expect(await toolRow(toolCallId)).toMatchObject({
        status: logStatus,
        claimedBy: null,
        result: { ...data, workflowId, executionId },
      })
      expect(await publishedConfirmation(toolCallId)).toMatchObject({
        status: outcome,
        executionId,
      })
    }
  )

  it('keeps the browser report that landed first', async () => {
    const { toolCallId, executionId } = await claimedAndSettled()
    const reported = await completeAsyncToolCall({
      toolCallId,
      status: 'completed',
      result: { success: true, workflowId, executionId },
    })

    await reportSettledClientWorkflowTool({ toolCallId, executionId, workflowId })

    expect((await toolRow(toolCallId)).completedAt).toEqual(reported?.completedAt)
    expect(await publishedConfirmation(toolCallId)).toBeNull()
  })

  it('keeps a background detach the browser reported on pagehide', async () => {
    const { toolCallId, executionId } = await claimedAndSettled()
    await detachAsyncToolCall(toolCallId, { preserveClaim: true })

    await reportSettledClientWorkflowTool({ toolCallId, executionId, workflowId })

    expect(await toolRow(toolCallId)).toMatchObject({ status: 'delivered', result: null })
    expect(await publishedConfirmation(toolCallId)).toBeNull()
  })

  it('never completes a call bound to a different execution', async () => {
    const { toolCallId } = await claimedAndSettled()
    const strayExecutionId = generateId()
    await executionLog(toolCallId, strayExecutionId, 'completed')

    await reportSettledClientWorkflowTool({
      toolCallId,
      executionId: strayExecutionId,
      workflowId,
    })

    expect(await toolRow(toolCallId)).toMatchObject({ status: 'running', result: null })
    expect(await publishedConfirmation(toolCallId)).toBeNull()
  })

  it('delivers an execution that ended before it wrote a log as failed', async () => {
    const { toolCallId, executionId } = await claimed()
    const waiting = waitForWorkflowToolCompletion({ toolCallId, workflowId, timeoutMs: WAIT_MS })

    await reportSettledClientWorkflowTool({ toolCallId, executionId, workflowId })

    expect(await waiting).toMatchObject({
      status: 'error',
      data: { success: false, workflowId, executionId },
    })
    expect(await toolRow(toolCallId)).toMatchObject({ status: 'failed', claimedBy: null })
  })

  it('delivers a paused execution a resume completes', async () => {
    const { toolCallId, executionId } = await claimedAndPaused(
      JSON.stringify({
        metadata: {
          workspaceId,
          userId,
          billingAttribution: {
            actorUserId: userId,
            workspaceId,
            organizationId: null,
            billedAccountUserId: userId,
            billingEntity: { type: 'user', id: userId },
            billingPeriod: { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
            payerSubscription: null,
          },
        },
      })
    )
    const waiting = waitForWorkflowToolCompletion({ toolCallId, workflowId, timeoutMs: WAIT_MS })
    const started = await PauseResumeManager.enqueueOrStartResume({
      executionId,
      workflowId,
      contextId: APPROVAL_CONTEXT_ID,
      resumeInput: {},
      userId,
    })
    if (started.status !== 'starting') throw new Error('The resume was queued instead of started')
    // Only the engine stands in: it completes the parent's log as a finished resume does.
    // double-cast-allowed: runResumeExecution is private; the test stands in only for the resume engine
    const resumeEngine = PauseResumeManager as unknown as ResumeEngine
    const engine = vi.spyOn(resumeEngine, 'runResumeExecution').mockImplementationOnce(async () => {
      await setLogStatus(executionId, 'completed')
      return {
        success: true,
        status: 'completed',
        output: {},
        logs: [],
        metadata: { executionId, duration: 1, startTime: 'start' },
      }
    })

    try {
      await PauseResumeManager.startResumeExecution({
        resumeEntryId: started.resumeEntryId,
        resumeExecutionId: started.resumeExecutionId,
        pausedExecution: started.pausedExecution,
        contextId: started.contextId,
        resumeInput: started.resumeInput,
        userId: started.userId,
      })
    } finally {
      engine.mockRestore()
    }

    expect(await waiting).toMatchObject({
      status: 'success',
      data: { success: true, workflowId, executionId },
    })
    expect(await toolRow(toolCallId)).toMatchObject({ status: 'completed', claimedBy: null })
  })

  it('delivers a paused execution whose resume failed the run', async () => {
    const { toolCallId, executionId } = await claimedAndPaused()
    const waiting = waitForWorkflowToolCompletion({ toolCallId, workflowId, timeoutMs: WAIT_MS })
    const started = await PauseResumeManager.enqueueOrStartResume({
      executionId,
      workflowId,
      contextId: APPROVAL_CONTEXT_ID,
      resumeInput: {},
      userId,
    })
    if (started.status !== 'starting') throw new Error('The resume was queued instead of started')

    await expect(
      PauseResumeManager.startResumeExecution({
        resumeEntryId: started.resumeEntryId,
        resumeExecutionId: started.resumeExecutionId,
        pausedExecution: started.pausedExecution,
        contextId: started.contextId,
        resumeInput: started.resumeInput,
        userId: started.userId,
      })
    ).rejects.toThrow()

    expect(await waiting).toMatchObject({
      status: 'error',
      data: { success: false, workflowId, executionId },
    })
    expect(await toolRow(toolCallId)).toMatchObject({ status: 'failed', claimedBy: null })
    expect(await publishedConfirmation(toolCallId)).toMatchObject({ status: 'error', executionId })
  })

  it('delivers a paused execution cancelled before it resumed', async () => {
    const { toolCallId, executionId } = await claimedAndPaused()
    const waiting = waitForWorkflowToolCompletion({ toolCallId, workflowId, timeoutMs: WAIT_MS })

    expect(await PauseResumeManager.beginPausedCancellation(executionId, workflowId)).toBe(true)
    expect(await PauseResumeManager.completePausedCancellation(executionId, workflowId)).toBe(true)

    expect(await waiting).toMatchObject({
      status: 'cancelled',
      data: { success: false, workflowId, executionId },
    })
    expect(await toolRow(toolCallId)).toMatchObject({ status: 'cancelled', claimedBy: null })
    expect(await publishedConfirmation(toolCallId)).toMatchObject({
      status: 'cancelled',
      executionId,
    })
  })

  it('delivers a paused execution whose cancel lost the race to a run that ended unreported', async () => {
    const { toolCallId, executionId } = await claimedAndPaused()
    const waiting = waitForWorkflowToolCompletion({ toolCallId, workflowId, timeoutMs: WAIT_MS })
    expect(await PauseResumeManager.beginPausedCancellation(executionId, workflowId)).toBe(true)
    // The stale-execution sweep fails the run's log and reports nothing to Copilot.
    await setLogStatus(executionId, 'failed')

    expect(
      await PauseResumeManager.finalizePausedCancellationForTerminalRun(executionId, workflowId, [])
    ).toBe(true)

    expect(await waiting).toMatchObject({
      status: 'error',
      data: { success: false, workflowId, executionId },
    })
    expect(await toolRow(toolCallId)).toMatchObject({ status: 'failed', claimedBy: null })
  })

  it('moves a queued async run to the background when the browser never reports', async () => {
    const { toolCallId, executionId } = await claimed({ workflowId, async: true })
    const waiting = waitForWorkflowToolCompletion({ toolCallId, workflowId, timeoutMs: WAIT_MS })

    await reportQueuedClientWorkflowTool({ toolCallId, executionId, workflowId })

    expect(await getToolConfirmation(toolCallId)).toMatchObject({
      status: 'background',
      data: { executionId },
    })
    expect(await waiting).toMatchObject({
      status: 'background',
      data: { workflowId, executionId },
    })
    expect(await toolRow(toolCallId)).toMatchObject({
      status: 'delivered',
      claimedBy: `workflow:${executionId}`,
    })
  })

  it('keeps a queued async run the browser already finalized', async () => {
    const { toolCallId, executionId } = await claimed({ workflowId, async: true })
    const reported = await completeAsyncToolCall({
      toolCallId,
      status: 'cancelled',
      result: { success: false, workflowId, executionId },
    })

    await reportQueuedClientWorkflowTool({ toolCallId, executionId, workflowId })

    expect(await toolRow(toolCallId)).toMatchObject({
      status: 'cancelled',
      completedAt: reported?.completedAt,
    })
    expect(await publishedConfirmation(toolCallId)).toBeNull()
  })

  it("settles a browser run that outlasts the worker's wait as running, bound to the call", async () => {
    const { toolCallId, executionId } = await claimed()
    // The execute route's log of the browser's run, still going: what the worker waits on.
    await executionLog(toolCallId, executionId, 'running')
    const runOnServer = vi.fn()

    const outcome = await raceWorkflowToolClientPickup({
      toolCallId,
      workflowId,
      timeoutMs: WAIT_MS,
      graceMs: WAIT_MS,
      waitTimeoutMs: 500,
      runOnServer,
    })

    // The worker gets the run's ids and waits on it in slices; the browser's run goes on.
    expect(outcome).toMatchObject({
      winner: 'client',
      completion: {
        status: 'background',
        data: { workflowId, executionId, status: 'running' },
      },
    })
    expect(runOnServer).not.toHaveBeenCalled()
    expect(await publishedConfirmation(toolCallId)).toMatchObject({
      status: 'background',
      executionId,
    })
    // Still bound to the call and unsettled, so a Stop's open-client-run read still cancels it.
    expect(await toolRow(toolCallId)).toMatchObject({
      status: 'delivered',
      claimedBy: `workflow:${executionId}`,
      clientWorkflowExecutionId: executionId,
      executionSettledAt: null,
    })
  })

  it("names the runs this run's calls started and left running, for a Stop to cancel", async () => {
    const insertCall = async (executableName: string, args: unknown, result: unknown) => {
      const toolCallId = generateId()
      await db.insert(copilotAsyncToolCalls).values({
        runId,
        toolCallId,
        toolName: executableName,
        executableName,
        args: args as Record<string, unknown>,
        result: result as Record<string, unknown>,
        status: 'completed',
      })
      return toolCallId
    }
    const record = (runIdValue: string, status: string) =>
      JSON.stringify({ runId: runIdValue, workflowId, status })
    const detachedCli = generateId()
    await executionLog(
      await insertCall(
        'sim_cli',
        { request: { invocation: { kind: 'cli', argv: ['workflows', 'run', workflowId] } } },
        { exitCode: 4, stdout: record(detachedCli, 'running'), stderr: '' }
      ),
      detachedCli,
      'running'
    )
    // A wait on a run proves nothing about who started it.
    await insertCall(
      'sim_cli',
      { request: { invocation: { kind: 'cli', argv: ['workflows', 'runs', 'wait', 'other'] } } },
      { exitCode: 4, stdout: record(generateId(), 'running'), stderr: '' }
    )
    const detachedTool = generateId()
    await executionLog(
      await insertCall(
        'run_workflow',
        { workflowId },
        { status: 'running', executionId: detachedTool, workflowId }
      ),
      detachedTool,
      'running'
    )
    // Answered running but not yet logged: it may still be starting, and a Stop must reach it.
    const startingTool = generateId()
    await insertCall(
      'run_from_block',
      { workflowId },
      { status: 'running', executionId: startingTool, workflowId }
    )
    await insertCall('run_block', { workflowId }, { success: true, executionId: generateId() })

    expect((await getDetachedWorkflowExecutions(streamId, userId)).sort()).toEqual(
      [detachedCli, detachedTool, startingTool].sort()
    )
  })

  it.each(['pending', 'completed', 'failed', 'cancelled'] as const)(
    'leaves a detached run whose log is %s for a Stop to skip',
    async (logStatus) => {
      const detachedCli = generateId()
      const detachedTool = generateId()
      const cliCall = generateId()
      const toolCall = generateId()
      await db.insert(copilotAsyncToolCalls).values([
        {
          runId,
          toolCallId: cliCall,
          toolName: 'sim_cli',
          executableName: 'sim_cli',
          args: {
            request: { invocation: { kind: 'cli', argv: ['workflows', 'run', workflowId] } },
          },
          result: {
            exitCode: 4,
            stdout: JSON.stringify({ runId: detachedCli, workflowId, status: 'running' }),
            stderr: '',
          },
          status: 'completed',
        },
        {
          runId,
          toolCallId: toolCall,
          toolName: 'run_workflow',
          executableName: 'run_workflow',
          args: { workflowId },
          result: { status: 'running', executionId: detachedTool, workflowId },
          status: 'completed',
        },
      ])
      // The run went on past its call and then settled, or paused at a human approval: a paused
      // run's resume subscribes under the same id, so a cancel flag would fail it.
      await executionLog(cliCall, detachedCli, logStatus)
      await executionLog(toolCall, detachedTool, logStatus)

      const cancellable = await getDetachedWorkflowExecutions(streamId, userId)
      expect(cancellable).not.toContain(detachedCli)
      expect(cancellable).not.toContain(detachedTool)
    }
  )

  /**
   * An earlier turn of a new chat whose `earlierTool` call is still executing under a live lease,
   * as a workflow tool answered still running is while its run goes on, and a later turn whose
   * own Sim call asks for the chat's workbench.
   */
  async function laterTurnWorkbenchAccess(earlierTool: string) {
    const turnChatId = generateId()
    await db.insert(copilotChats).values({
      id: turnChatId,
      userId,
      workspaceId,
      type: 'mothership',
      conversationId: generateId(),
    })
    try {
      const turn = async (startedAt: Date, toolName: string) => {
        const turnRunId = generateId()
        await db.insert(copilotRuns).values({
          id: turnRunId,
          executionId: generateId(),
          chatId: turnChatId,
          userId,
          workspaceId,
          streamId: generateId(),
          toolExecutionVersion: SIM_TOOL_EXECUTION_VERSION,
          status: 'active',
          startedAt,
          requestContext: { source: 'headless_lifecycle' },
        })
        const owner = {
          toolCallId: generateId(),
          runId: turnRunId,
          userId,
          ownerToken: generateId(),
        }
        await upsertAsyncToolCall({ runId: turnRunId, toolCallId: owner.toolCallId, toolName })
        expect(await claimToolExecution(owner)).toMatchObject({ outcome: 'claimed' })
        return owner
      }
      const earlier = await turn(new Date(Date.now() - 60_000), earlierTool)
      await completeAsyncToolCall({
        toolCallId: earlier.toolCallId,
        status: 'completed',
        result: { status: 'running', executionId: generateId(), workflowId },
      })
      // The earlier turn answered and ended; its call's execution still holds the run.
      await db
        .update(copilotRuns)
        .set({ status: 'complete', toolAdmissionClosedAt: new Date() })
        .where(eq(copilotRuns.id, earlier.runId))
      const later = await turn(new Date(), 'function_execute')
      return await prepareWorkbenchAccess({
        ...later,
        sessionKey: chatSandboxSessionKey(turnChatId),
      })
    } finally {
      await db.delete(copilotChats).where(eq(copilotChats.id, turnChatId))
    }
  }

  it("opens the workbench to a later turn while an earlier turn's workflow tool run goes on", async () => {
    expect(await laterTurnWorkbenchAccess('run_workflow')).toEqual({
      handlersPending: false,
      processes: [],
    })
  })

  it("keeps the workbench closed while an earlier turn's other tool is still executing", async () => {
    expect(await laterTurnWorkbenchAccess('function_execute')).toMatchObject({
      handlersPending: true,
    })
  })
})
