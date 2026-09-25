/** Actual authorization, normalization, and PostgreSQL replacement transactions; no provider calls. */
import { db } from '@sim/db'
import { permissions, user, workflow, workflowBlocks, workspace } from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createDeferred } from '@sim/testing'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import { replaceWorkflowState } from '@/lib/workflows/application/replace-workflow-state'
import { loadWorkflowDeploymentSnapshot } from '@/lib/workflows/persistence/utils'
import { loadWorkflowReadSnapshot } from '@/lib/workflows/queries'
import type { BlockState } from '@/stores/workflows/workflow/types'

const userId = generateId()
const workspaceId = generateId()
const principal = { kind: 'session' as const, userId, sessionId: generateId() }
const control = postgres(readTestDatabaseUrl(), { max: 2 })
let workflowId: string
let start: BlockState
let boundBlockId: string

async function storedBlocks() {
  return db.select().from(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId))
}

describe('workflow replacement with real PostgreSQL isolation', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Workflow authoring fixture',
      email: `${userId}@workflow.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Workflow authoring fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(permissions).values({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
    })
  })

  beforeEach(async () => {
    workflowId = generateId()
    boundBlockId = generateId()
    start = {
      id: generateId(),
      type: 'start_trigger',
      name: 'Start',
      enabled: true,
      position: { x: 0, y: 0 },
      subBlocks: {},
      outputs: {},
    }
    await db.insert(workflow).values({
      id: workflowId,
      userId,
      workspaceId,
      name: `Replace fixture ${workflowId}`,
      lastSynced: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.insert(workflowBlocks).values([
      {
        id: start.id,
        workflowId,
        type: start.type,
        name: start.name,
        positionX: '0',
        positionY: '0',
        enabled: true,
        subBlocks: {
          _removed_oldSecret: { id: '_removed_oldSecret', type: 'short-input', value: 'old' },
        },
        outputs: {},
        data: {},
      },
      {
        id: boundBlockId,
        workflowId,
        type: 'slack',
        name: 'Bound Slack',
        positionX: '200',
        positionY: '0',
        enabled: true,
        subBlocks: {
          operation: { id: 'operation', type: 'dropdown', value: 'send' },
          authMethod: { id: 'authMethod', type: 'dropdown', value: 'oauth' },
          credential: { id: 'credential', type: 'oauth-input', value: 'cred_before' },
        },
        outputs: {},
        data: {},
      },
    ])
  })

  afterAll(async () => {
    try {
      await db.delete(workspace).where(eq(workspace.id, workspaceId))
      await db.delete(user).where(eq(user.id, userId))
    } finally {
      await control.end()
      await db.$client.end()
    }
  })

  it('reports the committed binding baseline after waiting for a competing writer', async () => {
    const locked = createDeferred<number>()
    const release = createDeferred<void>()
    const competing = control.begin(async (tx) => {
      const [{ pid }] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
      await tx`SELECT id FROM workflow WHERE id = ${workflowId} FOR UPDATE`
      locked.resolve(pid)
      await release.promise
      await tx`UPDATE workflow_blocks SET sub_blocks = jsonb_set(
        sub_blocks, '{credential,value}', '"cred_committed_while_waiting"'::jsonb
      ) WHERE id = ${boundBlockId}`
    })
    void competing.catch((error) => locked.reject(error))
    const blockerPid = await locked.promise
    const replacing = withPermissionGroupScope(() =>
      replaceWorkflowState.execute({
        principal,
        input: { workflowId, blocks: { [start.id]: start }, edges: [] },
      })
    )
    /** Observe PostgreSQL's actual lock wait, not a mocked transaction callback. */
    let blocked = false
    let completed = false
    void replacing.then(
      () => {
        completed = true
      },
      () => {
        completed = true
      }
    )
    try {
      for (let attempt = 0; attempt < 500 && !completed; attempt++) {
        const [{ waiting }] = await control<{ waiting: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))
          ) AS waiting`
        if (waiting) {
          blocked = true
          break
        }
      }
    } finally {
      release.resolve()
      await competing
    }
    const result = await replacing
    expect(blocked).toBe(true)
    expect(result.removedBindings.map(({ resourceId }) => resourceId)).toEqual([
      'cred_committed_while_waiting',
    ])
    expect((await storedBlocks()).map(({ id }) => id)).toEqual([start.id])
  })

  it('normalizes legacy state for reads and dry runs without changing persisted rows', async () => {
    const before = await storedBlocks()
    const read = await loadWorkflowReadSnapshot(workflowId, workspaceId)
    const snapshot = await loadWorkflowDeploymentSnapshot(workflowId)
    const preview = await withPermissionGroupScope(() =>
      replaceWorkflowState.execute({
        principal,
        input: { workflowId, blocks: { [start.id]: start }, edges: [], dryRun: true },
      })
    )
    expect(read?.normalizedData?.blocks[start.id].subBlocks).not.toHaveProperty(
      '_removed_oldSecret'
    )
    expect(snapshot?.blocks[start.id].subBlocks).not.toHaveProperty('_removed_oldSecret')
    expect(preview.removedBindings.map(({ resourceId }) => resourceId)).toEqual(['cred_before'])
    /** Query after pending migration microtasks; both contents and update timestamps must survive. */
    expect(await storedBlocks()).toEqual(before)
  })
})
