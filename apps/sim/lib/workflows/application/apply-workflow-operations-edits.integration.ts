/**
 * Real PostgreSQL coverage for what an operations batch persists when it renames a block, read
 * back from the normalized tables.
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
