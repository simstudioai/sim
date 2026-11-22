/**
 * Real PostgreSQL coverage for the lint's child workflow checks: the children a Workflow block
 * calls are read from the workflow, graph and deployment tables, and a graph is linted against
 * them. The `result.<key>` of a child whose every run ends at a Response block reads nothing
 * unless `<key>` is a Response output, judged on the version the caller's run calls, and a deploy
 * reports a called child with no deployment, which a deployed run cannot call.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import { user, workflow, workflowDeploymentVersion, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import type { Edge } from '@xyflow/react'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildWorkflowLintReport } from '@/lib/workflows/editing/lint-report'

const ownerId = generateId()
const workspaceId = generateId()
const otherWorkspaceId = generateId()

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

function block(
  id: string,
  type: string,
  name: string,
  subBlocks: Record<string, unknown> = {},
  enabled = true
): BlockState {
  return {
    id,
    type,
    name,
    position: { x: 0, y: 0 },
    subBlocks: Object.fromEntries(
      Object.entries(subBlocks).map(([field, value]) => [
        field,
        { id: field, type: 'short-input', value },
      ])
    ),
    outputs: {},
    enabled,
  } as BlockState
}

function edge(source: string, target: string, sourceHandle = 'source'): Edge {
  return { id: generateId(), source, target, sourceHandle, targetHandle: 'target' }
}

/**
 * A child graph: a Start trigger wired to a Response block "Reply" (disabled with `'disabled'`),
 * or a Start trigger alone with `'none'`. Block ids are fresh, as stored block ids are global.
 */
function replyGraph(reply: 'enabled' | 'disabled' | 'none'): WorkflowState {
  const startId = generateId()
  const blocks: Record<string, BlockState> = { [startId]: block(startId, 'start_trigger', 'Start') }
  const edges: Edge[] = []
  if (reply !== 'none') {
    const replyId = generateId()
    blocks[replyId] = block(
      replyId,
      'response',
      'Reply',
      { dataMode: 'json', data: '{"mobile": "1"}' },
      reply === 'enabled'
    )
    edges.push(edge(startId, replyId))
  }
  return { blocks, edges, loops: {}, parallels: {} }
}

/**
 * A child graph whose condition "Gate" sends its `if` branch to a Response block and its else
 * branch to `elseTarget`: a second Response block, or a function that ends the run there.
 */
function gateGraph(elseTarget: 'response' | 'function'): WorkflowState {
  const startId = generateId()
  const gateId = generateId()
  const replyId = generateId()
  const otherId = generateId()
  const conditions = JSON.stringify([
    { id: `${gateId}-if`, title: 'if', value: 'true' },
    { id: `${gateId}-else`, title: 'else', value: '' },
  ])
  const blocks: Record<string, BlockState> = {
    [startId]: block(startId, 'start_trigger', 'Start'),
    [gateId]: block(gateId, 'condition', 'Gate', { conditions }),
    [replyId]: block(replyId, 'response', 'Reply', { dataMode: 'json', data: '{"mobile": "1"}' }),
    [otherId]:
      elseTarget === 'response'
        ? block(otherId, 'response', 'Other', { dataMode: 'json', data: '{"mobile": "2"}' })
        : block(otherId, 'function', 'Other', { code: "return { mobile: '2' }" }),
  }
  const edges = [
    edge(startId, gateId),
    edge(gateId, replyId, `condition-${gateId}-if`),
    edge(gateId, otherId, `condition-${gateId}-else`),
  ]
  return { blocks, edges, loops: {}, parallels: {} }
}

/**
 * Stores a child workflow with draft `graph` (a Start trigger alone by default) and, with
 * `deployed`, an active deployment of that graph (`true`) or of another one.
 */
async function seedChild(
  name: string,
  options: { graph?: WorkflowState; deployed?: boolean | WorkflowState; workspace?: string } = {}
): Promise<string> {
  const id = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id,
    userId: ownerId,
    workspaceId: options.workspace ?? workspaceId,
    name,
    isDeployed: Boolean(options.deployed),
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const graph = options.graph ?? replyGraph('none')
  const saved = await saveWorkflowToNormalizedTables(id, graph)
  if (!saved.success) throw new Error(`Seeding the child failed: ${saved.error}`)
  if (options.deployed) {
    await db.insert(workflowDeploymentVersion).values({
      id: generateId(),
      workflowId: id,
      version: 1,
      state: options.deployed === true ? graph : options.deployed,
      isActive: true,
    })
  }
  return id
}

/** A parent graph whose Workflow block "Call" runs `childId` and whose function reads `code`. */
function parent(childId: string, code: string) {
  return {
    blocks: {
      start: block('start', 'start_trigger', 'Start'),
      call: block('call', 'workflow_input', 'Call', { workflowId: childId }),
      use: block('use', 'function', 'Use', { code }),
    },
    edges: [
      { id: 'e1', source: 'start', target: 'call' },
      { id: 'e2', source: 'call', target: 'use' },
    ],
  }
}

function lint(graph: ReturnType<typeof parent>, deployed = false) {
  return buildWorkflowLintReport(
    graph,
    { workflowId: generateId(), workspaceId, subjectUserId: null },
    { deployed }
  )
}

/** The references a parent reading `<call.result.mobile>` from `childId` is told read nothing. */
async function childResultValues(childId: string, deployed = false) {
  const report = await lint(parent(childId, 'return <call.result.mobile>'), deployed)
  return report.unresolvedReferences
    .filter((ref) => ref.kind === 'child-result')
    .map((ref) => ref.value)
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Lint child fixture',
    email: `${ownerId}@lint-child.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  for (const id of [workspaceId, otherWorkspaceId]) {
    await insertWorkspaceFixture(db, {
      id,
      name: 'Lint child',
      ownerId,
      billedAccountUserId: ownerId,
    })
  }
})

afterAll(async () => {
  const reportPath =
    process.env.WORKFLOW_LINT_CHILD_REPORT_PATH ?? resolve('test-results/workflow-lint-child.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  await deleteWorkspaceFixture(db, inArray(workspace.id, [workspaceId, otherWorkspaceId]))
  await db.delete(user).where(eq(user.id, ownerId))
})

check(
  "a responding child's result.<key> is reported with result.data.<key> as the fix",
  async () => {
    const childId = await seedChild('Responder', { graph: replyGraph('enabled'), deployed: true })

    const report = await lint(
      parent(
        childId,
        'return [<call.result.mobile>, <call.result.data.mobile>, <call.result.status>]'
      )
    )

    const found = report.unresolvedReferences.filter((ref) => ref.kind === 'child-result')
    expect(found).toEqual([
      expect.objectContaining({
        blockId: 'use',
        field: 'code',
        value: ['<call.result.mobile>'],
        reason: expect.stringContaining('Did you mean <call.result.data.mobile>?'),
      }),
    ])
    expect(found[0]?.reason).toContain('Workflow "Responder" responds')
  }
)

check(
  'a child with no enabled Response block, or in another workspace, is not judged',
  async () => {
    const silent = await seedChild('Silent')
    const disabled = await seedChild('Disabled reply', { graph: replyGraph('disabled') })
    const foreign = await seedChild('Foreign', {
      graph: replyGraph('enabled'),
      workspace: otherWorkspaceId,
    })

    for (const childId of [silent, disabled, foreign]) {
      const report = await lint(parent(childId, 'return <call.result.mobile>'))
      expect(report.unresolvedReferences.filter((ref) => ref.kind === 'child-result')).toEqual([])
    }
  }
)

check('a deploy reports a called child that is not deployed; a draft write does not', async () => {
  const undeployed = await seedChild('Undeployed child')
  const deployed = await seedChild('Deployed child', { deployed: true })
  const childFindings = (report: Awaited<ReturnType<typeof lint>>) =>
    report.unresolvedReferences.filter((ref) => ref.field === 'workflowId')

  expect(childFindings(await lint(parent(undeployed, 'return 1'), true))).toEqual([
    expect.objectContaining({
      blockId: 'call',
      kind: 'resource',
      value: undeployed,
      reason: expect.stringContaining('Workflow "Undeployed child" is not deployed.'),
    }),
  ])
  expect(childFindings(await lint(parent(undeployed, 'return 1')))).toEqual([])
  expect(childFindings(await lint(parent(deployed, 'return 1'), true))).toEqual([])
})

check(
  'a child whose run can end outside a Response block is not judged; one that always responds is',
  async () => {
    const branchy = await seedChild('Branchy', { graph: gateGraph('function') })
    const covered = await seedChild('Covered', { graph: gateGraph('response') })
    expect(await childResultValues(branchy)).toEqual([])
    expect(await childResultValues(covered)).toEqual([['<call.result.mobile>']])
  }
)

check(
  "a deploy judges a child's result by its active deployment; a draft write by its draft",
  async () => {
    const respondsInDraft = await seedChild('Draft responder', {
      graph: replyGraph('enabled'),
      deployed: replyGraph('none'),
    })
    const respondsDeployed = await seedChild('Deployed responder', {
      graph: replyGraph('none'),
      deployed: replyGraph('enabled'),
    })
    expect(await childResultValues(respondsInDraft)).toEqual([['<call.result.mobile>']])
    expect(await childResultValues(respondsInDraft, true)).toEqual([])
    expect(await childResultValues(respondsDeployed)).toEqual([])
    expect(await childResultValues(respondsDeployed, true)).toEqual([['<call.result.mobile>']])
  }
)
