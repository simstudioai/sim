/**
 * Dry runs against real PostgreSQL, through the manual run use case: a dry run writes no table row
 * and sends no HTTP request, and reports both writes with the payloads they would have sent (the
 * run's secrets redacted) under the `test` trigger; an allowed block writes for real while reads
 * run for real; a child workflow's write stays stubbed; and a mocked block steers a branch.
 */
import { db } from '@sim/db'
import {
  permissions,
  user,
  userStats,
  userTableDefinitions,
  userTableRows,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
  workspaceEnvironment,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { BlockState, SubBlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeRedisConnection } from '@/lib/core/config/redis'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  type ExecuteManualWorkflowInput,
  executeManualWorkflowOperation,
} from '@/lib/workflows/application/execute-manual-workflow'
import type { ExecuteWorkflowServiceRun } from '@/lib/workflows/executor/execute-service'
import { getWorkflowExecutionLogStatus } from '@/lib/workflows/executor/execution-state'

const ownerId = generateId()
const workspaceId = generateId()
const parentId = generateId()
const childId = generateId()
const branchingId = generateId()
const tableId = generateId()
const SECRET = `dry-secret-${generateId()}`
const principal = createDelegatedPrincipal({
  subjectUserId: ownerId,
  workspaceId,
  audience: 'sim:workflows',
})

/** Block ids are global keys, so each block gets a fresh one; tests address blocks by name. */
function block(
  name: string,
  type: string,
  values: Record<string, SubBlockState['value']> = {}
): BlockState {
  return {
    id: generateId(),
    type,
    name,
    position: { x: 0, y: 0 },
    enabled: true,
    outputs: {},
    subBlocks: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, { id: key, type: 'short-input', value }])
    ),
  }
}

/** A graph of `blocks`, wired by `[source, target, sourceHandle?]` block names. */
function graph(
  blocks: BlockState[],
  edges: Array<[string, string, string?]>
): { state: WorkflowState; idOf: (name: string) => string } {
  const idOf = (name: string) => {
    const found = blocks.find((entry) => entry.name === name)
    if (!found) throw new Error(`No block ${name}`)
    return found.id
  }
  const state: WorkflowState = {
    blocks: Object.fromEntries(blocks.map((entry) => [entry.id, entry])),
    edges: edges.map(([source, target, handle]) => ({
      id: generateId(),
      source: idOf(source),
      target: idOf(target),
      ...(handle ? { sourceHandle: handle } : {}),
    })),
    loops: {},
    parallels: {},
  }
  return { state, idOf }
}

const upsertLead = (id: string, email: string) =>
  block(id, 'table', {
    operation: 'upsert_row',
    tableSelector: tableId,
    data: JSON.stringify({ email, score: 82 }),
  })

/** A POST to a host that never resolves: sent, it fails the run. Its body carries a secret. */
const notify = (id: string) =>
  block(id, 'api', {
    url: 'http://dry-run.invalid/hook',
    method: 'POST',
    body: JSON.stringify({ email: 'a@b.co', note: 'key={{DRY_SECRET}}' }),
  })

/** Start → lookup (read) → save (table upsert) → notify (HTTP POST) → child (Workflow block). */
const parent = graph(
  [
    block('start', 'start_trigger'),
    block('lookup', 'table', { operation: 'query_rows', tableSelector: tableId }),
    upsertLead('save', 'a@b.co'),
    notify('notify'),
    block('child', 'workflow', { workflowId: childId }),
  ],
  [
    ['start', 'lookup'],
    ['lookup', 'save'],
    ['save', 'notify'],
    ['notify', 'child'],
  ]
)

const child = graph(
  [block('start', 'start_trigger'), upsertLead('childsave', 'child@b.co')],
  [['start', 'childsave']]
)

/** Start → lookup → gate: over 50 rows goes to `big`, else to `small`; both are POSTs. */
const gate = block('gate', 'condition')
gate.subBlocks.conditions = {
  id: 'conditions',
  type: 'condition-input',
  value: JSON.stringify([
    { id: `${gate.id}-if`, title: 'if', value: '<lookup.totalCount> > 50' },
    { id: `${gate.id}-else`, title: 'else', value: '' },
  ]),
}
const branching = graph(
  [
    block('start', 'start_trigger'),
    block('lookup', 'table', { operation: 'query_rows', tableSelector: tableId }),
    gate,
    notify('big'),
    notify('small'),
  ],
  [
    ['start', 'lookup'],
    ['lookup', 'gate'],
    ['gate', 'big', `condition-${gate.id}-if`],
    ['gate', 'small', `condition-${gate.id}-else`],
  ]
)

async function run(
  workflowId: string,
  options: Partial<ExecuteManualWorkflowInput> = {}
): Promise<ExecuteWorkflowServiceRun> {
  const executionId = generateId()
  const result = await executeManualWorkflowOperation.execute({
    principal,
    input: {
      workflowId,
      requestId: generateId(),
      executionId,
      input: {},
      mode: 'sync',
      requestHeaders: new Headers(),
      useMockPayload: false,
      ...options,
    },
  })
  if (!result.ok || !('status' in result)) {
    throw new Error(`Run did not settle: ${JSON.stringify(result)}`)
  }
  const deadline = Date.now() + 10_000
  while ((await getWorkflowExecutionLogStatus(executionId, workflowId)) !== result.status) {
    if (Date.now() >= deadline) throw new Error('Run did not persist its terminal log')
    await sleep(25)
  }
  return result
}

async function rowEmails(): Promise<string[]> {
  const rows = await db
    .select({ data: userTableRows.data })
    .from(userTableRows)
    .where(eq(userTableRows.tableId, tableId))
  return rows.map((row) => JSON.stringify(row.data))
}

async function triggerOf(executionId: string): Promise<string | undefined> {
  const [log] = await db
    .select({ trigger: workflowExecutionLogs.trigger })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, executionId))
  return log?.trigger
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Dry run fixture',
    email: `${ownerId}@dry-run.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId: ownerId })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Dry run fixture',
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
  await db.insert(workspaceEnvironment).values({
    id: generateId(),
    workspaceId,
    variables: { DRY_SECRET: (await encryptSecret(SECRET)).encrypted },
  })
  await db.insert(userTableDefinitions).values({
    id: tableId,
    workspaceId,
    name: 'leads',
    createdBy: ownerId,
    schema: {
      columns: [
        { id: 'col_email', name: 'email', type: 'string', required: true, unique: true },
        { id: 'col_score', name: 'score', type: 'number' },
      ],
    },
  })
  for (const [id, state] of [
    [parentId, parent],
    [childId, child],
    [branchingId, branching],
  ] as const) {
    await db.insert(workflow).values({
      id,
      userId: ownerId,
      workspaceId,
      name: `Dry run ${id}`,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    })
    const saved = await saveWorkflowToNormalizedTables(id, state.state)
    expect(saved.success, saved.error).toBe(true)
  }
})

afterAll(async () => {
  const workflowIds = [parentId, childId, branchingId]
  await db
    .delete(workflowExecutionLogs)
    .where(inArray(workflowExecutionLogs.workflowId, workflowIds))
  await db
    .delete(workflowExecutionSnapshots)
    .where(inArray(workflowExecutionSnapshots.workflowId, workflowIds))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, ownerId))
  await closeRedisConnection()
  await db.$client.end()
})

describe('a dry run', () => {
  it('writes no row and sends no request, and reports each write it held back', async () => {
    const result = await run(parentId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(await rowEmails()).toEqual([])
    expect(await triggerOf(result.executionId)).toBe('test')

    const stubbed = result.sideEffects?.stubbed ?? []
    expect(stubbed.map((entry) => [entry.workflowId, entry.block, entry.tool])).toEqual([
      [parentId, 'save', 'table_upsert_row'],
      [parentId, 'notify', 'http_request'],
      [childId, 'childsave', 'table_upsert_row'],
    ])
    expect(stubbed[0].request).toMatchObject({
      tableId,
      data: { email: 'a@b.co', score: 82 },
    })
    expect(stubbed[1].request).toMatchObject({
      method: 'POST',
      url: 'http://dry-run.invalid/hook',
      body: { email: 'a@b.co' },
    })
    expect(JSON.stringify(stubbed[1].request)).not.toContain(SECRET)
    expect(stubbed[2].request).toMatchObject({ data: { email: 'child@b.co' } })
    expect(result.sideEffects?.allowed).toEqual([])
  })

  it('sends an allowed block’s write and still runs reads for real', async () => {
    const allowed = await run(parentId, { dry: true, allowBlocks: ['save'] })

    expect(allowed.status, JSON.stringify(allowed.error)).toBe('completed')
    expect(await rowEmails()).toEqual([expect.stringContaining('a@b.co')])
    expect(allowed.sideEffects?.allowed).toEqual([
      {
        workflowId: parentId,
        blockId: parent.idOf('save'),
        block: 'save',
        tool: 'table_upsert_row',
      },
    ])
    expect(allowed.sideEffects?.stubbed.map((entry) => entry.block)).toEqual([
      'notify',
      'childsave',
    ])

    const reread = await run(parentId, { dry: true, selectedOutputs: ['lookup.rows'] })
    expect(JSON.stringify(reread.blockOutputs?.['lookup.rows'])).toContain('a@b.co')
    expect(await rowEmails()).toHaveLength(1)
  })

  it('takes the branch a mocked block steers it to', async () => {
    const unmocked = await run(branchingId, { dry: true })
    expect(unmocked.sideEffects?.stubbed.map((entry) => entry.block)).toEqual(['small'])

    const mocked = await run(branchingId, {
      dry: true,
      mocks: { lookup: { rows: [], rowCount: 0, totalCount: 99 } },
    })
    expect(mocked.status, JSON.stringify(mocked.error)).toBe('completed')
    expect(mocked.sideEffects?.stubbed.map((entry) => entry.block)).toEqual(['big'])
  })

  it('refuses to allow a block outside a dry run, or one the draft does not have', async () => {
    await expect(run(parentId, { allowBlocks: ['save'] })).rejects.toThrow(
      'run.allowBlocks requires run.dry'
    )
    await expect(run(parentId, { dry: true, allowBlocks: ['nope'] })).rejects.toThrow(
      /run\.allowBlocks "nope" is not a block/
    )
  })
})
