/**
 * Dry runs against real PostgreSQL and Redis, through the manual run use cases and the v2 execute
 * route: a dry run writes no table row and sends no request, reports each write with the payload it
 * would have sent (credentials, run secrets and password fields masked before the request is built,
 * and a write whose request cannot be built once masked still answered) under the `test` trigger,
 * and keeps nothing else: no Agent memory (which its Agents still read), no workspace event, no run
 * count. An MCP write is authorized before it is answered, and its check leaves the server's health
 * as it found it. An allowed block writes for real while reads run for real; a child workflow's
 * writes, an Agent's included, stay stubbed; custom and Wait blocks are answered whole; code runs
 * (a Condition's expressions and a While loop's condition included) and its isolate `fetch` writes
 * are stubbed; a mocked block steers a branch; a failed dry run keeps its side effects and is the source only of
 * another dry run. A test run is never the source of a run that sends its writes (the v2 use case,
 * Copilot and the editor route alike) and is never resumed; a mock, a dry run's or a workflow
 * test's, is data that never controls the run, sets what it is billed or replaces a locked block; a
 * rerun record keeps only the ids of mocked blocks, while the log shows a mocked output redacted
 * like any other. Model calls are answered by a simulated Anthropic API.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { db } from '@sim/db'
import {
  agentMemoryTurn,
  apiKey,
  customBlock,
  customTools,
  folder,
  mcpServers,
  memory,
  organization,
  pausedExecutions,
  permissions,
  resumeQueue,
  user,
  userStats,
  userTableDefinitions,
  userTableRows,
  webhook,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
  workspaceEnvironment,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import {
  createDelegatedPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { toArray, toRecord } from '@sim/utils/object'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { BlockState, SubBlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { and, eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const { subscriberRuns, session, viewer } = vi.hoisted(() => {
  /** Custom blocks are a self-hosted opt-in, read when the config module loads. */
  process.env.CUSTOM_BLOCKS_ENABLED = 'true'
  /** Agents keep durable turn history (rich history and the memory retrieval tool). */
  process.env.AGENT_MEMORY_HISTORY = 'true'
  /** Code and HTTP blocks reach the suite's local server, which records what arrives. */
  process.env.EGRESS_ALLOWED_IP_RANGES = '127.0.0.1/32'
  return {
    subscriberRuns: { runIds: [] as string[] },
    /** The browser session the editor route sees; none unless a test signs in. */
    session: {
      current: null as null | {
        user: { id: string; name: string; email: string }
        session: { id: string }
      },
    },
    /** Whether the viewer's permission group hides execution data; off unless a test hides it. */
    viewer: { hidesTraceSpans: false },
  }
})

/** A permission group hiding `logs.trace_spans`, applied when a test sets `viewer.hidesTraceSpans`. */
vi.mock('@/lib/logs/projection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logs/projection')>()
  return {
    ...actual,
    resolveLogFieldProjection: async (
      ...args: Parameters<typeof actual.resolveLogFieldProjection>
    ) =>
      viewer.hidesTraceSpans
        ? { hideTraceSpans: true, hideCostInfo: false }
        : actual.resolveLogFieldProjection(...args),
  }
})

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getSession: async () => session.current,
}))

/** A Sim-trigger subscriber's run starts here; the suite records the run that raised it. */
vi.mock('@/lib/webhooks/processor', () => ({
  processPolledWebhookEvent: async (_webhook: unknown, _workflow: unknown, payload: unknown) => {
    const { runId } = payload as { runId?: unknown }
    subscriberRuns.runIds.push(typeof runId === 'string' ? runId : 'unknown')
    return { success: true }
  },
}))

import { hashApiKey } from '@/lib/api-key/crypto'
import { resolveBillingAttribution } from '@/lib/billing/core/attribution'
import { closeRedisConnection } from '@/lib/core/config/redis'
import type { OrchestrationError } from '@/lib/core/orchestration/types'
import { encryptSecret } from '@/lib/core/security/encryption'
import { materializeExecutionData } from '@/lib/logs/execution/trace-store'
import { AGENT_MEMORY_RETRIEVAL_TOOL_ID } from '@/lib/memory/retrieval-tool-types'
import { WorkflowTestSession } from '@/lib/workflow-tests/session'
import {
  type ExecuteManualWorkflowInput,
  executeManualWorkflowFromBlockOperation,
  executeManualWorkflowOperation,
} from '@/lib/workflows/application/execute-manual-workflow'
import { readWorkflowRun } from '@/lib/workflows/application/read-workflow-run'
import { resumeWorkflowRun } from '@/lib/workflows/application/resume-run'
import { runFromBlockFromCopilot } from '@/lib/workflows/application/run-workflow-from-copilot'
import type { ExecuteWorkflowServiceRun } from '@/lib/workflows/executor/execute-service'
import { getWorkflowExecutionLogStatus } from '@/lib/workflows/executor/execution-state'
import { POST as v2Execute } from '@/app/api/v2/workflows/[workflowId]/execute/route'
import { POST as editorExecute } from '@/app/api/workflows/[id]/execute/route'
import type { PausePoint } from '@/executor/types'

const ownerId = generateId()
const organizationId = generateId()
const workspaceId = generateId()
/** A second workspace of the same owner, whose workflows a dry run never names. */
const otherWorkspaceId = generateId()
const SECRET = `dry-secret-${generateId()}`
const UNREFERENCED_SECRET = `unreferenced-${generateId()}`
const SECRET_URL = `http://dry-run.invalid/hook/${generateId()}`
/** A secret whose variable name matches no credential pattern. */
const HOOK_PATH = `hook-path-${generateId()}`
const API_KEY = `sk-sim-fixture-${generateId()}`
const principal = createDelegatedPrincipal({
  subjectUserId: ownerId,
  workspaceId,
  audience: 'sim:workflows',
})
const workflowIds: string[] = []
const validationError = { code: 'validation' } satisfies Partial<OrchestrationError>

/** Block ids are global keys, so each block gets a fresh one; tests address blocks by name. */
function block(name: string, type: string, values: Record<string, unknown> = {}): BlockState {
  return {
    id: generateId(),
    type,
    name,
    position: { x: 0, y: 0 },
    enabled: true,
    outputs: {},
    subBlocks: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        { id: key, type: 'short-input', value: value as SubBlockState['value'] },
      ])
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

/** A Condition block routing to `<id>-if` when `expression` holds, else to `<id>-else`. */
function condition(name: string, expression: string): BlockState {
  const gate = block(name, 'condition')
  gate.subBlocks.conditions = {
    id: 'conditions',
    type: 'condition-input',
    value: JSON.stringify([
      { id: `${gate.id}-if`, title: 'if', value: expression },
      { id: `${gate.id}-else`, title: 'else', value: '' },
    ]),
  }
  return gate
}

/** Saves `state` as the draft of a new workflow, in the fixture workspace unless told otherwise. */
async function saveWorkflow(
  state: WorkflowState,
  name = `Dry run ${generateId()}`,
  inWorkspaceId = workspaceId
) {
  const id = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id,
    userId: ownerId,
    workspaceId: inWorkspaceId,
    name,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  workflowIds.push(id)
  const saved = await saveWorkflowToNormalizedTables(id, state)
  expect(saved.success, saved.error).toBe(true)
  return id
}

/** A fresh `leads` table, so no test reads another's rows. */
async function createTable(): Promise<string> {
  const tableId = generateId()
  await db.insert(userTableDefinitions).values({
    id: tableId,
    workspaceId,
    name: `leads_${tableId.replaceAll('-', '_')}`,
    createdBy: ownerId,
    schema: {
      columns: [
        { id: 'col_email', name: 'email', type: 'string', required: true, unique: true },
        { id: 'col_score', name: 'score', type: 'number' },
        { id: 'col_note', name: 'note', type: 'string' },
      ],
    },
  })
  return tableId
}

const upsertLead = (name: string, tableId: string, email: string) =>
  block(name, 'table', {
    operation: 'upsert_row',
    tableSelector: tableId,
    data: JSON.stringify({ email, score: 82 }),
  })

const queryLeads = (name: string, tableId: string) =>
  block(name, 'table', { operation: 'query_rows', tableSelector: tableId })

/** A POST to a host that never resolves: sent, it fails the run. Its URL and body hold a secret. */
const notify = (name: string) =>
  block(name, 'api', {
    url: 'http://dry-run.invalid/hook?key={{DRY_SECRET}}',
    method: 'POST',
    body: JSON.stringify({ email: 'a@b.co', note: 'key={{DRY_SECRET}}' }),
  })

/** Start → lookup (read) → save (table upsert) → notify (HTTP POST) → child (Workflow block). */
async function parentFixture() {
  const tableId = await createTable()
  const childId = await saveWorkflow(
    graph(
      [block('start', 'start_trigger'), upsertLead('childsave', tableId, 'child@b.co')],
      [['start', 'childsave']]
    ).state
  )
  const parent = graph(
    [
      block('start', 'start_trigger'),
      queryLeads('lookup', tableId),
      upsertLead('save', tableId, 'a@b.co'),
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
  return { tableId, childId, parent, parentId: await saveWorkflow(parent.state) }
}

/** A sync run's result once its terminal log is durable. */
async function settled(result: unknown, workflowId: string): Promise<ExecuteWorkflowServiceRun> {
  const run = result as ExecuteWorkflowServiceRun
  if (!run.ok || !('status' in run)) throw new Error(`Run did not settle: ${JSON.stringify(run)}`)
  const deadline = Date.now() + 10_000
  while ((await getWorkflowExecutionLogStatus(run.executionId, workflowId)) !== run.status) {
    if (Date.now() >= deadline) throw new Error('Run did not persist its terminal log')
    await sleep(25)
  }
  return run
}

async function run(
  workflowId: string,
  options: Partial<ExecuteManualWorkflowInput> = {}
): Promise<ExecuteWorkflowServiceRun> {
  const result = await executeManualWorkflowOperation.execute({
    principal,
    input: {
      workflowId,
      requestId: generateId(),
      executionId: generateId(),
      input: {},
      mode: 'sync',
      requestHeaders: new Headers(),
      sample: false,
      ...options,
    },
  })
  return settled(result, workflowId)
}

/** Each row of the table, as JSON. */
async function tableRows(tableId: string): Promise<string[]> {
  const rows = await db
    .select({ data: userTableRows.data })
    .from(userTableRows)
    .where(eq(userTableRows.tableId, tableId))
  return rows.map((row) => JSON.stringify(row.data))
}

async function logTriggers(workflowId: string): Promise<string[]> {
  const rows = await db
    .select({ trigger: workflowExecutionLogs.trigger })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.workflowId, workflowId))
  return rows.map((row) => row.trigger)
}

async function runCountOf(workflowId: string): Promise<number> {
  const [row] = await db
    .select({ runCount: workflow.runCount })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
  return row.runCount
}

/**
 * The simulated Anthropic API: the first `toolTurns` turns call the first tool offered, and each
 * request it answers is kept in `requests`.
 */
const model = { toolTurns: 0, requests: [] as Record<string, unknown>[] }

async function answerModel(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (url.hostname !== 'api.anthropic.com') {
    throw new Error(`Unexpected network destination in a dry run: ${url.hostname}`)
  }
  const body = (await request.json()) as Record<string, unknown>
  model.requests.push(body)
  const tools = Array.isArray(body.tools) ? (body.tools as Array<{ name: string }>) : []
  const callsTool = model.toolTurns > 0 && tools.length > 0
  if (callsTool) model.toolTurns--
  const toolUse = {
    type: 'tool_use',
    id: `toolu_${generateId().replaceAll('-', '')}`,
    name: tools[0]?.name,
    input: { message: 'tell the team' },
  }
  const stopReason = callsTool ? 'tool_use' : 'end_turn'
  const message = {
    id: `msg_${generateId()}`,
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: callsTool ? [toolUse] : [{ type: 'text', text: 'Done' }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  }
  if (!body.stream) return Response.json(message)
  const events = [
    { type: 'message_start', message: { ...message, content: [], stop_reason: null } },
    callsTool
      ? { type: 'content_block_start', index: 0, content_block: { ...toolUse, input: {} } }
      : { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    callsTool
      ? {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(toolUse.input) },
        }
      : { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done' } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 5 },
    },
    { type: 'message_stop' },
  ]
  return new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } }
  )
}

/** An Agent on the simulated Anthropic model. */
function agent(name: string, values: Record<string, unknown>): BlockState {
  return block(name, 'agent', {
    model: 'claude-haiku-4-5',
    apiKey: 'synthetic-anthropic-key',
    messages: [{ role: 'user', content: 'Notify the team' }],
    ...values,
  })
}

/** A dry run whose model calls its first tool on each of its first `toolTurns` turns. */
async function runWithModel(workflowId: string, toolTurns: number) {
  model.toolTurns = toolTurns
  vi.stubGlobal('fetch', answerModel)
  return run(workflowId, { dry: true })
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
  await db
    .insert(organization)
    .values({ id: organizationId, name: 'Dry run', slug: organizationId })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Dry run fixture',
    ownerId,
    billedAccountUserId: ownerId,
    organizationId,
  })
  await insertWorkspaceFixture(db, {
    id: otherWorkspaceId,
    name: 'Dry run other workspace',
    ownerId,
    billedAccountUserId: ownerId,
    organizationId,
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
    variables: {
      DRY_SECRET: (await encryptSecret(SECRET)).encrypted,
      UNREFERENCED_SECRET: (await encryptSecret(UNREFERENCED_SECRET)).encrypted,
      DRY_SECRET_URL: (await encryptSecret(SECRET_URL)).encrypted,
      HOOK_PATH: (await encryptSecret(HOOK_PATH)).encrypted,
    },
  })
  await db.insert(apiKey).values({
    id: generateId(),
    userId: ownerId,
    name: 'Dry run fixture',
    key: API_KEY,
    keyHash: hashApiKey(API_KEY),
    type: 'personal',
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  session.current = null
  viewer.hidesTraceSpans = false
})

afterAll(async () => {
  await db.delete(webhook).where(inArray(webhook.workflowId, workflowIds))
  await db
    .delete(workflowExecutionLogs)
    .where(inArray(workflowExecutionLogs.workflowId, workflowIds))
  await db
    .delete(workflowExecutionSnapshots)
    .where(inArray(workflowExecutionSnapshots.workflowId, workflowIds))
  await deleteWorkspaceFixture(db, inArray(workspace.id, [workspaceId, otherWorkspaceId]))
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(eq(user.id, ownerId))
  await closeRedisConnection()
  await db.$client.end()
})

describe('a dry run', () => {
  it('writes no row and sends no request, and reports each write it held back', async () => {
    const { tableId, childId, parentId } = await parentFixture()

    const result = await run(parentId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(await tableRows(tableId)).toEqual([])
    expect(await logTriggers(parentId)).toEqual(['test'])
    const stubbed = result.sideEffects?.stubbed ?? []
    expect(stubbed.map((entry) => [entry.workflowId, entry.block, entry.tool])).toEqual([
      [parentId, 'save', 'table_upsert_row'],
      [parentId, 'notify', 'http_request'],
      [childId, 'childsave', 'table_upsert_row'],
    ])
    expect(stubbed[0].request).toMatchObject({ tableId, data: { email: 'a@b.co', score: 82 } })
    expect(stubbed[1].request).toMatchObject({
      method: 'POST',
      url: expect.stringContaining('http://dry-run.invalid/hook?key='),
      body: { email: 'a@b.co' },
    })
    expect(JSON.stringify(stubbed[1].request)).not.toContain(SECRET)
    expect(stubbed[2].request).toMatchObject({ data: { email: 'child@b.co' } })
  })

  it('answers a table write with the row it would have written, its secrets masked', async () => {
    const tableId = await createTable()
    const workflowId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          block('save', 'table', {
            operation: 'upsert_row',
            tableSelector: tableId,
            data: JSON.stringify({
              email: 'a@b.co',
              score: 82,
              note: 'key={{DRY_SECRET}}',
              reset_token: 'a',
            }),
          }),
          notify('notify'),
          block('read', 'function', {
            language: 'javascript',
            code: 'return { id: <save.row.id>, score: <save.row.data.score>, email: <save.row.data.email>, note: <save.row.data.note>, notified: <notify.status> }',
          }),
        ],
        [
          ['start', 'save'],
          ['save', 'notify'],
          ['notify', 'read'],
        ]
      ).state
    )

    const result = await run(workflowId, { dry: true, selectedOutputs: ['read.result'] })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(await tableRows(tableId)).toEqual([])
    expect(result.blockOutputs?.['read.result']).toEqual({
      id: 'dry_run_row_1',
      score: 82,
      email: 'a@b.co',
      note: 'key={{DRY_SECRET}}',
      notified: 900_000_001,
    })
    expect(JSON.stringify(result)).not.toContain(SECRET)
    const [save, sent] = result.sideEffects?.stubbed ?? []
    const written = {
      email: 'a@b.co',
      score: 82,
      note: 'key={{DRY_SECRET}}',
      reset_token: '[REDACTED]',
    }
    expect(save.request).toMatchObject({ data: written })
    expect(save.returned).toEqual({
      success: true,
      row: {
        id: 'dry_run_row_1',
        data: written,
        position: 0,
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z',
      },
      operation: 'dry_run_operation_1',
      ignoredColumns: [],
      message: 'dry_run_message_1',
    })
    expect(sent).toMatchObject({ tool: 'http_request', returned: { status: 900_000_001 } })
  })

  it('masks a run secret wherever it appears, though a secret-named column holds part of it', async () => {
    const tableId = await createTable()
    const workflowId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          block('save', 'table', {
            operation: 'upsert_row',
            tableSelector: tableId,
            data: JSON.stringify({
              email: 'a@b.co',
              note: 'key={{DRY_SECRET}}',
              session_token: SECRET.slice(0, 16),
            }),
          }),
        ],
        [['start', 'save']]
      ).state
    )

    const result = await run(workflowId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    const written = { email: 'a@b.co', note: 'key={{DRY_SECRET}}', session_token: '[REDACTED]' }
    const [save] = result.sideEffects?.stubbed ?? []
    expect(save.request).toMatchObject({ data: written })
    expect(toRecord(save.returned.row).data).toEqual(written)
    expect(JSON.stringify(result)).not.toContain(SECRET.slice(16))
  })

  it('answers each write that declares it with the output its request determines', async () => {
    const tableId = await createTable()
    const workflowId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          block('add', 'table', {
            operation: 'insert_row',
            tableSelector: tableId,
            data: JSON.stringify({ email: 'a@b.co' }),
          }),
          block('batch', 'table', {
            operation: 'batch_insert_rows',
            tableSelector: tableId,
            rows: JSON.stringify([{ email: 'b@b.co' }, { email: 'c@d.co', score: 3 }]),
          }),
          block('edit', 'table', {
            operation: 'update_row',
            tableSelector: tableId,
            rowId: 'row_named',
            data: JSON.stringify({ score: 7 }),
          }),
          block('report', 'file_v4', {
            operation: 'file_write',
            fileName: 'report.txt',
            content: 'héllo',
          }),
        ],
        [
          ['start', 'add'],
          ['add', 'batch'],
          ['batch', 'edit'],
          ['edit', 'report'],
        ]
      ).state
    )

    const result = await run(workflowId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(await tableRows(tableId)).toEqual([])
    const placeholderRow = (id: string, data: Record<string, unknown>, position: number) => ({
      id,
      data,
      position,
      createdAt: '1970-01-01T00:00:00.000Z',
      updatedAt: '1970-01-01T00:00:00.000Z',
    })
    const returned = Object.fromEntries(
      (result.sideEffects?.stubbed ?? []).map((entry) => [entry.tool, entry.returned])
    )
    expect(returned).toEqual({
      table_insert_row: {
        success: true,
        row: { ...placeholderRow('dry_run_row_1', { email: 'a@b.co' }, 0), executions: {} },
        ignoredColumns: [],
        message: 'dry_run_message_1',
      },
      table_batch_insert_rows: {
        success: true,
        rows: [
          { ...placeholderRow('dry_run_row_1', { email: 'b@b.co' }, 0), executions: {} },
          { ...placeholderRow('dry_run_row_2', { email: 'c@d.co', score: 3 }, 1), executions: {} },
        ],
        insertedCount: 2,
        ignoredColumns: [],
        message: 'dry_run_message_1',
      },
      table_update_row: {
        success: true,
        row: placeholderRow('row_named', { score: 7 }, 0),
        ignoredColumns: [],
        message: 'dry_run_message_1',
      },
      file_write: {
        id: 'dry_run_id_1',
        name: 'report.txt',
        size: 6,
        url: 'dry_run_url_1',
        version: 900_000_002,
        revision: 'dry_run_revision_1',
      },
    })
  })

  it('answers a write with the sample alone when its output cannot be derived from the request', async () => {
    const tableId = await createTable()
    const workflowId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          block('batch', 'table', {
            operation: 'batch_insert_rows',
            tableSelector: tableId,
            rows: JSON.stringify({ email: 'a@b.co' }),
          }),
        ],
        [['start', 'batch']]
      ).state
    )

    const result = await run(workflowId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    const [batch] = result.sideEffects?.stubbed ?? []
    expect(batch.request).toMatchObject({ rows: { email: 'a@b.co' } })
    expect(batch.returned).toEqual({
      success: true,
      rows: [{ id: 'dry_run_id_1', name: 'dry_run_name_1', value: 'dry_run_value_1' }],
      insertedCount: 900_000_001,
      ignoredColumns: ['dry_run_ignored_columns_1'],
      message: 'dry_run_message_1',
    })
  })

  it('keeps nothing beyond its own log: no run count and no workspace event', async () => {
    const { parentId } = await parentFixture()
    const subscriber = await saveWorkflow(graph([block('start', 'start_trigger')], []).state)
    await db.update(workflow).set({ isDeployed: true }).where(eq(workflow.id, subscriber))
    await db.insert(webhook).values({
      id: generateId(),
      workflowId: subscriber,
      provider: 'sim',
      path: generateId(),
      providerConfig: { eventType: 'execution_success', workflowIds: [parentId] },
    })

    const dry = await run(parentId, { dry: true })
    const live = await run(parentId, { stopAfterBlockId: 'lookup' })

    const deadline = Date.now() + 10_000
    while (!subscriberRuns.runIds.includes(live.executionId)) {
      if (Date.now() >= deadline) throw new Error('The live run raised no event')
      await sleep(25)
    }
    expect(subscriberRuns.runIds).not.toContain(dry.executionId)
    expect(await runCountOf(parentId)).toBe(1)
  })

  it('sends an allowed block’s writes, keyed to the run’s own blocks, while reads run for real', async () => {
    const { tableId, parent, parentId } = await parentFixture()

    const allowed = await run(parentId, { dry: true, allow: ['save'] })

    expect(allowed.status, JSON.stringify(allowed.error)).toBe('completed')
    expect(await tableRows(tableId)).toEqual([expect.stringContaining('a@b.co')])
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
    expect(allowed.overrides).toEqual({ allow: [parent.idOf('save')], mocks: [] })

    const reread = await run(parentId, { dry: true, selectedOutputs: ['lookup.rows'] })
    expect(JSON.stringify(reread.blockOutputs?.['lookup.rows'])).toContain('a@b.co')
    await expect(run(parentId, { dry: true, allow: ['child'] })).rejects.toMatchObject(
      validationError
    )
  })

  it('records an Agent’s custom tool call by its arguments, never the run’s environment', async () => {
    const schema = {
      type: 'function',
      function: {
        name: 'notify_team',
        description: 'Tell the team',
        parameters: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
      },
    }
    const customToolId = generateId()
    await db.insert(customTools).values({
      id: customToolId,
      workspaceId,
      userId: ownerId,
      title: `Notify ${customToolId}`,
      schema,
      code: 'return { sent: true }',
    })
    const workflowId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          agent('assistant', {
            tools: [{ type: 'custom-tool', customToolId, usageControl: 'auto' }],
          }),
        ],
        [['start', 'assistant']]
      ).state
    )

    const result = await runWithModel(workflowId, 1)

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(result.sideEffects?.stubbed).toEqual([
      expect.objectContaining({
        block: 'assistant',
        request: { arguments: { message: 'tell the team' } },
      }),
    ])
    expect(JSON.stringify(result.sideEffects)).not.toContain(UNREFERENCED_SECRET)
  })

  it('keeps a write in a workflow an Agent calls stubbed, and writes no Agent memory', async () => {
    const tableId = await createTable()
    const conversationId = `conversation-${generateId()}`
    const childId = await saveWorkflow(
      graph(
        [block('start', 'start_trigger'), upsertLead('childsave', tableId, 'child@b.co')],
        [['start', 'childsave']]
      ).state
    )
    const workflowId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          agent('assistant', {
            memoryType: 'conversation',
            conversationId,
            tools: [{ type: 'workflow', params: { workflowId: childId }, usageControl: 'auto' }],
          }),
        ],
        [['start', 'assistant']]
      ).state
    )

    const result = await runWithModel(workflowId, 1)

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(await tableRows(tableId)).toEqual([])
    expect(result.sideEffects?.stubbed.map((entry) => [entry.workflowId, entry.block])).toEqual([
      [childId, 'childsave'],
    ])
    const memories = await db
      .select({ id: memory.id })
      .from(memory)
      .where(and(eq(memory.workspaceId, workspaceId), eq(memory.key, conversationId)))
    expect(memories).toEqual([])
  })

  it('gives an Agent its stored conversation and memory retrieval, writing nothing to it', async () => {
    const conversationId = `conversation-${generateId()}`
    const agentInConversation = (content: string) =>
      graph(
        [
          block('start', 'start_trigger'),
          agent('assistant', {
            memoryType: 'conversation',
            conversationId,
            messages: [{ role: 'user', content }],
          }),
        ],
        [['start', 'assistant']]
      ).state
    model.toolTurns = 0
    vi.stubGlobal('fetch', answerModel)
    const remembered = await run(
      await saveWorkflow(agentInConversation('Remember the word pelican'))
    )
    expect(remembered.status, JSON.stringify(remembered.error)).toBe('completed')
    const [stored] = await db
      .select({ id: memory.id })
      .from(memory)
      .where(and(eq(memory.workspaceId, workspaceId), eq(memory.key, conversationId)))
    const turnsOf = async () =>
      db
        .select({ id: agentMemoryTurn.id })
        .from(agentMemoryTurn)
        .where(eq(agentMemoryTurn.memoryId, stored.id))
    const turns = await turnsOf()
    expect(turns).toHaveLength(1)

    model.requests = []
    const recalled = await runWithModel(await saveWorkflow(agentInConversation('Which word?')), 0)

    expect(recalled.status, JSON.stringify(recalled.error)).toBe('completed')
    const [request] = model.requests
    expect(JSON.stringify(request.messages)).toContain('Remember the word pelican')
    expect(toArray<{ name?: unknown }>(request.tools).map((tool) => tool.name)).toContain(
      AGENT_MEMORY_RETRIEVAL_TOOL_ID
    )
    expect(await turnsOf()).toEqual(turns)
  })

  it('authorizes an MCP write before answering it, so an unusable one fails as it would live', async () => {
    const missingServer = generateId()
    const workflowId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          block('remove', 'mcp', {
            operation: 'run',
            serverSelector: missingServer,
            serverReference: missingServer,
            toolSelector: 'delete_file',
            toolReference: 'delete_file',
            arguments: { path: '/reports/q3.csv' },
          }),
        ],
        [['start', 'remove']]
      ).state
    )

    const result = await run(workflowId, { dry: true })

    expect(result.status).toBe('failed')
    expect(JSON.stringify(result.error)).toContain('not found')
    expect(result.sideEffects?.stubbed).toEqual([])
  })

  it('checks an MCP write without changing the server’s health, which live calls read', async () => {
    const serverId = generateId()
    await db.insert(mcpServers).values({
      id: serverId,
      workspaceId,
      createdBy: ownerId,
      name: 'Unreachable',
      transport: 'streamable-http',
      url: 'http://dry-run.invalid/mcp',
      connectionStatus: 'connected',
      statusConfig: { consecutiveFailures: 0 },
    })
    const serverHealth = () =>
      db
        .select({
          connectionStatus: mcpServers.connectionStatus,
          lastError: mcpServers.lastError,
          statusConfig: mcpServers.statusConfig,
        })
        .from(mcpServers)
        .where(eq(mcpServers.id, serverId))
    const healthBefore = await serverHealth()
    const workflowId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          block('remove', 'mcp', {
            operation: 'run',
            serverSelector: serverId,
            serverReference: serverId,
            toolSelector: 'delete_file',
            toolReference: 'delete_file',
            arguments: { path: '/reports/q3.csv' },
          }),
        ],
        [['start', 'remove']]
      ).state
    )

    const first = await run(workflowId, { dry: true })
    const second = await run(workflowId, { dry: true })

    expect(first.status).toBe('failed')
    expect(await serverHealth()).toEqual(healthBefore)
    expect(second.error).toEqual(first.error)
  })

  it('masks a run secret before building a write’s request, so no encoding carries it', async () => {
    const knowledgeBaseId = generateId()
    const workflowId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          block('archive', 'knowledge', {
            operation: 'create_document',
            knowledgeBaseSelector: knowledgeBaseId,
            manualKnowledgeBaseId: knowledgeBaseId,
            name: 'notes',
            content: 'The deploy key is {{DRY_SECRET}}',
          }),
        ],
        [['start', 'archive']]
      ).state
    )

    const result = await run(workflowId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    const [write] = result.sideEffects?.stubbed ?? []
    expect(write).toMatchObject({
      tool: 'knowledge_create_document',
      returned: {
        message: 'dry_run_message_1',
        data: {
          documentId: 'dry_run_document_id_1',
          documentName: 'notes.txt',
          type: 'dry_run_type_1',
        },
      },
    })
    const [document] = toArray<unknown>(toRecord(write.request).documents)
    const fileUrl = String(toRecord(document).fileUrl)
    const content = Buffer.from(fileUrl.slice(fileUrl.indexOf(',') + 1), 'base64').toString('utf8')
    expect(content).toContain('The deploy key is')
    expect(content).not.toContain(SECRET)
    expect(JSON.stringify(result.sideEffects)).not.toContain(SECRET)
  })

  it.each([
    ['a', `routing-${generateId()}`],
    ['a short', 'rk-7Q'],
  ])(
    'masks %s secret typed into a password field, whatever the field is called',
    async (_, routingKey) => {
      const workflowId = await saveWorkflow(
        graph(
          [
            block('start', 'start_trigger'),
            block('page', 'pagerduty', {
              operation: 'send_event',
              routingKey,
              eventAction: 'trigger',
              eventSummary: 'Disk full',
              eventSource: 'db-1',
              eventSeverity: 'critical',
            }),
          ],
          [['start', 'page']]
        ).state
      )

      const result = await run(workflowId, { dry: true })

      expect(result.status, JSON.stringify(result.error)).toBe('completed')
      expect(result.sideEffects?.stubbed).toEqual([
        expect.objectContaining({
          tool: 'pagerduty_send_event',
          request: expect.objectContaining({
            body: expect.objectContaining({ event_action: 'trigger', routing_key: '[REDACTED]' }),
          }),
        }),
      ])
      expect(JSON.stringify(result.sideEffects)).not.toContain(routingKey)
    }
  )

  it('answers a write whose request it cannot build once masked, so the run goes on', async () => {
    const workflowId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          block('hook', 'api', { url: '{{DRY_SECRET_URL}}', method: 'POST' }),
          notify('notify'),
        ],
        [
          ['start', 'hook'],
          ['hook', 'notify'],
        ]
      ).state
    )

    const result = await run(workflowId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(result.sideEffects?.stubbed).toEqual([
      expect.objectContaining({ block: 'hook', tool: 'http_request', request: null }),
      expect.objectContaining({ block: 'notify', tool: 'http_request' }),
    ])
    expect(JSON.stringify(result.sideEffects)).not.toContain(SECRET_URL)
  })

  it('answers custom and Wait blocks whole, without running the publisher’s workflow or pausing', async () => {
    const tableId = await createTable()
    const sourceId = await saveWorkflow(
      graph(
        [block('start', 'start_trigger'), upsertLead('publisher save', tableId, 's@b.co')],
        [['start', 'publisher save']]
      ).state
    )
    const customType = `custom_block_${generateId().replaceAll('-', '_')}`
    await db.insert(customBlock).values({
      id: generateId(),
      organizationId,
      workflowId: sourceId,
      type: customType,
      name: 'Publisher block',
    })
    const workflowId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          block('hold', 'wait', { timeValue: '1', timeUnit: 'seconds' }),
          block('published', customType),
          upsertLead('save', tableId, 'a@b.co'),
        ],
        [
          ['start', 'hold'],
          ['hold', 'published'],
          ['published', 'save'],
        ]
      ).state
    )

    const result = await run(workflowId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(result.sideEffects?.stubbed.map((entry) => [entry.block, entry.tool])).toEqual([
      ['hold', null],
      ['published', null],
      ['save', 'table_upsert_row'],
    ])
    expect(await logTriggers(sourceId)).toEqual([])
    const paused = await db
      .select({ id: pausedExecutions.id })
      .from(pausedExecutions)
      .where(eq(pausedExecutions.executionId, result.executionId))
    expect(paused).toEqual([])
    for (const allowed of ['hold', 'published']) {
      await expect(run(workflowId, { dry: true, allow: [allowed] })).rejects.toMatchObject(
        validationError
      )
    }
  })

  it('runs code for real, listing neither a Function block nor a Condition that sends nothing', async () => {
    const tableId = await createTable()
    const gate = condition('gate', '<score.result> > 50')
    const branching = graph(
      [
        block('start', 'start_trigger'),
        block('score', 'function', { language: 'javascript', code: 'return 41 + 41' }),
        gate,
        upsertLead('high', tableId, 'high@b.co'),
        upsertLead('low', tableId, 'low@b.co'),
      ],
      [
        ['start', 'score'],
        ['score', 'gate'],
        ['gate', 'high', `condition-${gate.id}-if`],
        ['gate', 'low', `condition-${gate.id}-else`],
      ]
    )
    const workflowId = await saveWorkflow(branching.state)

    const result = await run(workflowId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(result.sideEffects?.stubbed.map((entry) => entry.block)).toEqual(['high'])
    expect(result.sideEffects?.unchecked).toEqual([])
  })

  it('runs a While loop’s condition for real without listing it unchecked', async () => {
    const repeat = block('repeat', 'loop')
    repeat.data = { loopType: 'while', whileCondition: '<loop.index> < 3' }
    const tick = block('tick', 'function', { language: 'javascript', code: 'return 1' })
    tick.data = { parentId: repeat.id, extent: 'parent' }
    const looping = graph(
      [block('start', 'start_trigger'), repeat, tick],
      [
        ['start', 'repeat'],
        ['repeat', 'tick', 'loop-start-source'],
      ]
    )
    const workflowId = await saveWorkflow(looping.state)

    const result = await run(workflowId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(result.sideEffects?.unchecked).toEqual([])
  })

  it('takes the branch a mocked block steers it to, and refuses mocks outside a dry run', async () => {
    const tableId = await createTable()
    const gate = condition('gate', '<lookup.totalCount> > 50')
    const workflowId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          queryLeads('lookup', tableId),
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
      ).state
    )
    const mocks = { lookup: { rows: [], rowCount: 0, totalCount: 99 } }

    const unmocked = await run(workflowId, { dry: true })
    const mocked = await run(workflowId, { dry: true, mocks })

    expect(unmocked.sideEffects?.stubbed.map((entry) => entry.block)).toEqual(['small'])
    expect(mocked.status, JSON.stringify(mocked.error)).toBe('completed')
    expect(mocked.sideEffects?.stubbed.map((entry) => entry.block)).toEqual(['big'])
    await expect(run(workflowId, { mocks })).rejects.toMatchObject(validationError)
  })

  it('refuses what it cannot honour: allow outside a dry run, an unknown block, stream or detach', async () => {
    const { tableId, parentId } = await parentFixture()

    for (const options of [
      { allow: ['save'] },
      { dry: true, allow: ['nope'] },
      { dry: true, mode: 'stream' as const },
      { dry: true, mode: 'sync-result-stream' as const, detachable: true },
    ]) {
      await expect(run(parentId, options)).rejects.toMatchObject(validationError)
    }
    expect(await tableRows(tableId)).toEqual([])
  })

  it('keeps a failed run’s side effects, and is the source only of another dry run', async () => {
    const tableId = await createTable()
    const workflowId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          upsertLead('save', tableId, 'a@b.co'),
          queryLeads('broken', generateId()),
          upsertLead('after', tableId, 'after@b.co'),
        ],
        [
          ['start', 'save'],
          ['save', 'broken'],
          ['broken', 'after'],
        ]
      ).state
    )

    const failed = await run(workflowId, { dry: true })

    expect(failed.status).toBe('failed')
    expect(failed.sideEffects?.stubbed.map((entry) => entry.block)).toEqual(['save'])
    const fromBlock = async (options: { dry?: boolean }) =>
      settled(
        await executeManualWorkflowFromBlockOperation.execute({
          principal,
          input: {
            workflowId,
            requestId: generateId(),
            executionId: generateId(),
            mode: 'sync',
            requestHeaders: new Headers(),
            blockId: 'after',
            sourceRunId: failed.executionId,
            ...options,
          },
        }),
        workflowId
      )
    await expect(fromBlock({})).rejects.toMatchObject(validationError)
    const rerun = await fromBlock({ dry: true })
    expect(rerun.status, JSON.stringify(rerun.error)).toBe('completed')
    expect(await tableRows(tableId)).toEqual([])
  })

  it('stubs a workflow test’s unmocked writes and records them on the host, payloads dropped', async () => {
    const tableId = await createTable()
    const name = `Dry test ${generateId()}`
    const fixture = graph(
      [block('start', 'start_trigger'), upsertLead('save', tableId, 'a@b.co')],
      [['start', 'save']]
    )
    const workflowId = await saveWorkflow(fixture.state, name)
    const session = new WorkflowTestSession({
      workspaceId,
      principal,
      version: 'draft',
      only: null,
      onProgress: async () => {},
    })

    let event = await session.start({ workflow: name, trigger: null, input: {}, targets: [] })
    while (event.kind === 'waiting') event = await session.next(event.runId)

    if (event.kind !== 'done') throw new Error(`The run ended with ${event.kind}`)
    expect(await tableRows(tableId)).toEqual([])
    expect(session.sideEffects()).toEqual({
      executions: {
        [event.executionId]: {
          stubbed: [
            {
              workflowId,
              blockId: fixture.idOf('save'),
              block: 'save',
              tool: 'table_upsert_row',
              mcp: null,
              count: 1,
            },
          ],
          unchecked: [],
          omitted: { stubbed: 0, unchecked: 0 },
        },
      },
      omittedExecutions: 0,
    })
  })

  it('is forwarded by the v2 execute route, a block entry’s included', async () => {
    const { tableId, parentId } = await parentFixture()
    const execute = async (runSelection: Record<string, unknown>) => {
      const request = new NextRequest(
        `http://localhost:3000/api/v2/workflows/${parentId}/execute`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': API_KEY,
            'x-forwarded-for': '127.0.0.1',
          },
          body: JSON.stringify({ input: {}, run: runSelection }),
        }
      )
      const response = await v2Execute(request, {
        params: Promise.resolve({ workflowId: parentId }),
      })
      const body = (await response.json()) as {
        data: { runId: string; status: string; sideEffects?: { stubbed: unknown[] } }
      }
      expect(response.status, JSON.stringify(body)).toBe(200)
      return body.data
    }

    const first = await execute({ source: 'draft', dry: true })
    expect(first.status).toBe('completed')
    expect(first.sideEffects?.stubbed).toHaveLength(3)
    const rerun = await execute({
      source: 'draft',
      dry: true,
      entry: { type: 'block', blockId: 'save', sourceRunId: first.runId },
    })
    expect(rerun.status).toBe('completed')
    expect(rerun.sideEffects?.stubbed).toHaveLength(3)
    expect(await tableRows(tableId)).toEqual([])
  })
})

/** Start → save → after, two table writes, and a dry run of it, which wrote neither. */
async function dryRunSource() {
  const tableId = await createTable()
  const fixture = graph(
    [
      block('start', 'start_trigger'),
      upsertLead('save', tableId, 'a@b.co'),
      upsertLead('after', tableId, 'after@b.co'),
    ],
    [
      ['start', 'save'],
      ['save', 'after'],
    ]
  )
  const workflowId = await saveWorkflow(fixture.state)
  const dry = await run(workflowId, { dry: true })
  expect(dry.status, JSON.stringify(dry.error)).toBe('completed')
  return { tableId, workflowId, afterId: fixture.idOf('after'), dryRunId: dry.executionId }
}

/** Start → a Human in the loop block → a table write. */
async function approvalFixture() {
  const tableId = await createTable()
  const approval = block('approval', 'human_in_the_loop', {
    inputFormat: [{ id: 'approved', name: 'approved', type: 'boolean', required: true }],
  })
  approval.subBlocks.inputFormat.type = 'input-format'
  const name = `Approval ${generateId()}`
  const workflowId = await saveWorkflow(
    graph(
      [block('start', 'start_trigger'), approval, upsertLead('save', tableId, 'a@b.co')],
      [
        ['start', 'approval'],
        ['approval', 'save'],
      ]
    ).state,
    name
  )
  return { tableId, workflowId, name }
}

async function pausedExecutionsOf(workflowId: string) {
  return db
    .select({
      executionId: pausedExecutions.executionId,
      pausePoints: pausedExecutions.pausePoints,
    })
    .from(pausedExecutions)
    .where(eq(pausedExecutions.workflowId, workflowId))
}

/**
 * Tools of the MCP fixture: a read the server declares read-only, a write it declares nothing for,
 * and a call it declares read-only but destructive. Each declares the reply shape it sends.
 */
const MCP_TOOLS = [
  {
    name: 'read_file',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    outputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, size: { type: 'number' } },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'delete_file',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { deleted: { type: 'boolean' } } },
  },
  {
    name: 'purge_cache',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    annotations: { readOnlyHint: true, destructiveHint: true },
  },
]

/** The tool calls the MCP fixture received, in order. */
const mcpCalls: Array<{ name: string; arguments: unknown }> = []

/** A stateless Streamable HTTP MCP server listing {@link MCP_TOOLS}, answering every call. */
function mcpFixture(): Server {
  return createServer(async (request, response) => {
    const server = new McpServer(
      { name: 'dry-run-fixture', version: '1.0.0' },
      { capabilities: { tools: {} } }
    )
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_TOOLS }))
    server.setRequestHandler(CallToolRequestSchema, async (call) => {
      mcpCalls.push({ name: call.params.name, arguments: call.params.arguments })
      const reply = { path: String(call.params.arguments?.path), size: 12 }
      return { content: [{ type: 'text', text: JSON.stringify(reply) }], structuredContent: reply }
    })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    response.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(request, response)
  })
}

/** An MCP block running `tool` of `serverId` with `args`. */
function mcpCall(name: string, serverId: string, tool: string, args: Record<string, unknown>) {
  return block(name, 'mcp', {
    operation: 'run',
    serverSelector: serverId,
    serverReference: serverId,
    toolSelector: tool,
    toolReference: tool,
    arguments: args,
  })
}

describe('a dry run’s reads', () => {
  let fixture: Server
  let serverId = ''

  beforeAll(async () => {
    fixture = mcpFixture()
    const port = await new Promise<number>((resolve, reject) => {
      fixture.listen(0, '127.0.0.1', () => {
        const address = fixture.address()
        if (address === null || typeof address === 'string') reject(new Error('No port'))
        else resolve(address.port)
      })
    })
    serverId = generateId()
    await db.insert(mcpServers).values({
      id: serverId,
      workspaceId,
      createdBy: ownerId,
      name: 'Files',
      transport: 'streamable-http',
      url: `http://127.0.0.1:${port}/mcp`,
      connectionStatus: 'connected',
      statusConfig: { consecutiveFailures: 0 },
    })
  })

  afterEach(() => {
    mcpCalls.length = 0
  })

  afterAll(async () => {
    await new Promise((resolve) => fixture.close(resolve))
  })

  it('sends no MCP call, even one its server declares read-only, until its block is allowed', async () => {
    const { state, idOf } = graph(
      [
        block('start', 'start_trigger'),
        mcpCall('read', serverId, 'read_file', { path: '/reports/q3.csv' }),
        mcpCall('remove', serverId, 'delete_file', { path: '/reports/q3.csv' }),
        mcpCall('purge', serverId, 'purge_cache', { path: '/reports' }),
      ],
      [
        ['start', 'read'],
        ['read', 'remove'],
        ['remove', 'purge'],
      ]
    )
    const workflowId = await saveWorkflow(state)

    const result = await run(workflowId, {
      dry: true,
      selectedOutputs: ['read.structuredContent', 'remove.structuredContent'],
    })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(mcpCalls).toEqual([])
    const stubbed = result.sideEffects?.stubbed ?? []
    expect(stubbed.map((entry) => [entry.block, entry.mcp, entry.reason])).toEqual([
      ['read', { server: serverId, tool: 'read_file' }, 'mcp-read-only'],
      ['remove', { server: serverId, tool: 'delete_file' }, undefined],
      ['purge', { server: serverId, tool: 'purge_cache' }, undefined],
    ])
    expect(result.blockOutputs?.['read.structuredContent']).toEqual({
      path: 'dry_run_path_1',
      size: 900_000_001,
    })
    expect(result.blockOutputs?.['remove.structuredContent']).toEqual({ deleted: true })

    const allowed = await run(workflowId, {
      dry: true,
      allow: ['read'],
      selectedOutputs: ['read.structuredContent'],
    })
    expect(allowed.status, JSON.stringify(allowed.error)).toBe('completed')
    expect(mcpCalls).toEqual([{ name: 'read_file', arguments: { path: '/reports/q3.csv' } }])
    expect(allowed.blockOutputs?.['read.structuredContent']).toEqual({
      path: '/reports/q3.csv',
      size: 12,
    })
    expect(allowed.sideEffects?.allowed).toEqual([
      {
        workflowId,
        blockId: idOf('read'),
        block: 'read',
        tool: 'mcp_run_operation',
        mcp: { server: serverId, tool: 'read_file' },
      },
    ])
  })

  it('answers a read that would send a stubbed write’s placeholder id, through a chain of reads', async () => {
    const tableId = await createTable()
    const workflowId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          upsertLead('save', tableId, 'a@b.co'),
          block('fetch', 'table', {
            operation: 'get_row',
            tableSelector: tableId,
            rowId: '<save.row.id>',
          }),
          block('refetch', 'table', {
            operation: 'get_row',
            tableSelector: tableId,
            rowId: '<fetch.row.id>',
          }),
          mcpCall('read', serverId, 'read_file', { path: '/rows/file_<save.row.id>_copy.json' }),
          queryLeads('lookup', tableId),
        ],
        [
          ['start', 'save'],
          ['save', 'fetch'],
          ['fetch', 'refetch'],
          ['refetch', 'read'],
          ['read', 'lookup'],
        ]
      ).state
    )

    const result = await run(workflowId, { dry: true, selectedOutputs: ['lookup.totalCount'] })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(await tableRows(tableId)).toEqual([])
    expect(mcpCalls).toEqual([])
    const stubbed = result.sideEffects?.stubbed ?? []
    expect(stubbed.map((entry) => [entry.block, entry.tool, entry.reason])).toEqual([
      ['save', 'table_upsert_row', undefined],
      ['fetch', 'table_get_row', 'placeholder'],
      ['refetch', 'table_get_row', 'placeholder'],
      ['read', 'mcp_run_operation', 'placeholder'],
    ])
    expect(stubbed[1].request).toMatchObject({ rowId: 'dry_run_row_1' })
    expect(result.blockOutputs?.['lookup.totalCount']).toBe(0)

    const live = await run(workflowId, { selectedOutputs: ['refetch.row'] })
    expect(live.status, JSON.stringify(live.error)).toBe('completed')
    expect(live.sideEffects).toBeUndefined()
    expect(JSON.stringify(live.blockOutputs?.['refetch.row'])).toContain('a@b.co')
    expect(mcpCalls.map((call) => call.name)).toEqual(['read_file'])
  })

  it('answers a read by the number a stubbed create would have assigned', async () => {
    const github = (name: string, values: Record<string, unknown>) =>
      block(name, 'github', {
        owner: 'octo',
        repo: 'tracker',
        apiKey: 'ghp_dry_run_fixture',
        ...values,
      })
    const workflowId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          github('file', { operation: 'github_create_issue', title: 'Broken build' }),
          github('reread', {
            operation: 'github_get_issue',
            issue_number: '<file.metadata.number>',
          }),
        ],
        [
          ['start', 'file'],
          ['file', 'reread'],
        ]
      ).state
    )

    const result = await run(workflowId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    const stubbed = result.sideEffects?.stubbed ?? []
    expect(stubbed.map((entry) => [entry.block, entry.tool, entry.reason])).toEqual([
      ['file', 'github_create_issue', undefined],
      ['reread', 'github_get_issue', 'placeholder'],
    ])
    expect(JSON.stringify(stubbed[1].request)).toMatch(/\/issues\/9000000\d\d/)
  })

  it('sends a read of a row a stubbed write was given, which exists', async () => {
    const tableId = await createTable()
    const seeded = await run(
      await saveWorkflow(
        graph(
          [block('start', 'start_trigger'), upsertLead('seed', tableId, 'a@b.co')],
          [['start', 'seed']]
        ).state
      )
    )
    expect(seeded.status, JSON.stringify(seeded.error)).toBe('completed')
    const [row] = await db
      .select({ id: userTableRows.id })
      .from(userTableRows)
      .where(eq(userTableRows.tableId, tableId))
    const workflowId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          block('rescore', 'table', {
            operation: 'update_row',
            tableSelector: tableId,
            rowId: row.id,
            data: JSON.stringify({ score: 99 }),
          }),
          block('fetch', 'table', {
            operation: 'get_row',
            tableSelector: tableId,
            rowId: '<rescore.row.id>',
          }),
        ],
        [
          ['start', 'rescore'],
          ['rescore', 'fetch'],
        ]
      ).state
    )

    const result = await run(workflowId, { dry: true, selectedOutputs: ['fetch.row'] })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(result.sideEffects?.stubbed.map((entry) => entry.block)).toEqual(['rescore'])
    expect(result.blockOutputs?.['fetch.row']).toMatchObject({
      id: row.id,
      data: { email: 'a@b.co', score: 82 },
    })
  })
})

describe('a test run', () => {
  it('is not the source of a Copilot run from a block, named or as the latest run', async () => {
    const { tableId, workflowId, afterId, dryRunId } = await dryRunSource()
    const billingAttribution = await resolveBillingAttribution({
      actorUserId: ownerId,
      workspaceId,
    })
    const fromBlock = (sourceExecutionId?: string) =>
      runFromBlockFromCopilot.execute({
        principal,
        input: {
          workflowId,
          useDraftState: true,
          lifecycle: { billingAttribution },
          blockId: afterId,
          ...(sourceExecutionId ? { sourceExecutionId } : {}),
        },
      })

    await expect(fromBlock(dryRunId)).rejects.toMatchObject(validationError)
    await expect(fromBlock()).rejects.toMatchObject({ code: 'not_found' })
    expect(await tableRows(tableId)).toEqual([])
  })

  it('is not the source of an editor run from a block, named or as the latest run', async () => {
    const { tableId, workflowId, afterId, dryRunId } = await dryRunSource()
    session.current = {
      user: { id: ownerId, name: 'Dry run fixture', email: `${ownerId}@dry-run.test` },
      session: { id: generateId() },
    }
    const fromBlock = async (executionId: string) => {
      const response = await editorExecute(
        new NextRequest(`http://localhost:3000/api/workflows/${workflowId}/execute`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: 'session=fixture' },
          body: JSON.stringify({
            input: {},
            useDraftState: true,
            runFromBlock: { startBlockId: afterId, executionId },
          }),
        }),
        { params: Promise.resolve({ id: workflowId }) }
      )
      return { status: response.status, body: await response.json() }
    }

    expect(await fromBlock(dryRunId)).toMatchObject({
      status: 400,
      body: { error: expect.stringContaining('is a test run') },
    })
    expect(await fromBlock('latest')).toMatchObject({
      status: 400,
      body: { error: expect.stringContaining('No execution state found for workflow') },
    })
    expect(await tableRows(tableId)).toEqual([])
  })

  it('is never resumed, so a pause in one sends nothing after it', async () => {
    const { tableId, workflowId } = await approvalFixture()
    const paused = (await executeManualWorkflowOperation.execute({
      principal,
      input: {
        workflowId,
        requestId: generateId(),
        executionId: generateId(),
        input: {},
        mode: 'sync',
        requestHeaders: new Headers(),
        sample: false,
      },
    })) as ExecuteWorkflowServiceRun
    expect(paused.status, JSON.stringify(paused.error)).toBe('paused')
    const contextId = paused.paused?.points[0]?.contextId
    if (!contextId) throw new Error('The run named no pause point')
    await vi.waitFor(
      async () => {
        const [row] = await pausedExecutionsOf(workflowId)
        const point = (row?.pausePoints as Record<string, PausePoint> | null)?.[contextId]
        if (!point?.snapshotReady) throw new Error('Pause not yet resumable')
      },
      { timeout: 20_000, interval: 100 }
    )
    // A test run never pauses, so relabel this paused manual run as one to prove resume refuses it.
    await db
      .update(workflowExecutionLogs)
      .set({ trigger: 'test' })
      .where(eq(workflowExecutionLogs.executionId, paused.executionId))
    const pausedStatus = async () => {
      const [row] = await db
        .select({ status: pausedExecutions.status })
        .from(pausedExecutions)
        .where(eq(pausedExecutions.executionId, paused.executionId))
      return row?.status
    }
    const statusBefore = await pausedStatus()
    expect(statusBefore).toBe('paused')

    await expect(
      resumeWorkflowRun.execute({
        principal: createSessionPrincipal({ userId: ownerId, sessionId: generateId() }),
        input: {
          workflowId,
          runId: paused.executionId,
          contextId,
          resumeInput: { approved: true },
          surface: 'v2',
        },
      })
    ).rejects.toThrow('is never resumed')
    expect(await pausedStatus()).toBe(statusBefore)
    expect(await tableRows(tableId)).toEqual([])
  })

  it('answers a Human in the loop block in a workflow test, which never pauses', async () => {
    const { tableId, workflowId, name } = await approvalFixture()
    const testSession = new WorkflowTestSession({
      workspaceId,
      principal,
      version: 'draft',
      only: null,
      onProgress: async () => {},
    })

    let event = await testSession.start({ workflow: name, trigger: null, input: {}, targets: [] })
    while (event.kind === 'waiting') event = await testSession.next(event.runId)

    expect(event).toMatchObject({ kind: 'done' })
    expect(await pausedExecutionsOf(workflowId)).toEqual([])
    expect(await tableRows(tableId)).toEqual([])
  })
})

describe('a dry run’s mocks', () => {
  it('cannot set a field that controls the run, such as a pause', async () => {
    const { parentId } = await parentFixture()
    const pause = {
      contextId: 'mocked',
      pauseKind: 'time',
      resumeAt: new Date().toISOString(),
      blockId: 'lookup',
    }

    await expect(
      run(parentId, { dry: true, mocks: { lookup: { rows: [], _pauseMetadata: pause } } })
    ).rejects.toMatchObject({
      ...validationError,
      message: expect.stringContaining('sets _pauseMetadata'),
    })
    expect(await pausedExecutionsOf(parentId)).toEqual([])
  })

  it('cannot set what the run is billed, beside a real model call', async () => {
    const tableId = await createTable()
    const workflowId = await saveWorkflow(
      graph(
        [block('start', 'start_trigger'), queryLeads('lookup', tableId), agent('assistant', {})],
        [
          ['start', 'lookup'],
          ['lookup', 'assistant'],
        ]
      ).state
    )
    model.toolTurns = 0
    vi.stubGlobal('fetch', answerModel)
    const billed = { cost: { input: 0, output: 0, total: -5 }, model: 'claude-haiku-4-5' }

    await expect(
      run(workflowId, { dry: true, mocks: { lookup: { rows: [], ...billed } } })
    ).rejects.toMatchObject({
      ...validationError,
      message: expect.stringContaining('sets cost, model'),
    })
    expect(await logTriggers(workflowId)).toEqual([])

    const dataOnly = await run(workflowId, { dry: true, mocks: { lookup: { rows: [] } } })
    expect(dataOnly.status, JSON.stringify(dataOnly.error)).toBe('completed')
    const [log] = await db
      .select({ modelsUsed: workflowExecutionLogs.modelsUsed })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, dataOnly.executionId))
    expect(log.modelsUsed).toEqual(['claude-haiku-4-5'])
  })

  it('in a workflow test cannot set a field that controls the run or what it is billed', async () => {
    const tableId = await createTable()
    const name = `Mocked test ${generateId()}`
    const workflowId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          queryLeads('lookup', tableId),
          upsertLead('save', tableId, 'a@b.co'),
        ],
        [
          ['start', 'lookup'],
          ['lookup', 'save'],
        ]
      ).state,
      name
    )
    const answerLookup = async (output: Record<string, unknown>) => {
      const testSession = new WorkflowTestSession({
        workspaceId,
        principal,
        version: 'draft',
        only: null,
        onProgress: async () => {},
      })
      let event = await testSession.start({
        workflow: name,
        trigger: null,
        input: {},
        targets: [{ key: 'lookup', kind: 'mock', workflow: null, block: 'lookup' }],
      })
      while (event.kind === 'waiting') event = await testSession.next(event.runId)
      if (event.kind !== 'mock') throw new Error(`The lookup mock was not asked: ${event.kind}`)
      event = await testSession.reply(event.runId, event.callId, { output })
      while (event.kind === 'waiting') event = await testSession.next(event.runId)
      return event
    }
    const pause = {
      contextId: 'mocked',
      pauseKind: 'time',
      resumeAt: new Date().toISOString(),
      blockId: 'lookup',
    }

    expect(
      await answerLookup({
        rows: [],
        _pauseMetadata: pause,
        cost: { input: 0, output: 0, total: -5 },
      })
    ).toMatchObject({ kind: 'done', error: expect.stringContaining('sets _pauseMetadata, cost') })
    expect(await pausedExecutionsOf(workflowId)).toEqual([])

    const dataOnly = await answerLookup({ rows: [], rowCount: 0, totalCount: 0 })
    expect(dataOnly).toMatchObject({ kind: 'done' })
    expect(dataOnly).not.toHaveProperty('error')
    expect(await tableRows(tableId)).toEqual([])
  })

  it('cannot hold a large-value reference, which would read a value the run was never granted', async () => {
    const { parentId } = await parentFixture()
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_abcdefghijkl',
      kind: 'array',
      size: 1,
    }

    await expect(
      run(parentId, { dry: true, mocks: { lookup: { rows: [], page: { rows: ref } } } })
    ).rejects.toMatchObject({
      ...validationError,
      message: expect.stringContaining('holds a large-value reference'),
    })
    expect(await logTriggers(parentId)).toEqual([])
  })

  it('cannot replace a locked block', async () => {
    const tableId = await createTable()
    const lookup = queryLeads('lookup', tableId)
    lookup.locked = true
    const workflowId = await saveWorkflow(
      graph(
        [block('start', 'start_trigger'), lookup, notify('notify')],
        [
          ['start', 'lookup'],
          ['lookup', 'notify'],
        ]
      ).state
    )

    await expect(
      run(workflowId, { dry: true, mocks: { lookup: { rows: [], totalCount: 99 } } })
    ).rejects.toMatchObject({
      ...validationError,
      message: expect.stringContaining('locked block'),
    })
    expect(await logTriggers(workflowId)).toEqual([])
  })

  it('are recorded for a rerun only as block ids, while the log shows the output redacted', async () => {
    const tableId = await createTable()
    const secret = `mock-secret-${generateId()}`
    const fixture = graph(
      [
        block('start', 'start_trigger'),
        queryLeads('lookup', tableId),
        upsertLead('save', tableId, 'a@b.co'),
        queryLeads('broken', generateId()),
      ],
      [
        ['start', 'lookup'],
        ['lookup', 'save'],
        ['save', 'broken'],
      ]
    )
    const workflowId = await saveWorkflow(fixture.state)
    const recorded = { allow: [fixture.idOf('save')], mocks: [fixture.idOf('lookup')] }

    const mockKey = `mock-key-${generateId()}`
    const failed = await run(workflowId, {
      dry: true,
      allow: ['save'],
      mocks: { lookup: { rows: [], rowCount: 0, totalCount: 0, note: secret, apiKey: mockKey } },
    })

    expect(failed.status).toBe('failed')
    expect(failed.overrides).toEqual(recorded)
    const [row] = await db
      .select({ executionData: workflowExecutionLogs.executionData })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, failed.executionId))
    const executionData = await materializeExecutionData(
      row.executionData as Record<string, unknown>,
      { workspaceId, workflowId, executionId: failed.executionId }
    )
    const trigger = executionData.trigger as { data?: { overrides?: unknown } }
    expect(trigger.data?.overrides).toEqual(recorded)
    /** The log shows the mocked block's output, which `save` consumed, redacted like any other. */
    const traceSpans = JSON.stringify(executionData.traceSpans)
    expect(traceSpans).toContain(secret)
    expect(traceSpans).not.toContain(mockKey)
    const read = await readWorkflowRun.execute({
      principal,
      input: { workflowId, runId: failed.executionId, includeOutput: false, selectedOutputs: [] },
    })
    expect(read.overrides).toEqual(recorded)
    expect(JSON.stringify(read)).not.toContain(secret)
  })
})

/** A local server that records each request that reaches it, and answers each with `{ ok: true }`. */
const server = {
  instance: null as Server | null,
  url: '',
  arrivals: [] as Array<{ method: string; path: string }>,
}

/** What reached the local server under `path`'s prefix, as `METHOD /path`. */
function arrivalsUnder(prefix: string): string[] {
  return server.arrivals
    .filter((arrival) => arrival.path.startsWith(prefix))
    .map((arrival) => `${arrival.method} ${arrival.path}`)
}

/** A workflow of one Function block named `code` running `source`. */
async function codeWorkflow(source: string) {
  const fixture = graph(
    [
      block('start', 'start_trigger'),
      block('code', 'function', { language: 'javascript', code: source }),
    ],
    [['start', 'code']]
  )
  return { workflowId: await saveWorkflow(fixture.state), idOf: fixture.idOf }
}

describe('a dry run’s code network', () => {
  beforeAll(async () => {
    const instance = createServer((request, response) => {
      request.resume()
      server.arrivals.push({ method: request.method ?? '', path: request.url ?? '' })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
    })
    await new Promise<void>((resolve) => instance.listen(0, '127.0.0.1', resolve))
    server.instance = instance
    server.url = `http://127.0.0.1:${(instance.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    const instance = server.instance
    if (instance) await new Promise<void>((resolve) => instance.close(() => resolve()))
  })

  it('never sends a POST a Function block makes, and records it without its query values or secrets', async () => {
    const prefix = `/${generateId()}`
    const { workflowId, idOf } = await codeWorkflow(
      `const res = await fetch('${server.url}${prefix}/hook?key={{DRY_SECRET}}&page=2', { method: 'POST', headers: { authorization: 'Bearer {{DRY_SECRET}}' }, body: JSON.stringify({ note: 'key={{DRY_SECRET}}' }) })
return { status: res.status, body: await res.json(), stubbed: res.headers.get('x-sim-dry-run') }`
    )

    const result = await run(workflowId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(arrivalsUnder(prefix)).toEqual([])
    expect(result.output).toMatchObject({ result: { status: 200, body: {}, stubbed: 'stubbed' } })
    expect(result.sideEffects?.stubbed).toEqual([
      expect.objectContaining({
        blockId: idOf('code'),
        block: 'code',
        tool: 'function_execute',
        request: {
          method: 'POST',
          url: `${server.url}${prefix}/hook?key&page`,
          headers: ['authorization'],
          body: { note: 'key=[REDACTED]' },
        },
        returned: { status: 200, body: {} },
      }),
    ])
    expect(result.sideEffects?.unchecked).toEqual([])
    expect(JSON.stringify(result.sideEffects)).not.toContain(SECRET)
  })

  it('masks a secret the code compiles in from a variable no credential pattern names', async () => {
    const prefix = `/${generateId()}`
    const { workflowId } = await codeWorkflow(
      `const res = await fetch('${server.url}${prefix}/{{HOOK_PATH}}', { method: 'POST', body: JSON.stringify({ ref: '{{HOOK_PATH}}' }) })
return res.status`
    )

    const result = await run(workflowId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(arrivalsUnder(prefix)).toEqual([])
    expect(result.sideEffects?.stubbed).toHaveLength(1)
    expect(JSON.stringify(result.sideEffects)).not.toContain(HOOK_PATH)
  })

  it('stubs a GET that carries a method-override header, recording only the header’s name', async () => {
    const prefix = `/${generateId()}`
    const { workflowId } = await codeWorkflow(
      `const res = await fetch('${server.url}${prefix}', { headers: { 'X-HTTP-Method-Override': 'DELETE' } })
return res.status`
    )

    const result = await run(workflowId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(arrivalsUnder(prefix)).toEqual([])
    expect(result.sideEffects?.stubbed.map((entry) => entry.request)).toEqual([
      { method: 'GET', url: `${server.url}${prefix}`, headers: ['X-HTTP-Method-Override'] },
    ])
  })

  it('fails a write the egress policy refuses, as a live run would, and records nothing', async () => {
    const { workflowId } = await codeWorkflow(
      `try {
  await fetch('https://10.255.255.1/hook', { method: 'POST' })
  return 'answered'
} catch (error) {
  return error.message
}`
    )

    const result = await run(workflowId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(result.output).toMatchObject({
      result: expect.stringContaining('fetchUrl resolves to a private or reserved address'),
    })
    expect(result.sideEffects?.stubbed).toEqual([])
  })

  it('stubs a write a While loop’s condition makes, recorded under the loop', async () => {
    const prefix = `/${generateId()}`
    const repeat = block('repeat', 'loop')
    repeat.data = {
      loopType: 'while',
      whileCondition: `(await fetch('${server.url}${prefix}', { method: 'POST' })).status === 500`,
    }
    const tick = block('tick', 'function', { language: 'javascript', code: 'return 1' })
    tick.data = { parentId: repeat.id, extent: 'parent' }
    const looping = graph(
      [block('start', 'start_trigger'), repeat, tick],
      [
        ['start', 'repeat'],
        ['repeat', 'tick', 'loop-start-source'],
      ]
    )
    const workflowId = await saveWorkflow(looping.state)

    const result = await run(workflowId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(arrivalsUnder(prefix)).toEqual([])
    expect(result.sideEffects?.stubbed.map((entry) => [entry.block, entry.tool])).toEqual([
      ['repeat', 'function_execute'],
    ])
  })

  it('stubs a write whose method is written in lowercase', async () => {
    const prefix = `/${generateId()}`
    const { workflowId } = await codeWorkflow(
      `const res = await fetch('${server.url}${prefix}', { method: 'post' })
return res.status`
    )

    const result = await run(workflowId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(arrivalsUnder(prefix)).toEqual([])
    expect(result.sideEffects?.stubbed.map((entry) => toRecord(entry.request).method)).toEqual([
      'POST',
    ])
  })

  it('sends a request whose method is not a string, as the GET it is sent as', async () => {
    const prefix = `/${generateId()}`
    const { workflowId } = await codeWorkflow(
      `const res = await fetch('${server.url}${prefix}', { method: 1 })
return await res.json()`
    )

    const result = await run(workflowId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(arrivalsUnder(prefix)).toEqual([`GET ${prefix}`])
    expect(result.sideEffects?.stubbed).toEqual([])
  })

  it('stubs a write the code never awaits, and sends the read it awaits after it', async () => {
    const prefix = `/${generateId()}`
    const { workflowId } = await codeWorkflow(
      `fetch('${server.url}${prefix}/write', { method: 'PUT', body: 'x' })
const res = await fetch('${server.url}${prefix}/read')
return await res.json()`
    )

    const result = await run(workflowId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(arrivalsUnder(prefix)).toEqual([`GET ${prefix}/read`])
    expect(result.sideEffects?.stubbed.map((entry) => toRecord(entry.request).url)).toEqual([
      `${server.url}${prefix}/write`,
    ])
  })

  it('sends every request of an allowed block, recording it allowed once', async () => {
    const prefix = `/${generateId()}`
    const { workflowId, idOf } = await codeWorkflow(
      `await fetch('${server.url}${prefix}/a', { method: 'POST' })
await fetch('${server.url}${prefix}/b', { method: 'DELETE' })
return 1`
    )

    const result = await run(workflowId, { dry: true, allow: ['code'] })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(arrivalsUnder(prefix)).toEqual([`POST ${prefix}/a`, `DELETE ${prefix}/b`])
    expect(result.sideEffects?.allowed).toEqual([
      expect.objectContaining({ blockId: idOf('code'), tool: 'function_execute' }),
    ])
    expect(result.sideEffects?.stubbed).toEqual([])
  })

  it('records an allowed block that only reads as nothing allowed', async () => {
    const prefix = `/${generateId()}`
    const { workflowId } = await codeWorkflow(
      `const res = await fetch('${server.url}${prefix}')
return await res.json()`
    )

    const result = await run(workflowId, { dry: true, allow: ['code'] })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(arrivalsUnder(prefix)).toEqual([`GET ${prefix}`])
    expect(result.sideEffects?.allowed).toEqual([])
  })

  it('tells a Function block that failed on its stubbed writes how to send them', async () => {
    const prefix = `/${generateId()}`
    const { workflowId } = await codeWorkflow(
      `const res = await fetch('${server.url}${prefix}', { method: 'POST' })
const created = await res.json()
return created.id.toString()`
    )

    const result = await run(workflowId, { dry: true })

    expect(result.status).toBe('failed')
    expect(JSON.stringify(result.error)).toContain(
      "1 network write this code made got an empty stubbed response; --allow 'code' sends them"
    )
  })

  it('sends an API block’s GET, while its POST and a GET overriding its method stay stubbed', async () => {
    const prefix = `/${generateId()}`
    const fixture = graph(
      [
        block('start', 'start_trigger'),
        block('read', 'api', { url: `${server.url}${prefix}/read`, method: 'GET' }),
        block('write', 'api', { url: `${server.url}${prefix}/write`, method: 'POST' }),
        block('override', 'api', {
          url: `${server.url}${prefix}/override`,
          method: 'GET',
          headers: [{ cells: { Key: 'X-HTTP-Method-Override', Value: 'PATCH' } }],
        }),
      ],
      [
        ['start', 'read'],
        ['read', 'write'],
        ['write', 'override'],
      ]
    )
    const workflowId = await saveWorkflow(fixture.state)

    const result = await run(workflowId, { dry: true })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(arrivalsUnder(prefix)).toEqual([`GET ${prefix}/read`])
    expect(result.sideEffects?.stubbed.map((entry) => [entry.block, entry.tool])).toEqual([
      ['write', 'http_request'],
      ['override', 'http_request'],
    ])
  })

  it('sends no GET that would carry a stubbed write’s placeholder id, from code or an API block', async () => {
    const prefix = `/${generateId()}`
    const tableId = await createTable()
    const fixture = graph(
      [
        block('start', 'start_trigger'),
        upsertLead('save', tableId, 'a@b.co'),
        block('code', 'function', {
          language: 'javascript',
          code: `const res = await fetch('${server.url}${prefix}/code/' + <save.row.id>)
return { status: res.status, stubbed: res.headers.get('x-sim-dry-run') }`,
        }),
        block('header', 'function', {
          language: 'javascript',
          code: `const res = await fetch('${server.url}${prefix}/header', { headers: { 'X-Record-Id': <save.row.id> } })
return res.headers.get('x-sim-dry-run')`,
        }),
        block('fetch', 'api', { url: `${server.url}${prefix}/api/<save.row.id>`, method: 'GET' }),
        block('real', 'api', { url: `${server.url}${prefix}/api/row_8f3a2c`, method: 'GET' }),
      ],
      [
        ['start', 'save'],
        ['save', 'code'],
        ['code', 'header'],
        ['header', 'fetch'],
        ['fetch', 'real'],
      ]
    )
    const workflowId = await saveWorkflow(fixture.state)

    const result = await run(workflowId, {
      dry: true,
      selectedOutputs: ['code.result', 'header.result'],
    })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(arrivalsUnder(prefix)).toEqual([`GET ${prefix}/api/row_8f3a2c`])
    expect(result.blockOutputs?.['code.result']).toEqual({ status: 200, stubbed: 'stubbed' })
    expect(result.blockOutputs?.['header.result']).toBe('stubbed')
    expect(
      result.sideEffects?.stubbed.map((entry) => [entry.block, entry.tool, entry.reason])
    ).toEqual([
      ['save', 'table_upsert_row', undefined],
      ['code', 'function_execute', 'placeholder'],
      ['header', 'function_execute', 'placeholder'],
      ['fetch', 'http_request', 'placeholder'],
    ])
  })

  it('is the source of a mock only for a block that ran: a sent GET replays, a read that would carry a placeholder does not', async () => {
    const prefix = `/${generateId()}`
    const tableId = await createTable()
    const fixture = graph(
      [
        block('start', 'start_trigger'),
        upsertLead('save', tableId, 'a@b.co'),
        block('code', 'function', {
          language: 'javascript',
          code: `const res = await fetch('${server.url}${prefix}/code/' + <save.row.id>)
return { status: res.status }`,
        }),
        block('real', 'api', { url: `${server.url}${prefix}/api/row_8f3a2c`, method: 'GET' }),
      ],
      [
        ['start', 'save'],
        ['save', 'code'],
        ['code', 'real'],
      ]
    )
    const workflowId = await saveWorkflow(fixture.state)
    const source = await run(workflowId, { dry: true })
    expect(source.status, JSON.stringify(source.error)).toBe('completed')
    expect(arrivalsUnder(prefix)).toEqual([`GET ${prefix}/api/row_8f3a2c`])

    const replayed = await run(workflowId, {
      dry: true,
      mocksFrom: { runId: source.executionId, blocks: ['real'] },
    })
    expect(replayed.status, JSON.stringify(replayed.error)).toBe('completed')
    expect(arrivalsUnder(prefix)).toEqual([`GET ${prefix}/api/row_8f3a2c`])
    await expect(
      run(workflowId, { dry: true, mocksFrom: { runId: source.executionId, blocks: ['code'] } })
    ).rejects.toMatchObject({
      ...validationError,
      message: expect.stringContaining('with a placeholder'),
    })
  })
})

/** Start → a Workflow block calling `childId`. */
function callerOf(childId: string) {
  return graph(
    [block('start', 'start_trigger'), block('call', 'workflow', { workflowId: childId })],
    [['start', 'call']]
  ).state
}

/** Start → lookup (read) → save, a table write whose note holds `lookup`'s total count. */
function lookupThenSave(tableId: string, email: string) {
  return graph(
    [
      block('start', 'start_trigger'),
      queryLeads('lookup', tableId),
      block('save', 'table', {
        operation: 'upsert_row',
        tableSelector: tableId,
        data: JSON.stringify({ email, note: 'count <lookup.totalCount>' }),
      }),
    ],
    [
      ['start', 'lookup'],
      ['lookup', 'save'],
    ]
  )
}

describe('a dry run’s overrides of a child workflow', () => {
  it('sends a child block’s writes when named <workflow>.<block>, by name or id, and records it', async () => {
    const tableId = await createTable()
    const childName = `Child ${generateId()}`
    const child = lookupThenSave(tableId, 'child@b.co')
    const childId = await saveWorkflow(child.state, childName)
    const parentId = await saveWorkflow(callerOf(childId))

    const byName = await run(parentId, { dry: true, allow: [`${childName}.save`] })

    expect(byName.status, JSON.stringify(byName.error)).toBe('completed')
    expect(await tableRows(tableId)).toEqual([expect.stringContaining('child@b.co')])
    expect(byName.sideEffects?.allowed).toEqual([
      {
        workflowId: childId,
        blockId: child.idOf('save'),
        block: 'save',
        tool: 'table_upsert_row',
      },
    ])
    expect(byName.sideEffects?.unreached).toBeUndefined()
    const recorded = { allow: [`${childId}.${child.idOf('save')}`], mocks: [] }
    expect(byName.overrides).toEqual(recorded)

    const byId = await run(parentId, {
      dry: true,
      allow: [`${childId}.${child.idOf('save')}`],
    })
    expect(byId.sideEffects?.allowed.map((entry) => entry.blockId)).toEqual([child.idOf('save')])
    expect(byId.overrides).toEqual(recorded)

    const doubleDot = await run(parentId, { dry: true, allow: [`${childName}..save`] })
    expect(doubleDot.overrides).toEqual(recorded)
  })

  it('answers a grandchild’s block with a mock, at whatever depth it runs', async () => {
    const tableId = await createTable()
    const grandchildName = `Grandchild ${generateId()}`
    const grandchild = lookupThenSave(tableId, 'grand@b.co')
    const grandchildId = await saveWorkflow(grandchild.state, grandchildName)
    const childId = await saveWorkflow(callerOf(grandchildId))
    const parentId = await saveWorkflow(callerOf(childId))

    const result = await run(parentId, {
      dry: true,
      mocks: { [`${grandchildName}.lookup`]: { rows: [], rowCount: 0, totalCount: 99 } },
    })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    const [save] = result.sideEffects?.stubbed ?? []
    expect(save).toMatchObject({ workflowId: grandchildId, block: 'save' })
    expect(save.request).toMatchObject({ data: { email: 'grand@b.co', note: 'count 99' } })
    expect(result.overrides).toEqual({
      allow: [],
      mocks: [`${grandchildId}.${grandchild.idOf('lookup')}`],
    })
    expect(await tableRows(tableId)).toEqual([])
  })

  it('cannot replace a child’s locked block, or any block of a locked child workflow', async () => {
    const tableId = await createTable()
    const lockedBlock = lookupThenSave(tableId, 'a@b.co')
    lockedBlock.state.blocks[lockedBlock.idOf('lookup')].locked = true
    const childId = await saveWorkflow(lockedBlock.state)
    const lockedWorkflowId = await saveWorkflow(lookupThenSave(tableId, 'b@b.co').state)
    await db.update(workflow).set({ locked: true }).where(eq(workflow.id, lockedWorkflowId))
    const parentId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          block('first', 'workflow', { workflowId: childId }),
          block('second', 'workflow', { workflowId: lockedWorkflowId }),
        ],
        [
          ['start', 'first'],
          ['first', 'second'],
        ]
      ).state
    )
    const mock = { rows: [], rowCount: 0, totalCount: 99 }

    await expect(
      run(parentId, { dry: true, mocks: { [`${childId}.lookup`]: mock } })
    ).rejects.toMatchObject({
      ...validationError,
      message: expect.stringContaining('locked block'),
    })
    await expect(
      run(parentId, { dry: true, mocks: { [`${lockedWorkflowId}.lookup`]: mock } })
    ).rejects.toMatchObject({
      code: 'locked',
      message: expect.stringContaining('Workflow is locked'),
    })
    expect(await logTriggers(parentId)).toEqual([])
  })

  it('never names a workflow of another workspace, saying no more than of one that does not exist', async () => {
    const tableId = await createTable()
    const elsewhere = lookupThenSave(tableId, 'x@b.co')
    const elsewhereId = await saveWorkflow(
      elsewhere.state,
      `Elsewhere ${generateId()}`,
      otherWorkspaceId
    )
    const parentId = await saveWorkflow(callerOf(elsewhereId))
    const missingId = generateId()

    const refusal = async (selector: string) =>
      run(parentId, { dry: true, allow: [selector] }).then(
        () => 'ran',
        (error: OrchestrationError) => {
          expect(error.code).toBe('validation')
          return error.message.replace(selector, '<selector>')
        }
      )

    const otherWorkspace = await refusal(`${elsewhereId}.save`)
    expect(otherWorkspace).toEqual(await refusal(`${missingId}.save`))
    expect(otherWorkspace).not.toContain(elsewhereId)
    expect(await tableRows(tableId)).toEqual([])
  })

  it('refuses a block that never runs as itself: a loop, a parallel, a disabled block', async () => {
    const tableId = await createTable()
    const repeat = block('repeat', 'loop')
    repeat.data = { loopType: 'for', count: 2 }
    const fanOut = block('fanout', 'parallel')
    fanOut.data = { parallelType: 'count', count: 2 }
    const off = upsertLead('off', tableId, 'a@b.co')
    off.enabled = false
    const outer = block('outer', 'loop')
    outer.data = { loopType: 'for', count: 2 }
    outer.enabled = false
    const inner = block('inner', 'loop')
    inner.data = { loopType: 'for', count: 2, parentId: outer.id, extent: 'parent' }
    const deep = upsertLead('deep', tableId, 'd@b.co')
    deep.data = { parentId: inner.id, extent: 'parent' }
    const workflowId = await saveWorkflow(
      graph(
        [block('start', 'start_trigger'), repeat, fanOut, off, outer, inner, deep],
        [['start', 'repeat']]
      ).state
    )

    for (const selector of ['repeat', 'fanout']) {
      await expect(run(workflowId, { dry: true, allow: [selector] })).rejects.toMatchObject({
        ...validationError,
        message: expect.stringContaining('is a loop or parallel'),
      })
      await expect(
        run(workflowId, { dry: true, mocks: { [selector]: { results: [] } } })
      ).rejects.toMatchObject({
        ...validationError,
        message: expect.stringContaining('is a loop or parallel'),
      })
    }
    for (const selector of ['off', 'deep']) {
      await expect(run(workflowId, { dry: true, allow: [selector] })).rejects.toMatchObject({
        ...validationError,
        message: expect.stringContaining('is disabled'),
      })
    }
    expect(await logTriggers(workflowId)).toEqual([])
  })

  it('reports allowed and mocked blocks the run never reached, and mock fields a block does not declare', async () => {
    const tableId = await createTable()
    const gate = condition('gate', 'false')
    const fixture = graph(
      [
        block('start', 'start_trigger'),
        queryLeads('lookup', tableId),
        gate,
        upsertLead('save', tableId, 'a@b.co'),
        queryLeads('recheck', tableId),
      ],
      [
        ['start', 'lookup'],
        ['lookup', 'gate'],
        ['gate', 'save', `condition-${gate.id}-if`],
        ['gate', 'recheck', `condition-${gate.id}-if`],
      ]
    )
    const workflowId = await saveWorkflow(fixture.state)

    const result = await run(workflowId, {
      dry: true,
      allow: ['save'],
      mocks: {
        lookup: { rows: [], totalCuont: 3 },
        recheck: { rows: [], totalCount: 0 },
      },
    })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(result.sideEffects?.unreached).toEqual([
      { workflowId, blockId: fixture.idOf('save'), block: 'save', kind: 'allow' },
      { workflowId, blockId: fixture.idOf('recheck'), block: 'recheck', kind: 'mock' },
    ])
    expect(result.sideEffects?.mockFields).toEqual([
      { workflowId, blockId: fixture.idOf('lookup'), block: 'lookup', undeclared: ['totalCuont'] },
    ])
  })
})

describe('a dry run’s mocks from an earlier run', () => {
  it('answers a block with the output it recorded, without what only its handler sets', async () => {
    const fixture = graph(
      [block('start', 'start_trigger'), agent('assistant', {})],
      [['start', 'assistant']]
    )
    const workflowId = await saveWorkflow(fixture.state)
    const source = await runWithModel(workflowId, 0)
    expect(source.status, JSON.stringify(source.error)).toBe('completed')
    model.requests = []

    const replayed = await run(workflowId, {
      dry: true,
      mocksFrom: { runId: source.executionId, blocks: ['assistant'] },
      selectedOutputs: ['assistant'],
    })

    expect(replayed.status, JSON.stringify(replayed.error)).toBe('completed')
    expect(model.requests).toEqual([])
    const output = toRecord(replayed.blockOutputs?.assistant)
    expect(output.content).toBe('Done')
    for (const field of ['cost', 'tokens', 'model', 'providerTiming']) {
      expect(output).not.toHaveProperty(field)
    }
    expect(replayed.overrides).toEqual({
      allow: [],
      mocks: [],
      mocksFrom: { runId: source.executionId, blocks: [fixture.idOf('assistant')] },
    })
    expect(replayed.sideEffects?.unreached).toBeUndefined()
    expect(replayed.sideEffects?.mockFields).toEqual([
      {
        workflowId,
        blockId: fixture.idOf('assistant'),
        block: 'assistant',
        dropped: expect.arrayContaining(['model', 'tokens', 'cost']),
      },
    ])
  })

  it('refuses a block the earlier run did not execute, and a run that is not this workflow’s', async () => {
    const tableId = await createTable()
    const gate = condition('gate', 'false')
    const workflowId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          queryLeads('lookup', tableId),
          gate,
          upsertLead('save', tableId, 'a@b.co'),
        ],
        [
          ['start', 'lookup'],
          ['lookup', 'gate'],
          ['gate', 'save', `condition-${gate.id}-if`],
        ]
      ).state
    )
    const source = await run(workflowId, { dry: true })
    expect(source.status, JSON.stringify(source.error)).toBe('completed')
    const otherRun = await run(await saveWorkflow(lookupThenSave(tableId, 'b@b.co').state), {
      dry: true,
    })

    await expect(
      run(workflowId, { dry: true, mocksFrom: { runId: source.executionId, blocks: ['save'] } })
    ).rejects.toMatchObject({ ...validationError, message: expect.stringContaining('did not run') })
    await expect(
      run(workflowId, { dry: true, mocksFrom: { runId: otherRun.executionId, blocks: ['lookup'] } })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      run(workflowId, { mocksFrom: { runId: source.executionId, blocks: ['lookup'] } })
    ).rejects.toMatchObject({
      ...validationError,
      message: expect.stringContaining('requires run.dry'),
    })
  })

  it('cannot be named twice, by a mock and by the earlier run', async () => {
    const tableId = await createTable()
    const workflowId = await saveWorkflow(lookupThenSave(tableId, 'a@b.co').state)
    const source = await run(workflowId, { dry: true })

    await expect(
      run(workflowId, {
        dry: true,
        mocks: { lookup: { rows: [] } },
        mocksFrom: { runId: source.executionId, blocks: ['Lookup'] },
      })
    ).rejects.toMatchObject({
      ...validationError,
      message: expect.stringContaining('run.mocks "lookup" and run.mocksFrom.blocks "Lookup"'),
    })
  })
})

/** POSTs a run to the v2 execute route as the fixture API key, answering its status and body. */
async function postRun(workflowId: string, runSelection: Record<string, unknown>) {
  const response = await v2Execute(
    new NextRequest(`http://localhost:3000/api/v2/workflows/${workflowId}/execute`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'x-forwarded-for': '127.0.0.1',
      },
      body: JSON.stringify({ input: {}, run: runSelection }),
    }),
    { params: Promise.resolve({ workflowId }) }
  )
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

describe('a dry run’s block selectors', () => {
  it('read a dotted selector as <workflow>.<block> unless a block of this workflow is named so exactly', async () => {
    const tableId = await createTable()
    const childName = `Slack ${generateId()}`
    const child = graph(
      [block('start', 'start_trigger'), upsertLead('Send', tableId, 'child@b.co')],
      [['start', 'Send']]
    )
    const childId = await saveWorkflow(child.state, childName)
    const parent = graph(
      [
        block('start', 'start_trigger'),
        upsertLead(`${childName} Send`, tableId, 'parent@b.co'),
        block('call', 'workflow', { workflowId: childId }),
      ],
      [
        ['start', `${childName} Send`],
        [`${childName} Send`, 'call'],
      ]
    )
    const parentId = await saveWorkflow(parent.state)

    const result = await run(parentId, { dry: true, allow: [`${childName}.Send`] })

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(result.sideEffects?.allowed.map((entry) => [entry.workflowId, entry.blockId])).toEqual([
      [childId, child.idOf('Send')],
    ])
    expect(await tableRows(tableId)).toEqual([expect.stringContaining('child@b.co')])
  })

  it('are at most 256 characters, so a selector cannot fan out into thousands of lookups', async () => {
    const { parentId } = await parentFixture()
    const long = `${'a.'.repeat(128)}save`

    for (const selection of [
      { allow: [long] },
      { mocks: { [long]: { rows: [] } } },
      { mocksFrom: { runId: generateId(), blocks: [long] } },
    ]) {
      const { status, body } = await postRun(parentId, {
        source: 'draft',
        dry: true,
        ...selection,
      })
      expect(status, JSON.stringify(body)).toBe(400)
      expect(JSON.stringify(body)).toContain('at most 256 characters')
    }
    expect(await logTriggers(parentId)).toEqual([])
  })

  it('refuse a workflow name shared by more workflows than a lookup returns, rather than resolve a partial list', async () => {
    const { parentId } = await parentFixture()
    const crowded = `Crowded ${generateId()}`
    const now = new Date()
    const folders = Array.from({ length: 101 }, () => ({
      id: generateId(),
      resourceType: 'workflow' as const,
      name: `Folder ${generateId()}`,
      userId: ownerId,
      workspaceId,
    }))
    await db.insert(folder).values(folders)
    const crowd = folders.map((entry) => ({
      id: generateId(),
      userId: ownerId,
      workspaceId,
      folderId: entry.id,
      name: crowded,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    }))
    await db.insert(workflow).values(crowd)
    workflowIds.push(...crowd.map((entry) => entry.id))

    await expect(run(parentId, { dry: true, allow: [`${crowded}.save`] })).rejects.toMatchObject({
      ...validationError,
      message: expect.stringContaining('name more than 100 workflows'),
    })
  })
})

describe('a dry run’s mocks from an earlier run, read as that run shows them', () => {
  it('replay a block’s output redacted, never the run secret it resolved', async () => {
    const workflowId = await saveWorkflow(
      graph(
        [
          block('start', 'start_trigger'),
          block('reveal', 'function', {
            language: 'javascript',
            code: 'return { key: "{{DRY_SECRET}}" }',
          }),
        ],
        [['start', 'reveal']]
      ).state
    )
    const source = await run(workflowId, { dry: true })
    expect(source.status, JSON.stringify(source.error)).toBe('completed')

    const replayed = await run(workflowId, {
      dry: true,
      mocksFrom: { runId: source.executionId, blocks: ['reveal'] },
      selectedOutputs: ['reveal'],
    })

    expect(replayed.status, JSON.stringify(replayed.error)).toBe('completed')
    expect(JSON.stringify(replayed.blockOutputs?.reveal)).toContain('key')
    expect(JSON.stringify(replayed.blockOutputs)).not.toContain(SECRET)
  })

  it('refuse a block a test run answered with a placeholder, but read one it mocked', async () => {
    const tableId = await createTable()
    const workflowId = await saveWorkflow(lookupThenSave(tableId, 'a@b.co').state)
    const source = await run(workflowId, {
      dry: true,
      mocks: { lookup: { rows: [], rowCount: 0, totalCount: 7 } },
    })
    expect(source.status, JSON.stringify(source.error)).toBe('completed')

    await expect(
      run(workflowId, { dry: true, mocksFrom: { runId: source.executionId, blocks: ['save'] } })
    ).rejects.toMatchObject({
      ...validationError,
      message: expect.stringContaining('with a placeholder'),
    })
    const replayed = await run(workflowId, {
      dry: true,
      mocksFrom: { runId: source.executionId, blocks: ['lookup'] },
    })
    expect(replayed.status, JSON.stringify(replayed.error)).toBe('completed')
    expect(replayed.sideEffects?.stubbed[0]?.request).toMatchObject({ data: { note: 'count 7' } })
  })

  it('refuse a block a test run logged before placeholders were recorded did not mock', async () => {
    const tableId = await createTable()
    const workflowId = await saveWorkflow(lookupThenSave(tableId, 'a@b.co').state)
    const source = await run(workflowId, { dry: true, mocks: { save: { row: {} } } })
    expect(source.status, JSON.stringify(source.error)).toBe('completed')
    const [logged] = await db
      .select({ executionData: workflowExecutionLogs.executionData })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, source.executionId))
    const recorded = await materializeExecutionData(toRecord(logged?.executionData), {
      workspaceId,
      workflowId,
      executionId: source.executionId,
    })
    const trigger = toRecord(recorded.trigger)
    const { placeholdersRecorded, ...olderTriggerData } = toRecord(trigger.data)
    expect(placeholdersRecorded).toBe(true)
    await db
      .update(workflowExecutionLogs)
      .set({ executionData: { ...recorded, trigger: { ...trigger, data: olderTriggerData } } })
      .where(eq(workflowExecutionLogs.executionId, source.executionId))

    await expect(
      run(workflowId, { dry: true, mocksFrom: { runId: source.executionId, blocks: ['lookup'] } })
    ).rejects.toMatchObject({
      ...validationError,
      message: expect.stringContaining('logged before'),
    })
    const replayed = await run(workflowId, {
      dry: true,
      mocksFrom: { runId: source.executionId, blocks: ['save'] },
    })
    expect(replayed.status, JSON.stringify(replayed.error)).toBe('completed')
  })

  it('mock from a workflow test’s run: read a block it ran, refuse one it answered with a placeholder', async () => {
    const tableId = await createTable()
    const name = `Dry test ${generateId()}`
    const workflowId = await saveWorkflow(lookupThenSave(tableId, 'a@b.co').state, name)
    const session = new WorkflowTestSession({
      workspaceId,
      principal,
      version: 'draft',
      only: null,
      onProgress: async () => {},
    })
    let event = await session.start({ workflow: name, trigger: null, input: {}, targets: [] })
    while (event.kind === 'waiting') event = await session.next(event.runId)
    if (event.kind !== 'done') throw new Error(`The run ended with ${event.kind}`)

    await expect(
      run(workflowId, { dry: true, mocksFrom: { runId: event.executionId, blocks: ['save'] } })
    ).rejects.toMatchObject({
      ...validationError,
      message: expect.stringContaining('with a placeholder'),
    })
    const replayed = await run(workflowId, {
      dry: true,
      mocksFrom: { runId: event.executionId, blocks: ['lookup'] },
    })
    expect(replayed.status, JSON.stringify(replayed.error)).toBe('completed')
  })

  it('judge a block as the earlier run ran it, not as the draft has since been edited', async () => {
    const tableId = await createTable()
    const fixture = lookupThenSave(tableId, 'a@b.co')
    const workflowId = await saveWorkflow(fixture.state)
    const source = await run(workflowId, { dry: true })
    expect(source.status, JSON.stringify(source.error)).toBe('completed')
    const lookupId = fixture.idOf('lookup')
    const saveId = fixture.idOf('save')
    const edited = structuredClone(fixture.state)
    edited.blocks[lookupId] = { ...upsertLead('lookup', tableId, 'c@b.co'), id: lookupId }
    edited.blocks[saveId] = { ...queryLeads('save', tableId), id: saveId }
    const saved = await saveWorkflowToNormalizedTables(workflowId, edited)
    expect(saved.success, saved.error).toBe(true)

    await expect(
      run(workflowId, { dry: true, mocksFrom: { runId: source.executionId, blocks: ['save'] } })
    ).rejects.toMatchObject({
      ...validationError,
      message: expect.stringContaining('with a placeholder'),
    })
    const replayed = await run(workflowId, {
      dry: true,
      mocksFrom: { runId: source.executionId, blocks: ['lookup'] },
    })
    expect(replayed.status, JSON.stringify(replayed.error)).toBe('completed')
  })

  it('are refused while the run is running, when its outputs are hidden, and before it has any', async () => {
    const tableId = await createTable()
    const workflowId = await saveWorkflow(lookupThenSave(tableId, 'a@b.co').state)
    const source = await run(workflowId, { dry: true })
    const mocksFrom = (runId: string) => ({
      dry: true,
      mocksFrom: { runId, blocks: ['lookup'] },
    })

    viewer.hidesTraceSpans = true
    await expect(run(workflowId, mocksFrom(source.executionId))).rejects.toMatchObject({
      code: 'forbidden',
      message: expect.stringContaining('permission group'),
    })
    viewer.hidesTraceSpans = false

    const pausedId = generateId()
    const attemptId = generateId()
    await db.insert(pausedExecutions).values({
      id: pausedId,
      workflowId,
      executionId: source.executionId,
      executionSnapshot: {},
      pausePoints: [],
      totalPauseCount: 1,
      status: 'resumed',
    })
    await db.insert(resumeQueue).values({
      id: generateId(),
      pausedExecutionId: pausedId,
      parentExecutionId: source.executionId,
      newExecutionId: attemptId,
      contextId: 'context',
      status: 'failed',
      completedAt: new Date(),
      failureReason: 'Resume execution failed',
    })
    await expect(run(workflowId, mocksFrom(attemptId))).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringContaining('no recorded block outputs yet'),
    })

    await db
      .update(workflowExecutionLogs)
      .set({ status: 'running' })
      .where(eq(workflowExecutionLogs.executionId, source.executionId))
    await expect(run(workflowId, mocksFrom(source.executionId))).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringContaining('is still running'),
    })
  })
})
