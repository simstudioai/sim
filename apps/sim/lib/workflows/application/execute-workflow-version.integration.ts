/**
 * Deployed runs against real PostgreSQL through the execute use cases: a pinned run executes
 * the version it named rather than the active one, on the sync and the async path, and an
 * unpinned async run reads the deployed variables a sync run reads, not the editor's draft.
 */
import { db } from '@sim/db'
import {
  asyncJobs,
  permissions,
  user,
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  executeWorkflowOperation,
  executeWorkflowVersionOperation,
} from '@/lib/workflows/application/execute-workflow'
import { getWorkflowExecutionStatus } from '@/lib/workflows/executor/execution-status'

const ownerId = generateId()
const workspaceId = generateId()
const workflowId = generateId()
const principal = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const versionIds = { one: generateId(), two: generateId() }
const jobIds: string[] = []

/** One variable whose value differs between the deployed versions and the editor's draft. */
function variables(greeting: string) {
  return {
    greeting: { id: 'greeting', workflowId, name: 'greeting', type: 'plain', value: greeting },
  }
}

/** Start into a Response that echoes the version label and the `greeting` variable. */
function deployedState(label: string, greeting: string) {
  return {
    blocks: {
      start: {
        id: 'start',
        type: 'start_trigger',
        name: 'Start',
        enabled: true,
        position: { x: 0, y: 0 },
        outputs: {},
        subBlocks: {},
      },
      respond: {
        id: 'respond',
        type: 'response',
        name: 'Respond',
        enabled: true,
        position: { x: 300, y: 0 },
        outputs: {},
        subBlocks: {
          dataMode: { id: 'dataMode', type: 'dropdown', value: 'json' },
          data: {
            id: 'data',
            type: 'code',
            value: `{"version": "${label}", "greeting": "<variable.greeting>"}`,
          },
          status: { id: 'status', type: 'short-input', value: '200' },
        },
      },
    },
    edges: [{ id: 'start-respond', source: 'start', target: 'respond' }],
    loops: {},
    parallels: {},
    variables: variables(greeting),
  }
}

const runInput = (mode: 'sync' | 'async') => ({
  workflowId,
  requestId: generateId(),
  input: {},
  mode,
  requestHeaders: new Headers(),
})

async function logDeploymentVersionId(executionId: string) {
  const [row] = await db
    .select({ deploymentVersionId: workflowExecutionLogs.deploymentVersionId })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, executionId))
  return row?.deploymentVersionId
}

/** Waits for a queued run, executed in-process by the database job backend, to settle. */
async function settledRun(executionId: string) {
  return vi.waitFor(
    async () => {
      const status = await getWorkflowExecutionStatus({
        workflowId,
        executionId,
        includeOutput: true,
        selectedOutputs: [],
        workspaceId,
        viewerUserId: ownerId,
      })
      if (status?.status !== 'completed' && status?.status !== 'failed') {
        throw new Error(`Run ${executionId} has not settled: ${status?.status}`)
      }
      return status
    },
    { timeout: 20_000, interval: 250 }
  )
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Pinned execute fixture',
    email: `${ownerId}@pinned-execute.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Pinned execute fixture',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId: ownerId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: 'Pinned execute fixture',
    isDeployed: true,
    deployedAt: now,
    variables: variables('draft'),
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(workflowDeploymentVersion).values([
    {
      id: versionIds.one,
      workflowId,
      version: 1,
      state: deployedState('one', 'deployed-one'),
      isActive: false,
    },
    {
      id: versionIds.two,
      workflowId,
      version: 2,
      state: deployedState('two', 'deployed-two'),
      isActive: true,
    },
  ])
})

afterAll(async () => {
  await db.delete(workflowExecutionLogs).where(eq(workflowExecutionLogs.workflowId, workflowId))
  await db
    .delete(workflowExecutionSnapshots)
    .where(eq(workflowExecutionSnapshots.workflowId, workflowId))
  if (jobIds.length > 0) await db.delete(asyncJobs).where(inArray(asyncJobs.id, jobIds))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, ownerId))
  await db.$client.end()
})

describe('executing a deployed workflow against real Postgres', () => {
  it('runs the pinned version, not the active one, and records it on the log', async () => {
    const result = await executeWorkflowVersionOperation.execute({
      principal,
      input: { ...runInput('sync'), version: 1 },
    })

    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      output: { data: { version: 'one', greeting: 'deployed-one' } },
    })
    if (!result.ok || !('status' in result)) throw new Error('Expected a settled sync run')
    expect(await logDeploymentVersionId(result.executionId)).toBe(versionIds.one)
  })

  it('answers not_found for a version the workflow never deployed, before any run starts', async () => {
    await expect(
      executeWorkflowVersionOperation.execute({
        principal,
        input: { ...runInput('sync'), version: 99 },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('carries the pin through the async queue and runs that version in the worker', async () => {
    const result = await executeWorkflowVersionOperation.execute({
      principal,
      input: { ...runInput('async'), version: 1 },
    })
    if (!result.ok || !('queued' in result)) throw new Error('Expected a queued run')
    jobIds.push(result.jobId)

    const [job] = await db.select().from(asyncJobs).where(eq(asyncJobs.id, result.jobId))
    expect(job.payload).toMatchObject({ pinnedDeploymentVersionId: versionIds.one })

    const run = await settledRun(result.executionId)
    expect(run).toMatchObject({
      status: 'completed',
      deploymentVersion: 1,
      finalOutput: { data: { version: 'one', greeting: 'deployed-one' } },
    })
  })

  it('runs an unpinned async run with the active deployment variables, as a sync run does', async () => {
    const sync = await executeWorkflowOperation.execute({ principal, input: runInput('sync') })
    expect(sync).toMatchObject({
      status: 'completed',
      output: { data: { version: 'two', greeting: 'deployed-two' } },
    })

    const queued = await executeWorkflowOperation.execute({ principal, input: runInput('async') })
    if (!queued.ok || !('queued' in queued)) throw new Error('Expected a queued run')
    jobIds.push(queued.jobId)

    const run = await settledRun(queued.executionId)
    expect(run).toMatchObject({
      status: 'completed',
      deploymentVersion: 2,
      finalOutput: { data: { version: 'two', greeting: 'deployed-two' } },
    })
  })
})
