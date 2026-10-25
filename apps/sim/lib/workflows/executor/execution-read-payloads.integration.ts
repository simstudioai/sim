/**
 * The run status poll, the paused-execution list, and the execution snapshot
 * view against real PostgreSQL, recording every value the client receives over
 * the wire: a poll fetches a run's execution data only when it reads it, the
 * paused list never fetches the serialized execution snapshot it does not
 * return, and the snapshot view fetches no execution data for a refused caller.
 */
import {
  pausedExecutions,
  user,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createExecutorPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  received: [] as unknown[],
  closeClients: [] as Array<() => Promise<void>>,
}))

vi.mock('@sim/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sim/db')>()
  const { default: postgres } = await import('postgres')
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const schema = await import('@sim/db/schema')
  const { withUtcTimestamps } = await import('@sim/db/timestamps')
  const { readTestDatabaseUrl } = await import('@sim/db/testing/test-infrastructure')
  const client = postgres(
    readTestDatabaseUrl(),
    withUtcTimestamps({
      max: 4,
      prepare: false,
      fetch_types: false,
      connection: {},
      onnotice: () => {},
      transform: {
        value: {
          from: (value: unknown) => {
            harness.received.push(value)
            return value
          },
        },
      },
    })
  )
  harness.closeClients.push(() => client.end())
  const recorded = drizzle(client, { schema })
  return { ...actual, db: recorded, dbReplica: recorded, dbFor: () => recorded }
})

import { db } from '@sim/db'
import { LOGS_DELEGATION_AUDIENCE } from '@/lib/logs/application/authorization'
import { readExecutionSnapshotUseCase } from '@/lib/logs/application/read-execution-snapshot'
import { getWorkflowExecutionStatus } from '@/lib/workflows/executor/execution-status'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'

const ids = {
  owner: `execution-read-payloads-${generateId()}`,
  workspace: generateId(),
  workflow: generateId(),
  snapshot: generateId(),
}

/** Whether `marker` reached the client in any value since the last reset. */
function fetched(marker: string): boolean {
  return JSON.stringify(harness.received).includes(marker)
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ids.owner,
    name: 'Execution Read Payloads',
    email: `${ids.owner}@execution-read-payloads.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: ids.workspace,
    name: 'Execution Read Payloads',
    ownerId: ids.owner,
    billedAccountUserId: ids.owner,
  })
  await db.insert(workflow).values({
    id: ids.workflow,
    userId: ids.owner,
    workspaceId: ids.workspace,
    name: 'Execution Read Payloads',
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(workflowExecutionSnapshots).values({
    id: ids.snapshot,
    workflowId: ids.workflow,
    stateHash: ids.snapshot,
    stateData: {},
  })
}, 30_000)

afterAll(async () => {
  await db.delete(pausedExecutions).where(eq(pausedExecutions.workflowId, ids.workflow))
  await db.delete(workflowExecutionLogs).where(eq(workflowExecutionLogs.workflowId, ids.workflow))
  await db.delete(workflowExecutionSnapshots).where(eq(workflowExecutionSnapshots.id, ids.snapshot))
  await db.delete(workflow).where(eq(workflow.id, ids.workflow))
  await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspace))
  await db.delete(user).where(eq(user.id, ids.owner))
  await Promise.all(harness.closeClients.map((close) => close()))
})

describe('run status poll', () => {
  it.each([
    { status: 'running', includeOutput: true, readsExecutionData: false },
    { status: 'completed', includeOutput: false, readsExecutionData: false },
    { status: 'completed', includeOutput: true, readsExecutionData: true },
    { status: 'failed', includeOutput: false, readsExecutionData: true },
  ])(
    'fetches execution data for a $status run polled with includeOutput=$includeOutput only when it reads it',
    async ({ status, includeOutput, readsExecutionData }) => {
      const executionId = generateId()
      const marker = `execution-data-${executionId}`
      await db.insert(workflowExecutionLogs).values({
        id: generateId(),
        workflowId: ids.workflow,
        workspaceId: ids.workspace,
        executionId,
        stateSnapshotId: ids.snapshot,
        level: status === 'failed' ? 'error' : 'info',
        status,
        trigger: 'api',
        startedAt: new Date(),
        executionData: { error: marker, finalOutput: { marker } },
      })
      harness.received.length = 0

      const result = await getWorkflowExecutionStatus({
        workflowId: ids.workflow,
        executionId,
        includeOutput,
        selectedOutputs: [],
        workspaceId: ids.workspace,
        viewerUserId: null,
      })

      expect(result?.status).toBe(status)
      expect(fetched(marker)).toBe(readsExecutionData)
    }
  )
})

describe('paused execution list', () => {
  it('returns trigger ids without fetching the serialized execution snapshot', async () => {
    const executionId = generateId()
    const marker = `serialized-snapshot-${executionId}`
    await db.insert(pausedExecutions).values({
      id: generateId(),
      workflowId: ids.workflow,
      executionId,
      executionSnapshot: { snapshot: marker, triggerIds: ['trigger-1'] },
      pausePoints: {
        approval: {
          contextId: 'approval',
          pauseKind: 'human',
          resumeStatus: 'paused',
          response: {},
          registeredAt: new Date().toISOString(),
          snapshotReady: true,
        },
      },
      totalPauseCount: 1,
    })
    harness.received.length = 0

    const listed = await PauseResumeManager.listPausedExecutions({ workflowId: ids.workflow })

    expect(listed.map((paused) => [paused.executionId, paused.triggerIds])).toEqual([
      [executionId, ['trigger-1']],
    ])
    expect(fetched(marker)).toBe(false)
  })
})

describe('execution snapshot view', () => {
  it('fetches no execution data for a caller it then refuses', async () => {
    const executionId = generateId()
    const marker = `execution-data-${executionId}`
    await db.insert(workflowExecutionLogs).values({
      id: generateId(),
      workflowId: ids.workflow,
      workspaceId: ids.workspace,
      executionId,
      stateSnapshotId: ids.snapshot,
      level: 'info',
      status: 'completed',
      trigger: 'api',
      startedAt: new Date(),
      executionData: { finalOutput: { marker } },
    })
    harness.received.length = 0
    const otherWorkspaceExecutor = createExecutorPrincipal({
      subjectUserId: undefined,
      workspaceId: generateId(),
      audience: LOGS_DELEGATION_AUDIENCE,
      delegationContext: {
        kind: 'workflow_execution',
        workflowId: ids.workflow,
        currentWorkflow: {
          workflowId: ids.workflow,
          mode: 'deployment',
          deploymentVersionId: 'deployment-1',
        },
      },
    })

    await expect(
      readExecutionSnapshotUseCase.execute({
        principal: otherWorkspaceExecutor,
        input: { executionId },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(fetched(marker)).toBe(false)
  })
})
