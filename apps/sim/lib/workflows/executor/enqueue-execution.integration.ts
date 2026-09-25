/** Real job JSON persistence and immutable deployment reads; billing admission and block execution are fixtures. */
import { db } from '@sim/db'
import { asyncJobs, user, workflow, workflowDeploymentVersion, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({ preprocess: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: async () => queue,
  /** Delay delivery so the deployment can change while the serialized job is pending. */
  shouldExecuteInline: () => false,
}))
vi.mock('@/lib/execution/preprocessing', () => ({ preprocessExecution: boundary.preprocess }))
vi.mock('@/lib/workflows/executor/execution-core', () => ({
  executeWorkflowCore: boundary.execute,
  wasExecutionFinalizedByCore: () => false,
}))
vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  refreshExecutionSlotExpiry: async () => true,
  releaseExecutionSlot: async () => {},
}))
vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: class {
    setTrustedExecutionCorrelation() {}
    setExecutionDeadlineAt() {}
    async waitForPostExecution() {}
    async safeCompleteWithError() {}
    projectDiagnosticError() {
      return {}
    }
  },
}))
vi.mock('@/lib/workflows/executor/pause-persistence', () => ({
  handlePostExecutionPauseState: async () => {},
}))
vi.mock('@/lib/uploads/utils/user-file-base64.server', () => ({
  cleanupExecutionBase64Cache: async () => {},
}))

import { DatabaseJobQueue } from '@/lib/core/async-jobs/backends/database'
import { enqueueWorkflowExecution } from '@/lib/workflows/executor/enqueue-execution'
import { executeWorkflowJob, type WorkflowExecutionPayload } from '@/background/workflow-execution'
import type { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const queue = new DatabaseJobQueue()
const userId = generateId()
const workspaceId = generateId()
const principal = { kind: 'personal_api_key' as const, userId, keyId: generateId() }
const jobIds: string[] = []
let workflowId: string
let versionId: string
let entryId: string
const billingAttribution = {
  actorUserId: userId,
  workspaceId,
  organizationId: null,
  billedAccountUserId: userId,
  billingEntity: { type: 'user' as const, id: userId },
  billingPeriod: { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
  payerSubscription: null,
}

function state(name: string, variables: WorkflowState['variables']): WorkflowState {
  return {
    blocks: {
      [entryId]: {
        id: entryId,
        type: 'start_trigger',
        name,
        enabled: true,
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
      },
    },
    edges: [],
    loops: {},
    parallels: {},
    variables,
  }
}

async function enqueue(deploymentVersionId: string | undefined = versionId) {
  const result = await enqueueWorkflowExecution({
    requestId: generateId(),
    workflowId,
    principal,
    userId,
    billingAttribution,
    workspaceId,
    input: { source: 'request' },
    triggerType: 'api',
    triggerBlockId: entryId,
    deploymentVersionId,
    executionId: generateId(),
    executionTimeoutMs: 30_000,
    enforceCredentialAccess: true,
  })
  if (result.outcome !== 'queued') throw new Error(`Fixture enqueue failed: ${result.outcome}`)
  jobIds.push(result.jobId)
  /** Re-read through a fresh queue instance: the worker receives database JSON, not the original object. */
  const persisted = await new DatabaseJobQueue().getJob(result.jobId)
  if (!persisted) throw new Error('Queued job was not persisted')
  return persisted.payload as WorkflowExecutionPayload
}

describe('queued workflow deployment pinning through PostgreSQL', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Queued execution fixture',
      email: `${userId}@workflow.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Queued execution fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
  })

  beforeEach(async () => {
    workflowId = generateId()
    versionId = generateId()
    entryId = generateId()
    await db.insert(workflow).values({
      id: workflowId,
      userId,
      workspaceId,
      name: `Queued workflow ${workflowId}`,
      lastSynced: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      isDeployed: true,
      variables: { source: { id: 'source', name: 'source', type: 'string', value: 'draft' } },
    })
    boundary.preprocess.mockImplementation(async () => {
      const [record] = await db.select().from(workflow).where(eq(workflow.id, workflowId))
      return { success: true, actorUserId: userId, workflowRecord: record, billingAttribution }
    })
    boundary.execute.mockResolvedValue({ success: true, status: 'success', output: {} })
  })

  afterAll(async () => {
    try {
      if (jobIds.length) await db.delete(asyncJobs).where(inArray(asyncJobs.id, jobIds))
      await db.delete(workspace).where(eq(workspace.id, workspaceId))
      await db.delete(user).where(eq(user.id, userId))
    } finally {
      await db.$client.end()
    }
  })

  it.each([true, false])(
    'retains admitted state and entry after cutover, variables=%s',
    async (hasVariables) => {
      const variables: NonNullable<WorkflowState['variables']> = hasVariables
        ? { source: { id: 'source', name: 'source', type: 'string', value: 'admitted' } }
        : {}
      await db.insert(workflowDeploymentVersion).values({
        id: versionId,
        workflowId,
        version: 1,
        isActive: true,
        createdBy: userId,
        state: state('Admitted entry', variables),
      })
      const payload = await enqueue()
      await db
        .update(workflowDeploymentVersion)
        .set({ isActive: false })
        .where(eq(workflowDeploymentVersion.id, versionId))
      await db.insert(workflowDeploymentVersion).values({
        id: generateId(),
        workflowId,
        version: 2,
        isActive: true,
        createdBy: userId,
        state: state('Replacement entry', {
          source: { id: 'source', name: 'source', type: 'string', value: 'new-active' },
        }),
      })

      await executeWorkflowJob(payload)

      const snapshot: ExecutionSnapshot = boundary.execute.mock.calls[0][0].snapshot
      expect(snapshot.metadata.triggerBlockId).toBe(entryId)
      expect(snapshot.metadata.workflowStateOverride).toMatchObject({
        deploymentVersionId: versionId,
        blocks: { [entryId]: { name: 'Admitted entry' } },
      })
      expect(snapshot.workflowVariables).toEqual(variables)
      expect(snapshot.metadata.principal).toEqual(principal)
      expect(payload).not.toHaveProperty('workflowStateOverride')
    }
  )

  it.each(['missing', 'other-workflow'] as const)(
    'refuses a %s pinned version before execution',
    async (kind) => {
      if (kind === 'other-workflow') {
        const foreignWorkflowId = generateId()
        await db.insert(workflow).values({
          id: foreignWorkflowId,
          userId,
          workspaceId,
          name: `Other workflow ${foreignWorkflowId}`,
          lastSynced: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          isDeployed: true,
        })
        await db.insert(workflowDeploymentVersion).values({
          id: versionId,
          workflowId: foreignWorkflowId,
          version: 1,
          isActive: true,
          createdBy: userId,
          state: state('Foreign entry', {}),
        })
      }
      const payload = await enqueue()
      await expect(executeWorkflowJob(payload)).rejects.toThrow('was not found for workflow')
      expect(boundary.execute).not.toHaveBeenCalled()
    }
  )
})
