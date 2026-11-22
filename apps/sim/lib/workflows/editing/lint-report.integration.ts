/**
 * Real PostgreSQL coverage for the lint's child workflow checks: the children a Workflow block
 * calls are read from the workflow and block tables, and a graph is linted against them. A
 * responding child's `result.<key>` reads nothing unless `<key>` is a Response output, and a
 * deploy reports a called child with no deployment, which a deployed run cannot call.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import { user, workflow, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
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

/** Stores a child workflow whose only blocks are a Start and, when given, a Response block. */
async function seedChild(
  name: string,
  options: { response?: 'enabled' | 'disabled'; deployed?: boolean; workspace?: string } = {}
): Promise<string> {
  const id = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id,
    userId: ownerId,
    workspaceId: options.workspace ?? workspaceId,
    name,
    isDeployed: options.deployed ?? false,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const startId = generateId()
  const blocks: Record<string, BlockState> = { [startId]: block(startId, 'start_trigger', 'Start') }
  if (options.response) {
    const replyId = generateId()
    blocks[replyId] = block(
      replyId,
      'response',
      'Reply',
      { dataMode: 'json', data: '{"mobile": "1"}' },
      options.response === 'enabled'
    )
  }
  const state: WorkflowState = { blocks, edges: [], loops: {}, parallels: {} }
  const saved = await saveWorkflowToNormalizedTables(id, state)
  if (!saved.success) throw new Error(`Seeding the child failed: ${saved.error}`)
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
    const childId = await seedChild('Responder', { response: 'enabled', deployed: true })

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
    const disabled = await seedChild('Disabled reply', { response: 'disabled' })
    const foreign = await seedChild('Foreign', { response: 'enabled', workspace: otherWorkspaceId })

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
