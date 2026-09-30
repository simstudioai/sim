/**
 * Pause publication against real PostgreSQL: a paused run becomes resumable only after
 * its log has been finalized out of `running`, so an immediate resume finds a claimable log.
 */
import { db } from '@sim/db'
import {
  pausedExecutions,
  resumeQueue,
  user,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { createDeferred } from '@sim/testing'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
  execution: generateId(),
}

const CONTEXT_ID = 'approval'

/** Long enough for an unguarded publish to commit; a guarded one never resolves while held. */
const UNGUARDED_PUBLISH_WINDOW_MS = 250

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

function pausedResult(billingAttribution: BillingAttributionSnapshot): ExecutionResult {
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
          executionId: ids.execution,
          userId: ids.owner,
          billingAttribution,
        },
      }),
      triggerIds: [],
    },
  }
}

async function logStatus() {
  const [row] = await db
    .select({ status: workflowExecutionLogs.status })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, ids.execution))
  return row?.status
}

function resume() {
  return PauseResumeManager.enqueueOrStartResume({
    executionId: ids.execution,
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
  await db.delete(resumeQueue).where(eq(resumeQueue.parentExecutionId, ids.execution))
  await db.delete(pausedExecutions).where(eq(pausedExecutions.workflowId, ids.workflow))
  await db.delete(workflowExecutionLogs).where(eq(workflowExecutionLogs.workflowId, ids.workflow))
  await db
    .delete(workflowExecutionSnapshots)
    .where(eq(workflowExecutionSnapshots.workflowId, ids.workflow))
  await db.delete(workspace).where(eq(workspace.id, ids.workspace))
  await db.delete(user).where(eq(user.id, ids.owner))
})

describe('handlePostExecutionPauseState', () => {
  it('publishes a pause only after the run log is finalized, so an immediate resume finds a claimable log', async () => {
    const billingAttribution = await resolveBillingAttribution({
      actorUserId: ids.owner,
      workspaceId: ids.workspace,
    })
    const loggingSession = new LoggingSession(ids.workflow, ids.execution, 'api', 'pause-publish')
    await loggingSession.safeStart({
      userId: ids.owner,
      workspaceId: ids.workspace,
      billingAttribution,
      workflowState,
    })
    expect(await logStatus()).toBe('running')

    /** Holds the core's background log finalizer open, as a slow trace projection would. */
    const finalizer = createDeferred<void>()
    loggingSession.setPostExecutionPromise(
      finalizer.promise.then(() => loggingSession.safeCompleteWithPause({ traceSpans: [] }))
    )

    const publish = handlePostExecutionPauseState({
      result: pausedResult(billingAttribution),
      workflowId: ids.workflow,
      executionId: ids.execution,
      loggingSession,
    })
    await Promise.race([publish, sleep(UNGUARDED_PUBLISH_WINDOW_MS)])

    expect(await logStatus()).toBe('running')
    await expect(resume()).rejects.toMatchObject({
      name: 'ResumeAdmissionError',
      statusCode: 404,
    })

    finalizer.resolve()
    await publish

    expect(await logStatus()).toBe('pending')
    await expect(resume()).resolves.toMatchObject({ status: 'starting' })
  })
})
