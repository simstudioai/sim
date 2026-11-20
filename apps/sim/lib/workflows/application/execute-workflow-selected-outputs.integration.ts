/**
 * `selectedOutputs` on a deployed run of a workflow that calls a child workflow, against real
 * PostgreSQL through the execute use case. A selector naming a parent block must reach the
 * executor in its internal form, so the child-workflow block never mistakes `block.path` for a
 * `workflow.block` selector; a selector that targets a child block returns that block's output
 * under the caller's selector; one that targets the child but names nothing there must not
 * fail a run that otherwise succeeded; and a selector naming no parent block is refused before
 * the run starts, so it is never executed or billed.
 */
import { db } from '@sim/db'
import {
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { executeWorkflowOperation } from '@/lib/workflows/application/execute-workflow'

const ownerId = generateId()
const workspaceId = generateId()
const parentWorkflowId = generateId()
const childWorkflowId = generateId()
const principal = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
/** Deployed block IDs are UUIDs; `blockOutputs` projects only blocks with one. */
const blockIds = {
  start: generateId(),
  ask: generateId(),
  done: generateId(),
  childDone: generateId(),
}

const startBlock = {
  id: blockIds.start,
  type: 'start_trigger',
  name: 'Start',
  enabled: true,
  position: { x: 0, y: 0 },
  outputs: {},
  subBlocks: {},
}

function responseBlock(id: string, name: string, data: string) {
  return {
    id,
    type: 'response',
    name,
    enabled: true,
    position: { x: 600, y: 0 },
    outputs: {},
    subBlocks: {
      dataMode: { id: 'dataMode', type: 'dropdown', value: 'json' },
      data: { id: 'data', type: 'code', value: data },
      status: { id: 'status', type: 'short-input', value: '200' },
    },
  }
}

const childState = {
  blocks: {
    [blockIds.start]: startBlock,
    [blockIds.childDone]: responseBlock(
      blockIds.childDone,
      'Child Done',
      '{"answer": "from child"}'
    ),
  },
  edges: [{ id: generateId(), source: blockIds.start, target: blockIds.childDone }],
  loops: {},
  parallels: {},
  variables: {},
}

const parentState = {
  blocks: {
    [blockIds.start]: startBlock,
    [blockIds.ask]: {
      id: blockIds.ask,
      type: 'workflow_input',
      name: 'Ask',
      enabled: true,
      position: { x: 300, y: 0 },
      outputs: {},
      subBlocks: {
        workflowId: { id: 'workflowId', type: 'workflow-selector', value: childWorkflowId },
        inputMapping: { id: 'inputMapping', type: 'input-mapping', value: {} },
      },
    },
    [blockIds.done]: responseBlock(blockIds.done, 'Done', '{"answer": "<ask.result.data.answer>"}'),
  },
  edges: [
    { id: generateId(), source: blockIds.start, target: blockIds.ask },
    { id: generateId(), source: blockIds.ask, target: blockIds.done },
  ],
  loops: {},
  parallels: {},
  variables: {},
}

function run(selectedOutputs: string[]) {
  return executeWorkflowOperation.execute({
    principal,
    input: {
      workflowId: parentWorkflowId,
      requestId: generateId(),
      input: {},
      mode: 'sync',
      selectedOutputs,
      requestHeaders: new Headers(),
    },
  })
}

async function parentLogCount(): Promise<number> {
  const rows = await db
    .select({ id: workflowExecutionLogs.id })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.workflowId, parentWorkflowId))
  return rows.length
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Selected outputs fixture',
    email: `${ownerId}@selected-outputs.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Selected outputs fixture',
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
  await db.insert(workflow).values(
    [
      { id: parentWorkflowId, name: 'Parent' },
      { id: childWorkflowId, name: 'Child' },
    ].map(({ id, name }) => ({
      id,
      userId: ownerId,
      workspaceId,
      name,
      isDeployed: true,
      deployedAt: now,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(workflowDeploymentVersion).values([
    {
      id: generateId(),
      workflowId: parentWorkflowId,
      version: 1,
      state: parentState,
      isActive: true,
    },
    {
      id: generateId(),
      workflowId: childWorkflowId,
      version: 1,
      state: childState,
      isActive: true,
    },
  ])
})

afterAll(async () => {
  const workflowIds = [parentWorkflowId, childWorkflowId]
  await db
    .delete(workflowExecutionLogs)
    .where(inArray(workflowExecutionLogs.workflowId, workflowIds))
  await db
    .delete(workflowExecutionSnapshots)
    .where(inArray(workflowExecutionSnapshots.workflowId, workflowIds))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, ownerId))
  await db.$client.end()
})

describe('selectedOutputs on a run that calls a child workflow', () => {
  it('completes and returns a parent block output selected by name and path', async () => {
    const result = await run(['done.data'])

    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      blockOutputs: { 'done.data': { answer: 'from child' } },
    })
  })

  it('returns a child block output selected by child workflow, block name, and path', async () => {
    const childSelector = `${childWorkflowId}.childdone.data`
    const result = await run([childSelector, 'done.data'])

    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      blockOutputs: {
        [childSelector]: { answer: 'from child' },
        'done.data': { answer: 'from child' },
      },
    })
  })

  it('matches a child block name regardless of case and spacing, as the parent does', async () => {
    const childSelector = `${childWorkflowId}.Child Done.data.answer`
    const result = await run([childSelector, 'Done.data.answer'])

    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      blockOutputs: { [childSelector]: 'from child', 'Done.data.answer': 'from child' },
    })
  })

  it('returns a child block output selected by child block ID', async () => {
    const childSelector = `${childWorkflowId}.${blockIds.childDone}.data.answer`
    const result = await run([childSelector])

    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      blockOutputs: { [childSelector]: 'from child' },
    })
  })

  it('completes when a child-targeted selector names no block in the child', async () => {
    const result = await run([`${childWorkflowId}.missing.data`, 'done.data'])

    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      blockOutputs: { 'done.data': { answer: 'from child' } },
    })
  })

  it('refuses a selector naming no parent block before the run starts, leaving no run to bill', async () => {
    const before = await parentLogCount()

    const result = await run(['nosuchblock.data'])

    expect(result).toMatchObject({ ok: false, failure: { kind: 'input', statusCode: 400 } })
    expect(await parentLogCount()).toBe(before)
  })
})
