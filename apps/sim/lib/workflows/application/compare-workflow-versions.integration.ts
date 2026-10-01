import { db } from '@sim/db'
import { user, workflow, workflowDeploymentVersion, workspace } from '@sim/db/schema'
import { createWorkspaceApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compareWorkflowVersions } from '@/lib/workflows/application/compare-workflow-versions'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const ownerId = generateId()
const workspaceId = generateId()
const otherWorkspaceId = generateId()
const workflowId = generateId()
const otherWorkflowId = generateId()
const principal = createWorkspaceApiKeyPrincipal({ workspaceId, keyId: generateId() })

function state(value: string): WorkflowState {
  return {
    blocks: {
      fn: {
        id: 'fn',
        type: 'function',
        name: 'Function',
        enabled: true,
        position: { x: 0, y: 0 },
        outputs: {},
        subBlocks: {
          code: { id: 'code', type: 'code', value: `return ${value}` },
        },
      },
      convex: {
        id: 'convex',
        type: 'convex',
        name: 'Convex',
        enabled: true,
        position: { x: 300, y: 0 },
        outputs: {},
        subBlocks: {
          deployKey: { id: 'deployKey', type: 'short-input', value: `private-${value}` },
        },
      },
    },
    edges: [],
    loops: {},
    parallels: {},
    lastSaved: 0,
  }
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Comparison fixture',
    email: `${ownerId}@comparison.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(workspace).values(
    [workspaceId, otherWorkspaceId].map((id) => ({
      id,
      name: 'Comparison fixture',
      ownerId,
      billedAccountUserId: ownerId,
    }))
  )
  await db.insert(workflow).values(
    [workflowId, otherWorkflowId].map((id) => ({
      id,
      userId: ownerId,
      workspaceId,
      name: id,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(workflowDeploymentVersion).values([
    { id: generateId(), workflowId, version: 1, state: state('1') },
    { id: generateId(), workflowId, version: 2, state: state('2') },
    { id: generateId(), workflowId: otherWorkflowId, version: 3, state: state('3') },
    { id: generateId(), workflowId, version: 4, state: state('x'.repeat(17 * 1024 * 1024)) },
  ])
})

afterAll(async () => {
  await db.delete(workspace).where(inArray(workspace.id, [workspaceId, otherWorkspaceId]))
  await db.delete(user).where(eq(user.id, ownerId))
  await db.$client.end()
})

const compare = (base: number, target: number) =>
  compareWorkflowVersions.execute({ principal, input: { workflowId, base, target } })

describe('compare deployment versions through the authorized application boundary', () => {
  it('reads the requested immutable versions and reverses field values when the direction changes', async () => {
    const forward = await compare(1, 2)
    const reverse = await compare(2, 1)
    const field = (result: typeof forward) =>
      result.diff.modifiedBlocks
        .find((block) => block.id === 'fn')!
        .changes.find((change) => change.field === 'code')!
    expect(field(forward)).toMatchObject({
      oldValue: { kind: 'value', value: 'return 1' },
      newValue: { kind: 'value', value: 'return 2' },
    })
    expect(field(reverse)).toMatchObject({
      oldValue: field(forward).newValue,
      newValue: field(forward).oldValue,
    })
    expect(JSON.stringify(forward)).not.toContain('private-')
    expect(
      forward.diff.modifiedBlocks.find((block) => block.id === 'convex')?.changes
    ).toContainEqual({
      field: 'deployKey',
      oldValue: { kind: 'redacted' },
      newValue: { kind: 'redacted' },
    })
    expect((await compare(1, 1)).diff.hasChanges).toBe(false)
  })

  it('rejects another workspace principal', async () => {
    await expect(
      compareWorkflowVersions.execute({
        principal: createWorkspaceApiKeyPrincipal({
          workspaceId: otherWorkspaceId,
          keyId: generateId(),
        }),
        input: { workflowId, base: 1, target: 2 },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('cannot satisfy a version reference with a version from another workflow', async () => {
    await expect(compare(1, 3)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects oversized snapshots before materializing the comparison', async () => {
    await expect(compare(1, 4)).rejects.toMatchObject({ code: 'payload_too_large' })
  })
})
