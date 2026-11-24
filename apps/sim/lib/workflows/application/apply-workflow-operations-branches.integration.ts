/**
 * Real PostgreSQL coverage for what an operations edit that re-sends a condition's or router's
 * branch list persists: the stored edges must still name the stored rows, read back from the
 * normalized tables. The canvas mints row ids such as `<blockId>-else-if-<timestamp>` and keeps
 * them when a branch is moved, so stored ids are not positional.
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

interface BranchRow {
  id: string
  title: string
  value: string
}

type BranchKind = 'condition' | 'router_v2'

/** Where each branch block kind stores its rows and how its edges name them. */
const KINDS = {
  condition: { key: 'conditions', inputType: 'condition-input', handlePrefix: 'condition' },
  router_v2: { key: 'routes', inputType: 'router-input', handlePrefix: 'router' },
} as const

function block(id: string, type: string, name: string, subBlocks: BlockState['subBlocks'] = {}) {
  return {
    id,
    type,
    name,
    position: { x: 0, y: 0 },
    subBlocks,
    outputs: {},
    enabled: true,
    data: {},
  } satisfies BlockState
}

interface Fixture {
  kind: BranchKind
  workflowId: string
  branchId: string
  targets: Record<string, string>
}

/**
 * Seeds a start block, branch block `branchId` with `rows`, and one function block per row, each
 * wired from its row's handle. `targets` maps each row's value to the block it routes to.
 */
async function seedBranches(
  kind: BranchKind,
  branchId: string,
  rows: BranchRow[]
): Promise<Fixture> {
  const { key, inputType, handlePrefix } = KINDS[kind]
  const workflowId = generateId()
  const targets: Record<string, string> = {}
  const blocks: BlockState[] = [
    block(generateId(), 'starter', 'Start'),
    block(branchId, kind, 'Branch', {
      [key]: { id: key, type: inputType, value: JSON.stringify(rows) },
    }),
  ]
  const edges: WorkflowState['edges'] = []
  rows.forEach((row, index) => {
    const target = generateId()
    targets[row.value] = target
    blocks.push(block(target, 'function', `Target ${index}`))
    edges.push({
      id: generateId(),
      source: branchId,
      target,
      sourceHandle: `${handlePrefix}-${row.id}`,
      targetHandle: 'target',
    })
  })
  const now = new Date()
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: `Branch edits ${workflowId}`,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const saved = await saveWorkflowToNormalizedTables(workflowId, {
    blocks: Object.fromEntries(blocks.map((entry) => [entry.id, entry])),
    edges,
    loops: {},
    parallels: {},
  })
  if (!saved.success) throw new Error(`Seeding the workflow failed: ${saved.error}`)
  return { kind, workflowId, branchId, targets }
}

/** Applies an operations edit that re-sends the branch block's rows, and `connections` if given. */
function resendBranches(fixture: Fixture, rows: unknown[], connections?: Record<string, string>) {
  const operations: EditWorkflowOperation[] = [
    {
      operation_type: 'edit',
      block_id: fixture.branchId,
      params: { inputs: { [KINDS[fixture.kind].key]: rows }, ...(connections && { connections }) },
    },
  ]
  return withPermissionGroupScope(() =>
    applyWorkflowOperations.execute({
      principal,
      input: { workflowId: fixture.workflowId, operations, atomic: true },
    })
  )
}

/**
 * What the stored workflow routes each branch to, by the branch's expression and by row
 * position, plus the edges from the branch block whose handle names no stored row.
 */
async function storedRouting(fixture: Fixture) {
  const loaded = await loadWorkflowFromNormalizedTables(fixture.workflowId)
  if (!loaded) throw new Error('The workflow did not load')
  const { key, handlePrefix } = KINDS[fixture.kind]
  const rows: BranchRow[] = JSON.parse(String(loaded.blocks[fixture.branchId].subBlocks[key].value))
  const outgoing = loaded.edges.filter((edge) => edge.source === fixture.branchId)
  const byPosition = rows.map((row) =>
    outgoing
      .filter((edge) => edge.sourceHandle === `${handlePrefix}-${row.id}`)
      .map((edge) => edge.target)
  )
  const routing = Object.fromEntries(rows.map((row, index) => [row.value, byPosition[index]]))
  const rowHandles = new Set(rows.map((row) => `${handlePrefix}-${row.id}`))
  const dangling = outgoing.filter((edge) => !rowHandles.has(edge.sourceHandle ?? ''))
  return { rows, routing, byPosition, dangling }
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Branch edits fixture',
    email: `${ownerId}@branch-edits.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Branch edits',
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

describe('an edit that re-sends a condition block’s branches', () => {
  it('keeps the connection of a branch the canvas added', async () => {
    const id = generateId()
    const fixture = await seedBranches('condition', id, [
      { id: `${id}-if`, title: 'if', value: '<start.input> == 1' },
      { id: `${id}-else-if-1763700000000`, title: 'else if', value: '<start.input> == 2' },
      { id: `${id}-else`, title: 'else', value: '' },
    ])

    await resendBranches(fixture, [
      { title: 'if', value: '<start.input> == 1' },
      { title: 'else if', value: '<start.input> == 3' },
      { title: 'else', value: '' },
    ])

    const { routing, dangling } = await storedRouting(fixture)
    expect(dangling).toEqual([])
    expect(routing).toEqual({
      '<start.input> == 1': [fixture.targets['<start.input> == 1']],
      '<start.input> == 3': [fixture.targets['<start.input> == 2']],
      '': [fixture.targets['']],
    })
  })

  it('keeps each position routed where it was after the canvas reordered the rows', async () => {
    const id = generateId()
    const fixture = await seedBranches('condition', id, [
      { id: `${id}-else-if-1763700000000`, title: 'if', value: 'first' },
      { id: `${id}-if`, title: 'else if', value: 'second' },
      { id: `${id}-else`, title: 'else', value: '' },
    ])

    await resendBranches(fixture, [
      { title: 'if', value: 'first' },
      { title: 'else if', value: 'second' },
      { title: 'else', value: '' },
    ])

    const { routing, dangling } = await storedRouting(fixture)
    expect(dangling).toEqual([])
    expect(routing).toEqual({
      first: [fixture.targets.first],
      second: [fixture.targets.second],
      '': [fixture.targets['']],
    })
  })

  it('removes the connection of a branch the edit removes and keeps the rest', async () => {
    const id = generateId()
    const fixture = await seedBranches('condition', id, [
      { id: `${id}-if`, title: 'if', value: 'a' },
      { id: `${id}-else-if-1763700000000`, title: 'else if', value: 'b' },
      { id: `${id}-else`, title: 'else', value: '' },
    ])

    await resendBranches(fixture, [
      { title: 'if', value: 'a' },
      { title: 'else', value: '' },
    ])

    const { routing, dangling } = await storedRouting(fixture)
    expect(dangling).toEqual([])
    expect(routing).toEqual({ a: [fixture.targets.a], '': [fixture.targets['']] })
  })

  it('gives an added branch its own row without taking another branch’s connection', async () => {
    const id = generateId()
    // An edit wrote else-if-0 and else-if-1, then the canvas deleted else-if-0: the row now in
    // the else-if-0 slot holds the id an added else-if-1 would be given.
    const fixture = await seedBranches('condition', id, [
      { id: `${id}-if`, title: 'if', value: 'a' },
      { id: `${id}-else-if-1`, title: 'else if', value: 'b' },
      { id: `${id}-else`, title: 'else', value: '' },
    ])

    await resendBranches(fixture, [
      { title: 'if', value: 'a' },
      { title: 'else if', value: 'b' },
      { title: 'else if', value: 'c' },
      { title: 'else', value: '' },
    ])

    const { rows, routing, dangling } = await storedRouting(fixture)
    expect(dangling).toEqual([])
    expect(new Set(rows.map((row) => row.id)).size).toBe(4)
    expect(routing).toEqual({
      a: [fixture.targets.a],
      b: [fixture.targets.b],
      c: [],
      '': [fixture.targets['']],
    })
  })

  it('keeps each remaining branch connected when the edit removes a middle branch', async () => {
    const id = generateId()
    const fixture = await seedBranches('condition', id, [
      { id: `${id}-if`, title: 'if', value: 'a' },
      { id: `${id}-else-if-1763700000000`, title: 'else if', value: 'b' },
      { id: `${id}-else-if-1763700000001`, title: 'else if', value: 'c' },
      { id: `${id}-else`, title: 'else', value: '' },
    ])

    await resendBranches(fixture, [
      { title: 'if', value: 'a' },
      { title: 'else if', value: 'c' },
      { title: 'else', value: '' },
    ])

    const { routing, dangling } = await storedRouting(fixture)
    expect(dangling).toEqual([])
    expect(routing).toEqual({
      a: [fixture.targets.a],
      c: [fixture.targets.c],
      '': [fixture.targets['']],
    })
  })

  it('leaves an inserted middle branch unconnected and the branch after it in place', async () => {
    const id = generateId()
    const fixture = await seedBranches('condition', id, [
      { id: `${id}-if`, title: 'if', value: 'a' },
      { id: `${id}-else-if-1763700000000`, title: 'else if', value: 'b' },
      { id: `${id}-else`, title: 'else', value: '' },
    ])

    await resendBranches(fixture, [
      { title: 'if', value: 'a' },
      { title: 'else if', value: 'new' },
      { title: 'else if', value: 'b' },
      { title: 'else', value: '' },
    ])

    const { routing, dangling } = await storedRouting(fixture)
    expect(dangling).toEqual([])
    expect(routing).toEqual({
      a: [fixture.targets.a],
      new: [],
      b: [fixture.targets.b],
      '': [fixture.targets['']],
    })
  })

  it('keeps an edited branch connected when its new expression repeats a later branch', async () => {
    const id = generateId()
    const fixture = await seedBranches('condition', id, [
      { id: `${id}-if`, title: 'if', value: 'a' },
      { id: `${id}-else-if-1763700000000`, title: 'else if', value: 'b' },
      { id: `${id}-else-if-1763700000001`, title: 'else if', value: 'c' },
      { id: `${id}-else`, title: 'else', value: '' },
    ])

    await resendBranches(fixture, [
      { title: 'if', value: 'a' },
      { title: 'else if', value: 'c' },
      { title: 'else if', value: 'c' },
      { title: 'else', value: '' },
    ])

    const { byPosition, dangling } = await storedRouting(fixture)
    expect(dangling).toEqual([])
    expect(byPosition).toEqual([
      [fixture.targets.a],
      [fixture.targets.b],
      [fixture.targets.c],
      [fixture.targets['']],
    ])
  })

  it('refuses a condition row that is not an object as invalid input and keeps every connection', async () => {
    const id = generateId()
    const fixture = await seedBranches('condition', id, [
      { id: `${id}-if`, title: 'if', value: 'a' },
      { id: `${id}-else`, title: 'else', value: '' },
    ])

    await expect(
      resendBranches(fixture, [null, { title: 'else', value: '' }])
    ).rejects.toMatchObject({
      droppedInputs: [expect.objectContaining({ field: 'conditions' })],
    })

    const { routing, dangling } = await storedRouting(fixture)
    expect(dangling).toEqual([])
    expect(routing).toEqual({ a: [fixture.targets.a], '': [fixture.targets['']] })
  })
})

describe('an edit that re-sends a router’s routes', () => {
  it('keeps the connection of a route the canvas added', async () => {
    const id = generateId()
    const fixture = await seedBranches('router_v2', id, [
      { id: `${id}-route1`, title: 'route1', value: 'billing questions' },
      { id: `${id}-route-1763700000000`, title: 'route-1763700000000', value: 'bug reports' },
    ])

    await resendBranches(fixture, [
      { title: 'route1', value: 'billing questions' },
      { title: 'route2', value: 'bug reports and crashes' },
    ])

    const { routing, dangling } = await storedRouting(fixture)
    expect(dangling).toEqual([])
    expect(routing).toEqual({
      'billing questions': [fixture.targets['billing questions']],
      'bug reports and crashes': [fixture.targets['bug reports']],
    })
  })
  it('resolves a stored route handle to its own route after the routes were reordered', async () => {
    const id = generateId()
    const fixture = await seedBranches('router_v2', id, [
      { id: `${id}-route1`, title: 'route1', value: 'billing questions' },
      { id: `${id}-route2`, title: 'route2', value: 'bug reports' },
    ])

    await resendBranches(
      fixture,
      [
        { title: 'route1', value: 'bug reports' },
        { title: 'route2', value: 'billing questions' },
      ],
      { [`router-${id}-route2`]: fixture.targets['bug reports'] }
    )

    const { routing, dangling } = await storedRouting(fixture)
    expect(dangling).toEqual([])
    expect(routing).toEqual({
      'bug reports': [fixture.targets['bug reports']],
      'billing questions': [],
    })
  })
})
