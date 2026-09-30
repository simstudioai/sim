/**
 * Pause publication against real PostgreSQL: a paused run becomes resumable only once its
 * log has been finalized out of `running`, so an immediate resume finds a claimable log.
 */
import { db } from '@sim/db'
import {
  pausedExecutions,
  user,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { createDeferred } from '@sim/testing'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  type BillingAttributionSnapshot,
  resolveBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import type { WorkflowState } from '@/lib/logs/types'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { handlePostExecutionPauseState } from '@/lib/workflows/executor/pause-persistence'
import type { ExecutionResult } from '@/executor/types'

const ids = {
  owner: `pause-publish-owner-${generateId()}`,
  workspace: generateId(),
  workflow: generateId(),
}

const CONTEXT_ID = 'approval'

const workflowState: WorkflowState = {
  blocks: {
    start: {
      id: 'start',
      type: 'starter',
      name: 'Start',
      position: { x: 0, y: 0 },
      subBlocks: {},
      outputs: {},
      enabled: true,
    },
  },
  edges: [],
  loops: {},
  parallels: {},
}

function pausedResult(
  executionId: string,
  billingAttribution: BillingAttributionSnapshot
): ExecutionResult {
  return {
    success: true,
    output: {},
    status: 'paused',
    pausePoints: [
      {
        contextId: CONTEXT_ID,
        blockId: CONTEXT_ID,
        response: {},
        registeredAt: new Date().toISOString(),
        resumeStatus: 'paused',
        snapshotReady: true,
        pauseKind: 'human',
      },
    ],
    snapshotSeed: {
      snapshot: JSON.stringify({
        metadata: {
          workflowId: ids.workflow,
          workspaceId: ids.workspace,
          executionId,
          userId: ids.owner,
          billingAttribution,
        },
      }),
      triggerIds: [],
    },
  }
}

/** Starts a run whose log is `running`, as the core leaves it when execution returns. */
async function startRun() {
  const executionId = generateId()
  const billingAttribution = await resolveBillingAttribution({
    actorUserId: ids.owner,
    workspaceId: ids.workspace,
  })
  const loggingSession = new LoggingSession(ids.workflow, executionId, 'api', 'pause-publish')
  await loggingSession.safeStart({
    userId: ids.owner,
    workspaceId: ids.workspace,
    billingAttribution,
    workflowState,
  })
  return { executionId, loggingSession, result: pausedResult(executionId, billingAttribution) }
}

async function logStatus(executionId: string) {
  const [row] = await db
    .select({ status: workflowExecutionLogs.status })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, executionId))
  return row?.status
}

function resume(executionId: string) {
  return PauseResumeManager.enqueueOrStartResume({
    executionId,
    workflowId: ids.workflow,
    contextId: CONTEXT_ID,
    resumeInput: {},
    userId: ids.owner,
  })
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ids.owner,
    name: 'Pause Publish',
    email: `${ids.owner}@pause-publish.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(workspace).values({
    id: ids.workspace,
    name: 'Pause Publish',
    ownerId: ids.owner,
    billedAccountUserId: ids.owner,
  })
  await db.insert(workflow).values({
    id: ids.workflow,
    userId: ids.owner,
    workspaceId: ids.workspace,
    name: 'Pause Publish',
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
})

afterAll(async () => {
  // Deleting a paused execution cascades to its resume queue entries.
  await db.delete(pausedExecutions).where(eq(pausedExecutions.workflowId, ids.workflow))
  await db.delete(workflowExecutionLogs).where(eq(workflowExecutionLogs.workflowId, ids.workflow))
  await db
    .delete(workflowExecutionSnapshots)
    .where(eq(workflowExecutionSnapshots.workflowId, ids.workflow))
  await db.delete(workspace).where(eq(workspace.id, ids.workspace))
  await db.delete(user).where(eq(user.id, ids.owner))
})

describe('handlePostExecutionPauseState', () => {
  it('publishes a pause only after its log is finalized, so an immediate resume finds a claimable log', async () => {
    const { executionId, loggingSession, result } = await startRun()

    /** Holds the core's background log finalizer open, as a slow trace projection would. */
    const finalizer = createDeferred<void>()
    loggingSession.setPostExecutionPromise(
      finalizer.promise.then(() => loggingSession.safeCompleteWithPause({ traceSpans: [] }))
    )

    const persistPauseResult = PauseResumeManager.persistPauseResult
    const logFinalizedAtPublish: boolean[] = []
    const publishSpy = vi
      .spyOn(PauseResumeManager, 'persistPauseResult')
      .mockImplementation((args) => {
        logFinalizedAtPublish.push(loggingSession.hasCompleted())
        return persistPauseResult.call(PauseResumeManager, args)
      })

    try {
      const publish = handlePostExecutionPauseState({
        result,
        workflowId: ids.workflow,
        executionId,
        loggingSession,
      })
      finalizer.resolve()
      await publish
    } finally {
      publishSpy.mockRestore()
    }

    expect(logFinalizedAtPublish).toEqual([true])
    expect(await logStatus(executionId)).toBe('pending')
    await expect(resume(executionId)).resolves.toMatchObject({ status: 'starting' })
  })

  it('fails the run instead of publishing a pause whose log was never finalized', async () => {
    const { executionId, loggingSession, result } = await startRun()

    /** The core's finalizer swallows its own failures, so a lost pause write still settles. */
    loggingSession.setPostExecutionPromise(Promise.resolve())

    await handlePostExecutionPauseState({
      result,
      workflowId: ids.workflow,
      executionId,
      loggingSession,
    })

    expect(await logStatus(executionId)).toBe('failed')
    await expect(resume(executionId)).rejects.toMatchObject({
      name: 'ResumeAdmissionError',
      statusCode: 404,
    })
  })
})
