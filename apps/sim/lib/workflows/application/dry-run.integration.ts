/**
 * Dry runs against real PostgreSQL and Redis, through the manual run use cases and the v2 execute
 * route: a dry run writes no table row and sends no request, reports each write with the payload
 * it would have sent (credentials, run secrets and password fields redacted) under the `test`
 * trigger, and keeps nothing else: no Agent memory, no workspace event, no run count. An allowed
 * block writes for real while reads run for real; a child workflow's writes, an Agent's included,
 * stay stubbed; custom and Wait blocks are answered whole; code runs and is listed unchecked; a
 * mocked block steers a branch; a failed dry run keeps its side effects and is the source only of
 * another dry run. A test run is never the source of a run that sends its writes (the v2 use case,
 * Copilot and the editor route alike) and is never resumed; a mock never controls the run or
 * replaces a locked block, and only the ids of mocked blocks are kept. Model calls are answered by
 * a simulated Anthropic API.
 */
import { db } from '@sim/db'
import {
  apiKey,
  customBlock,
  customTools,
  memory,
  organization,
  pausedExecutions,
  permissions,
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
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { BlockState, SubBlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const { subscriberRuns, session } = vi.hoisted(() => {
  /** Custom blocks are a self-hosted opt-in, read when the config module loads. */
  process.env.CUSTOM_BLOCKS_ENABLED = 'true'
  return {
    subscriberRuns: { runIds: [] as string[] },
    /** The browser session the editor route sees; none unless a test signs in. */
    session: {
      current: null as null | {
        user: { id: string; name: string; email: string }
        session: { id: string }
      },
    },
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
const SECRET = `dry-secret-${generateId()}`
const UNREFERENCED_SECRET = `unreferenced-${generateId()}`
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

/** Saves `state` as the draft of a new workflow in the fixture workspace. */
async function saveWorkflow(state: WorkflowState, name = `Dry run ${generateId()}`) {
  const id = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id,
    userId: ownerId,
    workspaceId,
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
      useMockPayload: false,
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

/** The simulated Anthropic API: the first `toolTurns` turns call the first tool offered. */
const model = { toolTurns: 0 }

async function answerModel(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (url.hostname !== 'api.anthropic.com') {
    throw new Error(`Unexpected network destination in a dry run: ${url.hostname}`)
  }
  const body = (await request.json()) as Record<string, unknown>
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
})

afterAll(async () => {
  await db.delete(webhook).where(inArray(webhook.workflowId, workflowIds))
  await db
    .delete(workflowExecutionLogs)
    .where(inArray(workflowExecutionLogs.workflowId, workflowIds))
  await db
    .delete(workflowExecutionSnapshots)
    .where(inArray(workflowExecutionSnapshots.workflowId, workflowIds))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
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

    const allowed = await run(parentId, { dry: true, allowBlocks: ['save'] })

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
    expect(allowed.dryRun).toEqual({ allowBlocks: [parent.idOf('save')], mockedBlocks: [] })

    const reread = await run(parentId, { dry: true, selectedOutputs: ['lookup.rows'] })
    expect(JSON.stringify(reread.blockOutputs?.['lookup.rows'])).toContain('a@b.co')
    await expect(run(parentId, { dry: true, allowBlocks: ['child'] })).rejects.toMatchObject(
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
            conversationId: `conversation-${generateId()}`,
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
      .where(eq(memory.workspaceId, workspaceId))
    expect(memories).toEqual([])
  })

  it('masks a secret typed into a password field, whatever the field is called', async () => {
    const routingKey = `routing-${generateId()}`
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
          body: expect.objectContaining({ event_action: 'trigger' }),
        }),
      }),
    ])
    expect(JSON.stringify(result.sideEffects)).not.toContain(routingKey)
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
      await expect(run(workflowId, { dry: true, allowBlocks: [allowed] })).rejects.toMatchObject(
        validationError
      )
    }
  })

  it('runs code for real, listing a Function block unchecked and a Condition not at all', async () => {
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
    expect(result.sideEffects?.unchecked).toEqual([
      expect.objectContaining({ blockId: branching.idOf('score'), block: 'score' }),
    ])
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
      { allowBlocks: ['save'] },
      { dry: true, allowBlocks: ['nope'] },
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

  it('stubs a workflow test’s unmocked writes', async () => {
    const tableId = await createTable()
    const name = `Dry test ${generateId()}`
    await saveWorkflow(
      graph(
        [block('start', 'start_trigger'), upsertLead('save', tableId, 'a@b.co')],
        [['start', 'save']]
      ).state,
      name
    )
    const session = new WorkflowTestSession({
      workspaceId,
      principal,
      version: 'draft',
      only: null,
      onProgress: async () => {},
    })

    let event = await session.start({ workflow: name, trigger: null, input: {}, targets: [] })
    while (event.kind === 'waiting') event = await session.next(event.runId)

    expect(event).toMatchObject({ kind: 'done' })
    expect(await tableRows(tableId)).toEqual([])
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

    const first = await execute({ source: 'manual', dry: true })
    expect(first.status).toBe('completed')
    expect(first.sideEffects?.stubbed).toHaveLength(3)
    const rerun = await execute({
      source: 'manual',
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
    expect(await fromBlock('latest')).toMatchObject({ status: 400 })
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
        useMockPayload: false,
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
    /** A pausing block can no longer pause a test run; this stands in for one that did. */
    await db
      .update(workflowExecutionLogs)
      .set({ trigger: 'test' })
      .where(eq(workflowExecutionLogs.executionId, paused.executionId))

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
    await sleep(500)
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
    ).rejects.toMatchObject(validationError)
    expect(await pausedExecutionsOf(parentId)).toEqual([])
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
    ).rejects.toMatchObject(validationError)
    expect(await logTriggers(workflowId)).toEqual([])
  })

  it('are kept only as block ids, which a failed run reads back for its rerun', async () => {
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
    const recorded = { allowBlocks: [fixture.idOf('save')], mockedBlocks: [fixture.idOf('lookup')] }

    const failed = await run(workflowId, {
      dry: true,
      allowBlocks: ['save'],
      mocks: { lookup: { rows: [], rowCount: 0, totalCount: 0, note: secret } },
    })

    expect(failed.status).toBe('failed')
    expect(failed.dryRun).toEqual(recorded)
    const [row] = await db
      .select({ executionData: workflowExecutionLogs.executionData })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, failed.executionId))
    const executionData = await materializeExecutionData(
      row.executionData as Record<string, unknown>,
      { workspaceId, workflowId, executionId: failed.executionId }
    )
    const trigger = executionData.trigger as { data?: { dryRun?: unknown } }
    expect(trigger.data?.dryRun).toEqual(recorded)
    const read = await readWorkflowRun.execute({
      principal,
      input: { workflowId, runId: failed.executionId, includeOutput: false, selectedOutputs: [] },
    })
    expect(read.dryRun).toEqual(recorded)
    expect(JSON.stringify(read)).not.toContain(secret)
  })
})
