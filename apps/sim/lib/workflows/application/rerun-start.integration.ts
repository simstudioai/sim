/**
 * Where a rerun of a failed run starts, against real PostgreSQL: a draft run that fails in a
 * block inside a loop names the loop, on the execute result and on the run resource, and a
 * run-from-block from that loop is accepted with the failed run as its source, where a start at
 * the failed block itself is refused.
 */
import { db } from '@sim/db'
import {
  permissions,
  user,
  userStats,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import {
  createDelegatedPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeRedisConnection } from '@/lib/core/config/redis'
import {
  executeManualWorkflowFromBlockOperation,
  executeManualWorkflowOperation,
} from '@/lib/workflows/application/execute-manual-workflow'
import { readWorkflowRun } from '@/lib/workflows/application/read-workflow-run'
import { getWorkflowExecutionLogStatus } from '@/lib/workflows/executor/execution-state'

const ownerId = generateId()
const workspaceId = generateId()
const workflowId = generateId()
const principal = createDelegatedPrincipal({
  subjectUserId: ownerId,
  workspaceId,
  audience: 'sim:workflows',
})
const reader = createSessionPrincipal({ userId: ownerId })

function block(id: string, type: string, extra: Partial<BlockState> = {}): BlockState {
  return {
    id,
    type,
    name: id,
    position: { x: 0, y: 0 },
    enabled: true,
    outputs: {},
    subBlocks: {},
    ...extra,
  }
}

/** Start, then a loop whose one block requests a host that never resolves, so it fails at once. */
const draft: WorkflowState = {
  blocks: {
    start: block('start', 'start_trigger'),
    loop: block('loop', 'loop', { data: { loopType: 'for', count: 1 } }),
    fetch: block('fetch', 'api', {
      data: { parentId: 'loop', extent: 'parent' },
      subBlocks: {
        url: { id: 'url', type: 'short-input', value: 'http://rerun-start.invalid/' },
        method: { id: 'method', type: 'dropdown', value: 'GET' },
      },
    }),
  },
  edges: [
    { id: 'start-loop', source: 'start', target: 'loop' },
    { id: 'loop-fetch', source: 'loop', target: 'fetch', sourceHandle: 'loop-start-source' },
  ],
  loops: {},
  parallels: {},
}

function runInput() {
  return {
    workflowId,
    requestId: generateId(),
    executionId: generateId(),
    input: {},
    mode: 'sync' as const,
    requestHeaders: new Headers(),
  }
}

/** The settled run, once its log row reads the status the result reported. */
async function settled<R extends { ok: boolean }>(result: R, executionId: string): Promise<R> {
  if (!result.ok || !('status' in result)) return result
  const deadline = Date.now() + 10_000
  while ((await getWorkflowExecutionLogStatus(executionId, workflowId)) !== result.status) {
    if (Date.now() >= deadline) throw new Error('Run did not persist its terminal log')
    await sleep(25)
  }
  return result
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Rerun start fixture',
    email: `${ownerId}@rerun-start.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId: ownerId })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Rerun start fixture',
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
    name: 'Rerun start fixture',
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const saved = await saveWorkflowToNormalizedTables(workflowId, draft)
  expect(saved.success, saved.error).toBe(true)
})

afterAll(async () => {
  await db.delete(workflowExecutionLogs).where(eq(workflowExecutionLogs.workflowId, workflowId))
  await db
    .delete(workflowExecutionSnapshots)
    .where(eq(workflowExecutionSnapshots.workflowId, workflowId))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, ownerId))
  await closeRedisConnection()
  await db.$client.end()
})

describe('a run that failed in a block inside a loop', () => {
  it('is rerun from the loop, which run-from-block accepts where it refuses the block', async () => {
    const input = { ...runInput(), sample: false }
    const run = await settled(
      await executeManualWorkflowOperation.execute({ principal, input }),
      input.executionId
    )
    expect(run).toMatchObject({
      ok: true,
      status: 'failed',
      error: { blockId: 'fetch' },
      rerunFromBlockId: 'loop',
    })

    const recorded = await readWorkflowRun.execute({
      principal: reader,
      input: { workflowId, runId: input.executionId, includeOutput: false, selectedOutputs: [] },
    })
    expect(recorded).toMatchObject({ failedBlock: { blockId: 'fetch' }, rerunFromBlockId: 'loop' })

    const fromLoop = { ...runInput(), blockId: 'loop', sourceRunId: input.executionId }
    expect(
      await executeManualWorkflowFromBlockOperation.execute({ principal, input: fromLoop })
    ).toMatchObject({ ok: true, status: 'failed', error: { blockId: 'fetch' } })

    const fromBlock = { ...runInput(), blockId: 'fetch', sourceRunId: input.executionId }
    const refused = await executeManualWorkflowFromBlockOperation
      .execute({ principal, input: fromBlock })
      .then(
        (result) => JSON.stringify(result),
        (error: unknown) => String(error)
      )
    expect(refused).toContain('Cannot run from block inside loop')
  })
})
