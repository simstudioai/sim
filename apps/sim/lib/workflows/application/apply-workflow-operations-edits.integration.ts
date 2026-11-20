/**
 * Real PostgreSQL coverage for what an operations batch persists when it renames a block or
 * sets a loop or parallel count from a string, read back from the normalized tables.
 */
import { db } from '@sim/db'
import { auditLog, permissions, user, workflow, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock } from '@sim/testing/mocks/feature-flags.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { generateId } from '@sim/utils/id'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import { applyWorkflowOperations } from '@/lib/workflows/application/apply-workflow-operations'
import type { EditWorkflowOperation } from '@/lib/workflows/editing/types'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

const ownerId = generateId()
const workspaceId = generateId()
const principal = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })

function block(id: string, type: string, name: string, code?: string): BlockState {
  return {
    id,
    type,
    name,
    position: { x: 0, y: 0 },
    subBlocks: code === undefined ? {} : { code: { id: 'code', type: 'code', value: code } },
    outputs: {},
    enabled: true,
    data: {},
  }
}

async function seedWorkflow(blocks: BlockState[]): Promise<string> {
  const id = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id,
    userId: ownerId,
    workspaceId,
    name: `Operations edits ${id}`,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const state: WorkflowState = {
    blocks: Object.fromEntries(blocks.map((entry) => [entry.id, entry])),
    edges: [],
    loops: {},
    parallels: {},
  }
  const saved = await saveWorkflowToNormalizedTables(id, state)
  if (!saved.success) throw new Error(`Seeding the workflow failed: ${saved.error}`)
  return id
}

function apply(workflowId: string, operations: EditWorkflowOperation[], atomic = false) {
  return withPermissionGroupScope(() =>
    applyWorkflowOperations.execute({ principal, input: { workflowId, operations, atomic } })
  )
}

async function stored(workflowId: string) {
  const loaded = await loadWorkflowFromNormalizedTables(workflowId)
  if (!loaded) throw new Error('The workflow did not load')
  return loaded
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Operations edits fixture',
    email: `${ownerId}@operations-edits.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Operations edits',
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
})

afterAll(async () => {
  await db.delete(auditLog).where(eq(auditLog.workspaceId, workspaceId))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, ownerId))
})

describe('renaming a block through an operations batch', () => {
  it('rewrites the references other blocks hold to it, as the editor does', async () => {
    const save = generateId()
    const respond = generateId()
    const unrelated = generateId()
    const workflowId = await seedWorkflow([
      block(generateId(), 'starter', 'Start'),
      block(save, 'function', 'Save Order', 'return { row: 1 }'),
      block(
        respond,
        'function',
        'Respond',
        'return { saved: <saveorder.row>, all: <saveorder.result> }'
      ),
      block(unrelated, 'function', 'Unrelated', 'return <saveorders.row>'),
    ])

    await apply(workflowId, [
      { operation_type: 'edit', block_id: save, params: { name: 'Save Order Edited' } },
    ])

    const { blocks } = await stored(workflowId)
    expect(blocks[save].name).toBe('Save Order Edited')
    expect(blocks[respond].subBlocks.code.value).toBe(
      'return { saved: <saveorderedited.row>, all: <saveorderedited.result> }'
    )
    expect(blocks[unrelated].subBlocks.code.value).toBe('return <saveorders.row>')
  })
})

describe('a loop or parallel count given as a string', () => {
  it('stores a numeric string as its number on add and on edit', async () => {
    const workflowId = await seedWorkflow([block(generateId(), 'starter', 'Start')])
    const loop = generateId()
    const parallel = generateId()

    await apply(
      workflowId,
      [
        {
          operation_type: 'add',
          block_id: loop,
          params: { type: 'loop', name: 'Repeat', inputs: { loopType: 'for', iterations: '3' } },
        },
        {
          operation_type: 'add',
          block_id: parallel,
          params: {
            type: 'parallel',
            name: 'Fan Out',
            inputs: { parallelType: 'count', count: '2' },
          },
        },
      ],
      true
    )

    const added = await stored(workflowId)
    expect(added.loops[loop]).toMatchObject({ iterations: 3 })
    expect(added.parallels[parallel]).toMatchObject({ count: 2 })

    await apply(workflowId, [
      { operation_type: 'edit', block_id: loop, params: { inputs: { iterations: ' 4 ' } } },
    ])

    expect((await stored(workflowId)).loops[loop]).toMatchObject({ iterations: 4 })
  })

  it('refuses a non-numeric count instead of silently resetting it', async () => {
    const workflowId = await seedWorkflow([block(generateId(), 'starter', 'Start')])

    await expect(
      apply(
        workflowId,
        [
          {
            operation_type: 'add',
            block_id: generateId(),
            params: {
              type: 'loop',
              name: 'Repeat',
              inputs: { loopType: 'for', iterations: 'three' },
            },
          },
        ],
        true
      )
    ).rejects.toMatchObject({
      droppedInputs: [expect.objectContaining({ field: 'iterations', value: 'three' })],
    })
    expect(Object.keys((await stored(workflowId)).loops)).toEqual([])
  })

  it.each(['1e3', '0x10', '2.5', '-1', '0', 2.5, -1])(
    'refuses %j, which is no whole number of at least 1',
    async (iterations) => {
      const workflowId = await seedWorkflow([block(generateId(), 'starter', 'Start')])

      await expect(
        apply(
          workflowId,
          [
            {
              operation_type: 'add',
              block_id: generateId(),
              params: { type: 'loop', name: 'Repeat', inputs: { loopType: 'for', iterations } },
            },
          ],
          true
        )
      ).rejects.toMatchObject({
        droppedInputs: [expect.objectContaining({ field: 'iterations', value: iterations })],
      })
      expect(Object.keys((await stored(workflowId)).loops)).toEqual([])
    }
  )
})
