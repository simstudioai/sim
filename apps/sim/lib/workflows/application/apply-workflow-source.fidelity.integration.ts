/**
 * Real PostgreSQL proof that the three forms of a workflow stay in lockstep through the use cases
 * every surface calls: the JSON API (`replaceWorkflowState`, the v2 `PUT /state`, and
 * `readWorkflowGraph`, its `GET`), the editing engine the canvas and `POST /operations` write
 * through (`applyWorkflowOperations`), and workflow source (`readWorkflowSource`,
 * `applyWorkflowSource`, `createWorkflowFromSource`).
 *
 * - A workflow written through the JSON API and then edited through the editing operations reads
 *   as source that applies back as a no-op: no row, `updated_at` or graph changes. One edit to
 *   that source then changes exactly the one stored field it names.
 * - Corpus workflows written through `PUT /state` each read as source that applies back unchanged.
 * - A workflow built by editing operations and the workflow created from its source read back the
 *   same through the JSON API, ids and layout aside.
 *
 * Runs against the migrated and the push-mode database alike; the report goes to
 * `WORKFLOW_SOURCE_FIDELITY_REPORT_PATH`.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import { auditLog, permissions, user, workflow, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { omit } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import { applyWorkflowOperations } from '@/lib/workflows/application/apply-workflow-operations'
import {
  applyWorkflowSource,
  createWorkflowFromSource,
} from '@/lib/workflows/application/apply-workflow-source'
import { readWorkflowGraph } from '@/lib/workflows/application/read-workflow-graph'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'
import { replaceWorkflowState } from '@/lib/workflows/application/replace-workflow-state'
import { DEFAULT_CORPUS_SEED } from '@/lib/workflows/code/corpus'
import { corpusSubjects } from '@/lib/workflows/code/corpus/fixtures.test-helpers'
import { findDifferences } from '@/lib/workflows/code/corpus/proof'
import { createSeededRandom } from '@/lib/workflows/code/corpus/random'
import type { EditWorkflowOperation } from '@/lib/workflows/editing/types'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

const ownerId = generateId()
const workspaceId = generateId()
const principal = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })

/** Corpus workflows written through `PUT /state`; a fixed sample, so the suite stays fast. */
const JSON_CORPUS_SAMPLE = 40

const checks: { name: string; status: string; durationMs: number; error?: string }[] = []
const stats = { jsonCorpusWritten: 0, jsonCorpusRefused: [] as string[] }

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
  }, 120_000)
}

const scoped = <T>(run: () => Promise<T>) => withPermissionGroupScope(run)

async function insertWorkflow(name: string): Promise<string> {
  const id = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id,
    userId: ownerId,
    workspaceId,
    name: `${name} ${id}`,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

function putState(workflowId: string, state: WorkflowState) {
  return scoped(() =>
    replaceWorkflowState.execute({
      principal,
      input: {
        workflowId,
        blocks: state.blocks,
        edges: state.edges,
        variables: state.variables ?? {},
      },
    })
  )
}

function applyOperations(
  workflowId: string,
  operations: EditWorkflowOperation[],
  blockEnabledChanges: Array<{ blockId: string; enabled: boolean }> = []
) {
  return scoped(() =>
    applyWorkflowOperations.execute({
      principal,
      input: { workflowId, operations, blockEnabledChanges, layout: 'none' },
    })
  )
}

function readGraph(workflowId: string) {
  return scoped(() => readWorkflowGraph.execute({ principal, input: { workflowId } }))
}

function getSource(workflowId: string) {
  return scoped(() => readWorkflowSource.execute({ principal, input: { workflowId } }))
}

type ReadSource = Awaited<ReturnType<typeof getSource>>

function applySource(source: ReadSource, files: Record<string, string>) {
  return scoped(() =>
    applyWorkflowSource.execute({
      principal,
      input: { workflowId: source.workflowId, files, lock: source.lock, base: source.base },
    })
  )
}

/** The stored row's `updated_at` and the graph the JSON API reads. */
async function snapshot(workflowId: string) {
  const [row] = await db
    .select({ updatedAt: workflow.updatedAt })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
  const graph = await readGraph(workflowId)
  return {
    updatedAt: row.updatedAt.getTime(),
    graph: {
      blocks: graph.blocks,
      // The loader reads edges in no particular order, and a save that updates rows in place
      // moves them in the heap, so they compare by id.
      edges: [...graph.edges].sort((a, b) => compareStrings(a.id, b.id)),
      loops: sortedNodes(graph.loops),
      parallels: sortedNodes(graph.parallels),
      variables: graph.variables,
    },
  }
}

/**
 * Subflow maps with `nodes` sorted. The loader derives `nodes` from the block rows, read with no
 * order, and Postgres moves an updated row, so any write (a canvas edit too) can reorder them; the
 * executor reads membership, not order.
 */
function sortedNodes<T extends { nodes: string[] }>(map: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(map).map(([id, entry]) => [
      id,
      { ...entry, nodes: [...entry.nodes].sort(compareStrings) },
    ])
  )
}

/** Replaces the one occurrence of `from` across the source files (function code may be its own file). */
function editEntry(files: Record<string, string>, from: string, to: string) {
  const hits = Object.entries(files).filter(([, text]) => text.split(from).length === 2)
  expect(hits, `exactly one file holds "${from}" once`).toHaveLength(1)
  const [path, text] = hits[0]
  return { ...files, [path]: text.replace(from, to) }
}

const START = generateId()
const WRITER = generateId()
const LOOP = generateId()
const CHILD = generateId()
const ROUTE = generateId()

function block(
  id: string,
  type: string,
  name: string,
  subBlocks: BlockState['subBlocks'] = {},
  data: BlockState['data'] = {}
): BlockState {
  return { id, type, name, position: { x: 0, y: 0 }, subBlocks, outputs: {}, enabled: true, data }
}

/** What a JSON API client writes: a start, a function, a loop with a child, and a condition. */
function jsonState(): WorkflowState {
  const variableId = generateId()
  return {
    blocks: {
      [START]: block(START, 'start_trigger', 'Start'),
      [WRITER]: block(WRITER, 'function', 'Writer', {
        code: { id: 'code', type: 'code', value: 'return { content: <start.input> }' },
      }),
      [LOOP]: block(
        LOOP,
        'loop',
        'Each Line',
        {},
        { loopType: 'forEach', collection: '<start.input>' }
      ),
      [CHILD]: block(
        CHILD,
        'function',
        'Shout',
        { code: { id: 'code', type: 'code', value: 'return <loop.currentItem>' } },
        { parentId: LOOP, extent: 'parent' }
      ),
      [ROUTE]: block(ROUTE, 'condition', 'Long Enough', {
        conditions: {
          id: 'conditions',
          type: 'condition-input',
          value: JSON.stringify([
            { id: `${ROUTE}-if`, title: 'if', value: '<writer.content>.length > 10' },
            { id: `${ROUTE}-else`, title: 'else', value: '' },
          ]),
        },
      }),
    },
    edges: [
      {
        id: generateId(),
        source: START,
        target: WRITER,
        sourceHandle: 'source',
        targetHandle: 'target',
      },
      {
        id: generateId(),
        source: WRITER,
        target: LOOP,
        sourceHandle: 'source',
        targetHandle: 'target',
      },
      {
        id: generateId(),
        source: LOOP,
        target: CHILD,
        sourceHandle: 'loop-start-source',
        targetHandle: 'target',
      },
      {
        id: generateId(),
        source: LOOP,
        target: ROUTE,
        sourceHandle: 'loop-end-source',
        targetHandle: 'target',
      },
    ],
    loops: {},
    parallels: {},
    variables: {
      [variableId]: { id: variableId, name: 'threshold', type: 'number', value: 10 },
    },
  }
}

beforeAll(async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Source fidelity fixture',
    email: `${ownerId}@source-fidelity.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Source fidelity',
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
  const reportPath =
    process.env.WORKFLOW_SOURCE_FIDELITY_REPORT_PATH ??
    resolve('test-results/workflow-source-fidelity.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks, stats }, null, 2))
  await db.delete(auditLog).where(eq(auditLog.workspaceId, workspaceId))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, ownerId))
})

check(
  'JSON write → canvas edits → source get → apply unchanged is a no-op, and one source edit changes one field',
  async () => {
    const workflowId = await insertWorkflow('Fidelity full stack')
    await putState(workflowId, jsonState())

    const added = generateId()
    const edited = await applyOperations(
      workflowId,
      [
        {
          operation_type: 'add',
          block_id: added,
          params: {
            type: 'function',
            name: 'Format Reply',
            inputs: { code: 'return <writer.content>' },
            connections: {},
          },
        },
        {
          operation_type: 'edit',
          block_id: ROUTE,
          params: { connections: { if: added } },
        },
        { operation_type: 'edit', block_id: WRITER, params: { name: 'Draft Writer' } },
        {
          operation_type: 'insert_into_subflow',
          block_id: generateId(),
          params: {
            subflowId: LOOP,
            type: 'function',
            name: 'Count Line',
            inputs: { code: 'return 1' },
          },
        },
        {
          operation_type: 'edit',
          block_id: CHILD,
          params: { inputs: { code: 'return String(<loop.currentItem>).toUpperCase()' } },
        },
      ],
      [{ blockId: ROUTE, enabled: false }]
    )
    expect(edited.skipped).toEqual([])
    expect(edited.applied).toBeGreaterThan(0)

    const source = await getSource(workflowId)
    expect(source.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const before = await snapshot(workflowId)

    const unchanged = await applySource(source, source.files)
    expect(unchanged.applied).toBe(false)
    expect(unchanged.diff.noop).toBe(true)
    expect(await snapshot(workflowId)).toEqual(before)

    const retyped = await applySource(source, editEntry(source.files, '.toUpperCase()', '.trim()'))
    expect(retyped.applied).toBe(true)
    const after = await snapshot(workflowId)
    const changed = findDifferences(before.graph, after.graph, 50).map((d) => d.path)
    expect(changed).toEqual([`/blocks/${CHILD}/subBlocks/code/value`])
    expect(after.graph.blocks[CHILD].subBlocks.code.value).toBe(
      'return String(<loop.currentItem>).trim()'
    )

    const reread = await getSource(workflowId)
    const again = await applySource(reread, reread.files)
    expect(again.diff.noop).toBe(true)
  }
)

check(
  'corpus workflows written through PUT /state each apply back from source unchanged',
  async () => {
    const rng = createSeededRandom(DEFAULT_CORPUS_SEED)
    const pool = corpusSubjects().filter((subject) => !subject.unknownTypes)
    const sample = Array.from({ length: JSON_CORPUS_SAMPLE }, () => rng.pick(pool))
    const failures: string[] = []
    for (const subject of sample) {
      const workflowId = await insertWorkflow('Fidelity corpus')
      const state = freshIds(subject.state)
      try {
        await putState(workflowId, state)
      } catch (error) {
        stats.jsonCorpusRefused.push(`${subject.id}: ${getErrorMessage(error)}`)
        continue
      }
      stats.jsonCorpusWritten += 1
      const source = await getSource(workflowId)
      const before = await snapshot(workflowId)
      let result: Awaited<ReturnType<typeof applySource>>
      try {
        result = await applySource(source, source.files)
      } catch (error) {
        failures.push(`${subject.id}: ${getErrorMessage(error)}`)
        continue
      }
      const after = await snapshot(workflowId)
      const differences = findDifferences(before, after, 3)
      if (result.applied || !result.diff.noop || differences.length > 0) {
        failures.push(`${subject.id}: ${JSON.stringify({ applied: result.applied, differences })}`)
      }
    }
    expect(failures).toEqual([])
    expect(stats.jsonCorpusWritten).toBeGreaterThan(JSON_CORPUS_SAMPLE / 2)
  }
)

check(
  'a stored loop start edge to a block outside the loop survives PUT /state, an engine edit and a source round trip',
  async () => {
    const workflowId = await insertWorkflow('Fidelity exit edge')
    const start = generateId()
    const loop = generateId()
    const body = generateId()
    const after = generateId()
    const fn = (id: string, name: string, data: BlockState['data'] = {}) =>
      block(id, 'function', name, { code: { id: 'code', type: 'code', value: 'return 1' } }, data)
    const exitEdge = { source: loop, target: after, sourceHandle: 'loop-start-source' }
    // What 1,4xx production workflows hold: the executor runs this edge as the loop's exit.
    await putState(workflowId, {
      blocks: {
        [start]: block(start, 'start_trigger', 'Start'),
        [loop]: block(loop, 'loop', 'Repeat', {}, { loopType: 'for', count: 2 }),
        [body]: fn(body, 'Body', { parentId: loop, extent: 'parent' }),
        [after]: fn(after, 'After'),
      },
      edges: [
        {
          id: generateId(),
          source: start,
          target: loop,
          sourceHandle: 'source',
          targetHandle: 'target',
        },
        {
          id: generateId(),
          source: loop,
          target: body,
          sourceHandle: 'loop-start-source',
          targetHandle: 'target',
        },
        { id: generateId(), ...exitEdge, targetHandle: 'target' },
      ],
      loops: {},
      parallels: {},
      variables: {},
    })
    const holdsExit = async () =>
      (await readGraph(workflowId)).edges.some(
        (edge) =>
          edge.source === exitEdge.source &&
          edge.target === exitEdge.target &&
          edge.sourceHandle === exitEdge.sourceHandle
      )
    expect(await holdsExit()).toBe(true)

    const edited = await applyOperations(workflowId, [
      { operation_type: 'edit', block_id: after, params: { inputs: { code: 'return 2' } } },
    ])
    expect(edited.skipped).toEqual([])
    expect(await holdsExit()).toBe(true)

    const source = await getSource(workflowId)
    expect(source.files['workflow.ts']).toContain("'loop-start-source'")
    const before = await snapshot(workflowId)
    const unchanged = await applySource(source, source.files)
    expect(unchanged.applied).toBe(false)
    expect(unchanged.diff.noop).toBe(true)
    expect(await snapshot(workflowId)).toEqual(before)
    expect(await holdsExit()).toBe(true)
  }
)

check(
  'a field the model hides, added in source, is reported as dropped and apply keeps the stored value',
  async () => {
    const workflowId = await insertWorkflow('Fidelity hidden field')
    const start = generateId()
    const agentId = generateId()
    await putState(workflowId, {
      blocks: {
        [start]: block(start, 'start_trigger', 'Start'),
        [agentId]: {
          ...block(agentId, 'agent', 'Answer', {
            model: { id: 'model', type: 'combobox', value: 'gpt-5.4' },
          }),
          advancedMode: true,
        },
      },
      edges: [
        {
          id: generateId(),
          source: start,
          target: agentId,
          sourceHandle: 'source',
          targetHandle: 'target',
        },
      ],
      loops: {},
      parallels: {},
      variables: {},
    })
    const source = await getSource(workflowId)
    expect(source.files['workflow.ts']).not.toContain('temperature')
    const before = await snapshot(workflowId)

    const result = await applySource(
      source,
      editEntry(source.files, "model: 'gpt-5.4' }", "model: 'gpt-5.4', temperature: 0.5 }")
    )
    const dropped = result.diagnostics.filter((d) => d.code === 'W_FIELD_NOT_APPLICABLE')
    expect(dropped.map((d) => d.message)).toEqual([
      'temperature is hidden (model gpt-5.4 does not use it), so it never runs: an apply does not save it over the stored value, and the source it writes back drops this line.',
    ])
    expect(result.diff.noop).toBe(true)
    expect(result.files['workflow.ts']).not.toContain('temperature')
    expect(await snapshot(workflowId)).toEqual(before)
  }
)

check(
  'a workflow built by editing operations and one created from its source read the same through the JSON API',
  async () => {
    const canvasId = await insertWorkflow('Fidelity canvas')
    const start = generateId()
    const fetcher = generateId()
    const loop = generateId()
    await applyOperations(canvasId, [
      { operation_type: 'add', block_id: start, params: { type: 'start_trigger', name: 'Start' } },
      {
        operation_type: 'add',
        block_id: fetcher,
        params: {
          type: 'api',
          name: 'Fetch Page',
          inputs: { url: 'https://example.com/<start.input>', method: 'GET' },
        },
      },
      {
        operation_type: 'add',
        block_id: loop,
        params: { type: 'loop', name: 'Retry', inputs: { loopType: 'for', iterations: 3 } },
      },
      {
        operation_type: 'insert_into_subflow',
        block_id: generateId(),
        params: {
          subflowId: loop,
          type: 'function',
          name: 'Attempt',
          inputs: { code: 'return 1' },
        },
      },
      { operation_type: 'edit', block_id: start, params: { connections: { source: fetcher } } },
      { operation_type: 'edit', block_id: fetcher, params: { connections: { source: loop } } },
    ])
    const source = await getSource(canvasId)
    const created = await scoped(() =>
      createWorkflowFromSource.execute({
        principal,
        input: { workspaceId, name: `Fidelity from source ${generateId()}`, files: source.files },
      })
    )
    expect(created.applied).toBe(true)

    const canvas = byName(await readGraph(canvasId))
    const fromSource = byName(await readGraph(created.workflowId))
    // The loop's `iterations`/`loopType` subBlocks the editing operations leave beside
    // `data.count` never run, so source does not carry them to the created workflow.
    const differences = findDifferences(canvas, fromSource, 20).map((d) => d.path)
    expect(differences.sort()).toEqual([
      '/blocks/Retry/subBlocks/iterations',
      '/blocks/Retry/subBlocks/loopType',
    ])
  }
)

check(
  'a loop the editing operations built prints no superseded subBlocks, and a no-op apply keeps them stored',
  async () => {
    const workflowId = await insertWorkflow('Fidelity operations loop')
    const start = generateId()
    const loop = generateId()
    await applyOperations(workflowId, [
      { operation_type: 'add', block_id: start, params: { type: 'start_trigger', name: 'Start' } },
      {
        operation_type: 'add',
        block_id: loop,
        params: { type: 'loop', name: 'Retry', inputs: { loopType: 'for', iterations: 3 } },
      },
      {
        operation_type: 'insert_into_subflow',
        block_id: generateId(),
        params: {
          subflowId: loop,
          type: 'function',
          name: 'Attempt',
          inputs: { code: 'return 1' },
        },
      },
      { operation_type: 'edit', block_id: start, params: { connections: { source: loop } } },
    ])
    const stored = (await readGraph(workflowId)).blocks[loop]
    expect(Object.keys(stored.subBlocks ?? {}).sort()).toEqual(['iterations', 'loopType'])
    expect(stored.data?.count).toBe(3)

    const source = await getSource(workflowId)
    expect(source.files['workflow.ts']).toContain("loop.for('Retry', { count: 3 }")
    expect(source.files['workflow.ts']).not.toContain('iterations')
    expect(source.files['workflow.ts']).not.toContain('extra')

    const before = await snapshot(workflowId)
    const unchanged = await applySource(source, source.files)
    expect(unchanged.diff.noop).toBe(true)
    expect(await snapshot(workflowId)).toEqual(before)

    const counted = await applySource(
      source,
      editEntry(source.files, '{ count: 3 }', '{ count: 5 }')
    )
    expect(counted.applied).toBe(true)
    const after = (await readGraph(workflowId)).blocks[loop]
    expect(after.data?.count).toBe(5)
    expect(after.subBlocks).toEqual(stored.subBlocks)
  }
)

/**
 * `state` with every block and edge id replaced, wherever it appears (a branch handle
 * `condition-<id>-if` follows its block). Block ids are global keys, so a corpus state written
 * twice needs fresh ones.
 */
function freshIds(state: WorkflowState): WorkflowState {
  const ids = [...Object.keys(state.blocks), ...state.edges.map((edge) => edge.id)]
  const mapping = new Map(ids.map((id) => [id, generateId()]))
  let text = JSON.stringify(state)
  for (const id of [...ids].sort((a, b) => b.length - a.length)) {
    text = text.split(id).join(mapping.get(id) ?? id)
  }
  return JSON.parse(text) as WorkflowState
}

/**
 * A graph keyed by block name with ids, layout and server-minted row ids taken out: what two
 * workflows holding the same definition share.
 */
function byName(graph: Awaited<ReturnType<typeof readGraph>>) {
  const nameOf = new Map(Object.values(graph.blocks).map((b) => [b.id, b.name]))
  const swapText = (text: string) =>
    text.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      (id) => nameOf.get(id) ?? 'id'
    )
  const swapIds = (value: unknown): unknown => {
    if (typeof value === 'string') return swapText(value)
    if (Array.isArray(value)) return value.map(swapIds)
    if (value === null || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.entries(value).map(([key, member]) => [swapText(key), swapIds(member)])
    )
  }
  const blocks: Record<string, unknown> = {}
  for (const b of Object.values(graph.blocks)) {
    const data = omit(b.data ?? {}, ['width', 'height'])
    blocks[b.name] = swapIds({ ...omit(b, ['id', 'position', 'height']), data })
  }
  const edges = graph.edges
    .map((e) =>
      [
        nameOf.get(e.source),
        swapIds(e.sourceHandle ?? 'source'),
        nameOf.get(e.target),
        e.targetHandle ?? 'target',
      ].join(' ')
    )
    .sort(compareStrings)
  return { blocks, edges, variables: swapIds(Object.values(graph.variables)) }
}
