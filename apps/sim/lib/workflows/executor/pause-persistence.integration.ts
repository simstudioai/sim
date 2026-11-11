/**
 * Pause publication against real PostgreSQL: a paused run becomes resumable only once its
 * log has been finalized out of `running`, so an immediate resume finds a claimable log; and
 * the pause points a run detail reads back from what was published.
 */
import { db } from '@sim/db'
import {
  pausedExecutions,
  user,
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createDeferred } from '@sim/testing'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  type BillingAttributionSnapshot,
  resolveBillingAttribution,
} from '@/lib/billing/core/attribution'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import type { WorkflowState } from '@/lib/logs/types'
import {
  getWorkflowExecutionStatus,
  readPausedRunPoints,
} from '@/lib/workflows/executor/execution-status'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { handlePostExecutionPauseState } from '@/lib/workflows/executor/pause-persistence'
import { capturePauseDisplay } from '@/executor/human-in-the-loop/utils'
import type { ExecutionResult, PausePoint } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { buildBranchNodeId } from '@/executor/utils/subflow-node-id-codec'

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

/** A marker only the execution snapshot carries, so a read that leaks the snapshot shows it. */
const SNAPSHOT_SENTINEL = `snapshot-only-${generateId()}`

function pausedResult(
  executionId: string,
  billingAttribution: BillingAttributionSnapshot,
  pausePoints: PausePoint[] = [
    {
      contextId: CONTEXT_ID,
      blockId: CONTEXT_ID,
      response: {},
      registeredAt: new Date().toISOString(),
      resumeStatus: 'paused',
      snapshotReady: true,
      pauseKind: 'human',
    },
  ]
): ExecutionResult {
  return {
    success: true,
    output: {},
    status: 'paused',
    pausePoints,
    snapshotSeed: {
      snapshot: JSON.stringify({
        metadata: {
          workflowId: ids.workflow,
          workspaceId: ids.workspace,
          executionId,
          userId: ids.owner,
          billingAttribution,
        },
        state: { sentinel: SNAPSHOT_SENTINEL },
      }),
      triggerIds: [],
    },
  }
}

/** Starts a run whose log is `running`, as the core leaves it when execution returns. */
async function startRun(pausePoints?: PausePoint[]) {
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
  return {
    executionId,
    loggingSession,
    result: pausedResult(executionId, billingAttribution, pausePoints),
  }
}

async function logStatus(executionId: string) {
  const [row] = await db
    .select({ status: workflowExecutionLogs.status })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, executionId))
  return row?.status
}

function resume(executionId: string, contextId = CONTEXT_ID) {
  return PauseResumeManager.enqueueOrStartResume({
    executionId,
    workflowId: ids.workflow,
    contextId,
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
  await insertWorkspaceFixture(db, {
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
    .delete(workflowDeploymentVersion)
    .where(eq(workflowDeploymentVersion.workflowId, ids.workflow))
  await db
    .delete(workflowExecutionSnapshots)
    .where(eq(workflowExecutionSnapshots.workflowId, ids.workflow))
  await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspace))
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

const SECRET = `resolved-secret-${generateId()}`
const PARALLEL_ID = 'review-parallel'
const BRANCH_IDS = [0, 1].map((index) => buildBranchNodeId(CONTEXT_ID, index))

/** A run registry that has resolved {@link SECRET} as `{{API_KEY}}`, as a block input would. */
function registryWithResolvedSecret() {
  const registry = new ResolvedSecretTraceRegistry([
    { name: 'API_KEY', plaintext: SECRET, encryptedValue: 'ciphertext' },
  ])
  registry.recordResolved('API_KEY', SECRET)
  return registry
}

/** The pause a human-in-the-loop block in a parallel branch records, with a secret in its content. */
function humanBranchPoint(
  branchIndex: number,
  registry: ResolvedSecretTraceRegistry | undefined
): PausePoint {
  const contextId = BRANCH_IDS[branchIndex]
  const response = {
    data: {
      operation: 'human',
      responseStructure: [{ name: 'summary', type: 'string', value: `Token is ${SECRET}` }],
      inputFormat: [{ id: 'f1', name: 'approved', type: 'boolean', required: true, value: SECRET }],
      submission: null,
      _resume: { apiUrl: 'https://resume.invalid/api', uiUrl: 'https://resume.invalid/ui' },
    },
    status: 200,
    headers: { 'X-Pause-Header': SECRET },
  }
  return {
    ...capturePauseDisplay({ pauseKind: 'human', response }, registry),
    contextId,
    blockId: contextId,
    response,
    registeredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, branchIndex)).toISOString(),
    resumeStatus: 'paused',
    snapshotReady: true,
    parallelScope: { parallelId: PARALLEL_ID, branchIndex, branchTotal: 2 },
    pauseKind: 'human',
  }
}

/** Publishes a paused run the way the core does once its log is finalized. */
async function publishPausedRun(points: PausePoint[]) {
  const { executionId, loggingSession, result } = await startRun(points)
  loggingSession.setPostExecutionPromise(loggingSession.safeCompleteWithPause({ traceSpans: [] }))
  await handlePostExecutionPauseState({
    result,
    workflowId: ids.workflow,
    executionId,
    loggingSession,
  })
  return executionId
}

async function storedPausePoints(executionId: string): Promise<Record<string, PausePoint>> {
  const [row] = await db
    .select({ pausePoints: pausedExecutions.pausePoints })
    .from(pausedExecutions)
    .where(eq(pausedExecutions.executionId, executionId))
  return row.pausePoints as Record<string, PausePoint>
}

describe('readPausedRunPoints', () => {
  it('lists every parallel branch with its scope, queue position, and deployed block name', async () => {
    const registry = registryWithResolvedSecret()
    const executionId = await publishPausedRun([
      humanBranchPoint(0, registry),
      humanBranchPoint(1, registry),
    ])
    const versionId = generateId()
    await db.insert(workflowDeploymentVersion).values({
      id: versionId,
      workflowId: ids.workflow,
      version: 1,
      state: { blocks: { [CONTEXT_ID]: { id: CONTEXT_ID, name: 'Approval' } } },
      isActive: false,
    })
    await db
      .update(workflowExecutionLogs)
      .set({ deploymentVersionId: versionId })
      .where(eq(workflowExecutionLogs.executionId, executionId))

    await expect(resume(executionId, BRANCH_IDS[0])).resolves.toMatchObject({
      status: 'starting',
    })
    await expect(resume(executionId, BRANCH_IDS[1])).resolves.toMatchObject({
      status: 'queued',
      queuePosition: 1,
    })

    const points = await readPausedRunPoints({ workflowId: ids.workflow, executionId })

    expect(points?.map(({ display, inputFields, ...point }) => point)).toEqual(
      [0, 1].map((branchIndex) => ({
        contextId: BRANCH_IDS[branchIndex],
        blockId: CONTEXT_ID,
        blockName: 'Approval',
        kind: 'human',
        status: branchIndex === 0 ? 'resuming' : 'queued',
        registeredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, branchIndex)).toISOString(),
        resumeAt: null,
        parallel: { parallelId: PARALLEL_ID, branchIndex, branchTotal: 2 },
        loop: null,
        queuePosition: branchIndex === 0 ? null : 1,
      }))
    )
  })

  it('stores and returns pause content with resolved secrets redacted and control data withheld', async () => {
    const executionId = await publishPausedRun([humanBranchPoint(0, registryWithResolvedSecret())])

    const stored = await storedPausePoints(executionId)
    expect(stored[BRANCH_IDS[0]]).toMatchObject({ displayScrubbed: true })
    expect(JSON.stringify(stored[BRANCH_IDS[0]].display)).not.toContain(SECRET)

    const [point] = (await readPausedRunPoints({ workflowId: ids.workflow, executionId })) ?? []
    expect(point.display).toEqual({
      responseStructure: [{ name: 'summary', type: 'string', value: 'Token is {{API_KEY}}' }],
    })
    expect(point.inputFields).toEqual([
      { name: 'approved', label: 'approved', type: 'boolean', required: true },
    ])
    const body = JSON.stringify(point)
    for (const withheld of [SECRET, SNAPSHOT_SENTINEL, 'resume.invalid', 'X-Pause-Header']) {
      expect(body).not.toContain(withheld)
    }
  })

  it('withholds content it cannot prove free of secrets', async () => {
    const executionId = await publishPausedRun([humanBranchPoint(0, undefined)])

    const [point] = (await readPausedRunPoints({ workflowId: ids.workflow, executionId })) ?? []
    expect(point).toMatchObject({ display: null, inputFields: null, blockName: null })
  })

  it('exposes no content from a point persisted before pause content was scrubbed', async () => {
    const { displayScrubbed, display, inputFields, ...legacy } = humanBranchPoint(0, undefined)
    legacy.response.data.responseStructure[0].value = SECRET
    const executionId = await publishPausedRun([legacy])

    expect((await storedPausePoints(executionId))[BRANCH_IDS[0]]).not.toHaveProperty(
      'displayScrubbed'
    )
    const [point] = (await readPausedRunPoints({ workflowId: ids.workflow, executionId })) ?? []
    expect(point).toMatchObject({ display: null, inputFields: null })
    expect(JSON.stringify(point)).not.toContain(SECRET)
  })

  it('keeps the input fields when the reviewer content is too large to capture', async () => {
    const point = humanBranchPoint(0, registryWithResolvedSecret())
    point.response.data.responseStructure[0].value = 'x'.repeat(70 * 1024)
    const executionId = await publishPausedRun([
      { ...point, ...capturePauseDisplay(point, registryWithResolvedSecret()) },
    ])

    const [read] = (await readPausedRunPoints({ workflowId: ids.workflow, executionId })) ?? []
    expect(read).toMatchObject({
      display: null,
      inputFields: [{ name: 'approved', label: 'approved', type: 'boolean', required: true }],
    })
  })

  it('lists a point recorded without a registration time instead of failing the run', async () => {
    const { registeredAt, ...unregistered } = humanBranchPoint(0, registryWithResolvedSecret())
    const executionId = await publishPausedRun([unregistered as PausePoint])

    const [read] = (await readPausedRunPoints({ workflowId: ids.workflow, executionId })) ?? []
    expect(read).toMatchObject({ contextId: BRANCH_IDS[0], registeredAt: null })
  })

  it('reports the parent run version for a resume still starting or queued', async () => {
    const registry = registryWithResolvedSecret()
    const executionId = await publishPausedRun([
      humanBranchPoint(0, registry),
      humanBranchPoint(1, registry),
    ])
    const versionId = generateId()
    await db.insert(workflowDeploymentVersion).values({
      id: versionId,
      workflowId: ids.workflow,
      version: 2,
      state: { blocks: {} },
      isActive: false,
    })
    await db
      .update(workflowExecutionLogs)
      .set({ deploymentVersionId: versionId })
      .where(eq(workflowExecutionLogs.executionId, executionId))

    const starting = await resume(executionId, BRANCH_IDS[0])
    const queued = await resume(executionId, BRANCH_IDS[1])
    expect([starting.status, queued.status]).toEqual(['starting', 'queued'])

    for (const attempt of [starting, queued]) {
      const status = await getWorkflowExecutionStatus({
        workflowId: ids.workflow,
        executionId: attempt.resumeExecutionId,
        includeOutput: false,
        selectedOutputs: [],
        workspaceId: ids.workspace,
        viewerUserId: ids.owner,
      })
      expect(status).toMatchObject({ status: 'queued', deploymentVersion: 2 })
    }
  })

  it('returns the selected point display and input fields once, not again in every listed point', async () => {
    const registry = registryWithResolvedSecret()
    const executionId = await publishPausedRun([
      humanBranchPoint(0, registry),
      humanBranchPoint(1, registry),
    ])

    const detail = await PauseResumeManager.getPauseContextDetail({
      workflowId: ids.workflow,
      executionId,
      contextId: BRANCH_IDS[0],
    })

    expect(detail?.pausePoint.display).toEqual({
      responseStructure: [{ name: 'summary', type: 'string', value: 'Token is {{API_KEY}}' }],
    })
    expect(detail?.pausePoint.inputFields).toHaveLength(1)
    expect(detail?.execution.pausePoints).toHaveLength(2)
    for (const point of detail?.execution.pausePoints ?? []) {
      expect(point).not.toHaveProperty('display')
      expect(point).not.toHaveProperty('inputFields')
    }
  })

  it('reports a time pause with its resume time and no input fields', async () => {
    const resumeAt = new Date(Date.now() + 60_000).toISOString()
    const executionId = await publishPausedRun([
      {
        ...capturePauseDisplay({ pauseKind: 'time', response: {} }, registryWithResolvedSecret()),
        contextId: 'wait',
        blockId: 'wait',
        response: {},
        registeredAt: new Date().toISOString(),
        resumeStatus: 'paused',
        snapshotReady: true,
        pauseKind: 'time',
        resumeAt,
      },
    ])

    const [point] = (await readPausedRunPoints({ workflowId: ids.workflow, executionId })) ?? []
    expect(point).toMatchObject({
      kind: 'time',
      resumeAt,
      inputFields: null,
      display: null,
      parallel: null,
      loop: null,
    })
  })
})
