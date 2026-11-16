/**
 * A deployed run paused at a human-in-the-loop block, executed in-process against real
 * PostgreSQL, while workflow source is applied to the draft. The apply renames the paused block;
 * the run then resumes from its execution snapshot. Source apply writes the draft only, so the
 * snapshot and the deployed version must come through it byte-identical, and the renamed block
 * must keep its id so the pause point still names a block the draft holds.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import {
  pausedExecutions,
  permissions,
  resumeQueue,
  user,
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createBlock } from '@sim/testing/factories/block.factory'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import { applyWorkflowSource } from '@/lib/workflows/application/apply-workflow-source'
import { executeWorkflowOperation } from '@/lib/workflows/application/execute-workflow'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'
import { resumeWorkflowRun } from '@/lib/workflows/application/resume-run'
import {
  loadWorkflowDeploymentSnapshot,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/persistence/utils'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

const ownerId = generateId()
const workspaceId = generateId()
const workflowId = generateId()
const startId = generateId()
const approvalId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const ownerKey = createPersonalApiKeyPrincipal({ userId: ownerId, keyId: generateId() })

const checks: { name: string; status: string; durationMs: number; error?: string }[] = []

function check(name: string, run: () => Promise<void>) {
  it(name, async () => {
    const started = performance.now()
    try {
      await run()
      checks.push({ name, status: 'passed', durationMs: performance.now() - started })
    } catch (error) {
      checks.push({
        name,
        status: 'failed',
        durationMs: performance.now() - started,
        error: getErrorMessage(error),
      })
      throw error
    }
  })
}

/** Runs the deployed workflow until it pauses and its pause is published. */
async function pausedRun(): Promise<string> {
  const result = await executeWorkflowOperation.execute({
    principal: owner,
    input: {
      workflowId,
      requestId: generateId(),
      input: {},
      mode: 'sync',
      requestHeaders: new Headers(),
    },
  })
  expect(result).toMatchObject({ ok: true, status: 'paused' })
  if (!result.ok || !('status' in result)) throw new Error('Expected a settled sync run')
  const { executionId } = result
  await vi.waitFor(
    async () => {
      const [row] = await db
        .select({ id: pausedExecutions.id })
        .from(pausedExecutions)
        .where(eq(pausedExecutions.executionId, executionId))
      if (!row) throw new Error('Pause not yet published')
    },
    { timeout: 20_000, interval: 250 }
  )
  return executionId
}

async function pausedRow(executionId: string) {
  const [row] = await db
    .select({
      executionSnapshot: pausedExecutions.executionSnapshot,
      pausePoints: pausedExecutions.pausePoints,
    })
    .from(pausedExecutions)
    .where(eq(pausedExecutions.executionId, executionId))
  return row
}

beforeAll(async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Source runtime fixture',
    email: `${ownerId}@source-runtime.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Source runtime fixture',
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
    name: 'Source runtime fixture',
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const saved = await saveWorkflowToNormalizedTables(workflowId, {
    blocks: {
      [startId]: createBlock({ id: startId, type: 'start_trigger', name: 'Start' }),
      [approvalId]: createBlock({
        id: approvalId,
        type: 'human_in_the_loop',
        name: 'Approval',
        position: { x: 300, y: 0 },
        subBlocks: {
          builderData: {
            id: 'builderData',
            type: 'response-format',
            value: [{ id: 'summary', name: 'summary', type: 'string', value: 'Approve it' }],
          },
          inputFormat: {
            id: 'inputFormat',
            type: 'input-format',
            value: [{ id: 'approved', name: 'approved', type: 'boolean', required: true }],
          },
        },
      }),
    },
    edges: [{ id: generateId(), source: startId, target: approvalId }],
    loops: {},
    parallels: {},
  })
  if (!saved.success) throw new Error(`Seeding the workflow failed: ${saved.error}`)
  const deployed = await loadWorkflowDeploymentSnapshot(workflowId)
  if (!deployed) throw new Error('The seeded draft has no deployment snapshot')
  await db.insert(workflowDeploymentVersion).values({
    id: generateId(),
    workflowId,
    version: 1,
    state: deployed,
    isActive: true,
  })
  await db
    .update(workflow)
    .set({ isDeployed: true, deployedAt: now })
    .where(eq(workflow.id, workflowId))
})

afterAll(async () => {
  const reportPath =
    process.env.WORKFLOW_SOURCE_RUNTIME_REPORT_PATH ??
    resolve('test-results/workflow-source-runtime.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  const paused = await db
    .select({ executionId: pausedExecutions.executionId })
    .from(pausedExecutions)
    .where(eq(pausedExecutions.workflowId, workflowId))
  for (const { executionId } of paused) {
    await db.delete(resumeQueue).where(eq(resumeQueue.parentExecutionId, executionId))
  }
  await db.delete(pausedExecutions).where(eq(pausedExecutions.workflowId, workflowId))
  await db.delete(workflowExecutionLogs).where(eq(workflowExecutionLogs.workflowId, workflowId))
  await db
    .delete(workflowExecutionSnapshots)
    .where(eq(workflowExecutionSnapshots.workflowId, workflowId))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, ownerId))
  await db.$client.end()
})

check(
  'a run paused at a human block resumes from its snapshot after source renames that block',
  async () => {
    const runId = await pausedRun()
    const before = await pausedRow(runId)
    const [contextId] = Object.keys(before.pausePoints as Record<string, unknown>)
    expect(contextId).toBeDefined()
    const [deployedBefore] = await db
      .select({ state: workflowDeploymentVersion.state })
      .from(workflowDeploymentVersion)
      .where(eq(workflowDeploymentVersion.workflowId, workflowId))
    const source = await withPermissionGroupScope(() =>
      readWorkflowSource.execute({ principal: owner, input: { workflowId } })
    )
    const text = source.files['workflow.ts']
    expect(text.split("'Approval'"), 'workflow.ts names the paused block once').toHaveLength(2)

    const applied = await withPermissionGroupScope(() =>
      applyWorkflowSource.execute({
        principal: owner,
        input: {
          workflowId,
          files: { ...source.files, 'workflow.ts': text.replace("'Approval'", "'Review'") },
          lock: source.lock,
          base: source.base,
        },
      })
    )

    expect(applied.applied).toBe(true)
    expect(applied.diff.blocks.renamed).toEqual([
      { id: approvalId, from: 'approval', to: 'review' },
    ])
    const draft = await loadWorkflowFromNormalizedTables(workflowId)
    expect(draft?.blocks[approvalId]?.name).toBe('Review')
    const after = await pausedRow(runId)
    expect(after.executionSnapshot).toEqual(before.executionSnapshot)
    const [deployedAfter] = await db
      .select({ state: workflowDeploymentVersion.state })
      .from(workflowDeploymentVersion)
      .where(eq(workflowDeploymentVersion.workflowId, workflowId))
    expect(deployedAfter.state).toEqual(deployedBefore.state)

    const resumed = await resumeWorkflowRun.execute({
      principal: ownerKey,
      input: {
        workflowId,
        runId,
        contextId,
        resumeInput: { approved: true },
        surface: 'v2',
      },
    })

    expect(resumed).toMatchObject({ kind: 'sync', success: true })
    expect(resumed).not.toMatchObject({ status: 'failed' })
  }
)
