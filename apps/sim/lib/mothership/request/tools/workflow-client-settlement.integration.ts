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
  claimWorkflowToolExecution,
  completeAsyncToolCall,
  detachAsyncToolCall,
  settleClientWorkflowToolExecution,
} from '@/lib/mothership/async-runs/repository'
import { getToolConfirmation } from '@/lib/mothership/persistence/tool-confirm'
import { waitForWorkflowToolCompletion } from '@/lib/mothership/request/tools/client'
import {
  reportQueuedClientWorkflowTool,
  reportSettledClientWorkflowTool,
} from '@/lib/mothership/request/tools/workflow-client-settlement'

/** Longer than the waiter's durable poll, far shorter than the hour it used to park for. */
const WAIT_MS = 10_000

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
    await db.insert(workspace).values({
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
      streamId: generateId(),
      toolExecutionVersion: SIM_TOOL_EXECUTION_VERSION,
      status: 'paused_waiting_for_tool',
      requestContext: { source: 'headless_lifecycle' },
    })
  })

  afterAll(async () => {
    await db.delete(copilotChats).where(eq(copilotChats.id, chatId))
    await db.delete(workflowExecutionLogs).where(eq(workflowExecutionLogs.workspaceId, workspaceId))
    if (snapshotIds.length)
      await db
        .delete(workflowExecutionSnapshots)
        .where(inArray(workflowExecutionSnapshots.id, snapshotIds))
    await db.delete(workflow).where(eq(workflow.id, workflowId))
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
  })

  /** The execute route's durable log of one bound execution, as the Chat waiter reads it. */
  async function executionLog(
    toolCallId: string,
    executionId: string,
    status: 'completed' | 'failed' | 'cancelled' | 'pending'
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

  it('leaves a paused execution to the client', async () => {
    const { toolCallId, executionId } = await claimed()
    await executionLog(toolCallId, executionId, 'pending')

    await reportSettledClientWorkflowTool({ toolCallId, executionId, workflowId })

    expect(await toolRow(toolCallId)).toMatchObject({ status: 'running', result: null })
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
})
