/**
 * The v2 names clients used before they were renamed, against real PostgreSQL, over HTTP and over
 * the Sim MCP server (whose call tools dispatch through the same routes). `?dryRun=true` must stay
 * a dry run on `PUT /state` and `POST /operations`: the response says so under both names and no
 * block row is written; a request whose two names disagree is refused without a write. An execute
 * naming `run.source: "manual"` with `run.entry.useMockPayload` runs the saved draft with the
 * trigger's sample payload.
 */
import { db } from '@sim/db'
import { apiKey, permissions, user, workflow, workflowBlocks, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashApiKey } from '@/lib/api-key/crypto'
import { POST as simMcpPost } from '@/app/api/mcp/route'
import { POST as executeWorkflow } from '@/app/api/v2/workflows/[workflowId]/execute/route'
import { POST as applyOperations } from '@/app/api/v2/workflows/[workflowId]/operations/route'
import { PUT as replaceState } from '@/app/api/v2/workflows/[workflowId]/state/route'

const ORIGIN = 'http://localhost:3000'
const userId = generateId()
const workspaceId = generateId()
const workflowId = generateId()
const personalKey = `sk-sim-fixture-${generateId()}`

type RouteHandler = (
  request: NextRequest,
  context: { params: Promise<{ workflowId: string }> }
) => Promise<Response>

async function call(handler: unknown, method: string, path: string, body: unknown) {
  const response = await (handler as RouteHandler)(
    new NextRequest(`${ORIGIN}${path}`, {
      method,
      headers: {
        'x-forwarded-for': '127.0.0.1',
        'x-api-key': personalKey,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ workflowId }) }
  )
  return { status: response.status, body: await response.json() }
}

function graphWith(blockId: string, name: string) {
  return {
    blocks: {
      [blockId]: {
        id: blockId,
        type: 'function',
        name,
        position: { x: 0, y: 0 },
        subBlocks: { code: { id: 'code', type: 'code', value: 'return 1' } },
        outputs: {},
        enabled: true,
      },
    },
    edges: [],
  }
}

/** A Sim MCP `call_write_operation` call, answered with its tool result text. */
async function callOverMcp(args: Record<string, unknown>): Promise<string> {
  const response = await call(simMcpPost, 'POST', '/api/mcp', {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'call_write_operation', arguments: args },
  })
  expect(response.status).toBe(200)
  return JSON.stringify(response.body)
}

const startId = generateId()
const doneId = generateId()

/** A start trigger whose input field has a sample value, answered by a Response block. */
const runnableGraph = {
  blocks: {
    [startId]: {
      id: startId,
      type: 'start_trigger',
      name: 'Start',
      position: { x: 0, y: 0 },
      subBlocks: {
        inputFormat: {
          id: 'inputFormat',
          type: 'input-format',
          value: [{ id: 'topic', name: 'topic', type: 'string', value: 'sample-topic' }],
        },
      },
      outputs: {},
      enabled: true,
    },
    [doneId]: {
      id: doneId,
      type: 'response',
      name: 'Done',
      position: { x: 300, y: 0 },
      subBlocks: {
        dataMode: { id: 'dataMode', type: 'dropdown', value: 'json' },
        data: { id: 'data', type: 'code', value: '{"topic": "<start.topic>"}' },
        status: { id: 'status', type: 'short-input', value: '200' },
      },
      outputs: {},
      enabled: true,
    },
  },
  edges: [{ id: generateId(), source: startId, target: doneId }],
}

const legacyDraftRun = {
  run: { source: 'manual', entry: { type: 'trigger', useMockPayload: true } },
}

async function blockNames(): Promise<string[]> {
  const rows = await db
    .select({ name: workflowBlocks.name })
    .from(workflowBlocks)
    .where(eq(workflowBlocks.workflowId, workflowId))
  return rows.map((row) => row.name).sort()
}

const statePath = `/api/v2/workflows/${workflowId}/state`
const operationsPath = `/api/v2/workflows/${workflowId}/operations`

describe('pre-rename v2 names in PostgreSQL', () => {
  let committedData: unknown
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Deprecated names fixture',
      email: `${userId}@deprecated-names.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Deprecated names fixture',
      ownerId: userId,
      billedAccountUserId: userId,
      allowPersonalApiKeys: true,
    })
    await db.insert(permissions).values({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
    })
    await db.insert(workflow).values({
      id: workflowId,
      userId,
      workspaceId,
      name: 'Deprecated names fixture',
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(apiKey).values({
      id: generateId(),
      userId,
      name: 'Full access',
      key: personalKey,
      keyHash: hashApiKey(personalKey),
      type: 'personal',
    })

    const committed = await call(replaceState, 'PUT', statePath, runnableGraph)
    expect(committed.status).toBe(200)
    committedData = committed.body.data
  })

  afterAll(async () => {
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
    await db.$client.end()
  })

  it('answers a committed write with dryRun beside dry, and persists it', async () => {
    expect(committedData).toMatchObject({ dry: false, dryRun: false })
    expect(await blockNames()).toEqual(['Done', 'Start'])
  })

  it('validates PUT /state?dryRun=true without persisting, answering dry under both names', async () => {
    const response = await call(
      replaceState,
      'PUT',
      `${statePath}?dryRun=true`,
      graphWith(generateId(), 'Proposed')
    )

    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ dry: true, dryRun: true })
    expect(await blockNames()).toEqual(['Done', 'Start'])
  })

  it('evaluates POST /operations?dryRun=true without persisting, answering dry under both names', async () => {
    const response = await call(applyOperations, 'POST', `${operationsPath}?dryRun=true`, {
      operations: [
        {
          operation_type: 'add',
          block_id: 'proposed-fn',
          params: { type: 'function', name: 'Proposed', inputs: { code: 'return 2' } },
        },
      ],
    })

    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ dry: true, dryRun: true })
    expect(await blockNames()).toEqual(['Done', 'Start'])
  })

  it('refuses ?dry and ?dryRun that disagree, without writing', async () => {
    const response = await call(
      replaceState,
      'PUT',
      `${statePath}?dry=false&dryRun=true`,
      graphWith(generateId(), 'Conflicting')
    )

    expect(response.status).toBe(400)
    expect(JSON.stringify(response.body)).toContain('dryRun is the deprecated name of dry')
    expect(await blockNames()).toEqual(['Done', 'Start'])
  })

  it('validates replaceWorkflowState with dryRun over MCP without persisting', async () => {
    const text = await callOverMcp({
      operation: 'replaceWorkflowState',
      params: { workflowId },
      query: { dryRun: true },
      body: graphWith(generateId(), 'Proposed'),
    })

    expect(text).toContain('\\"dry\\":true')
    expect(text).toContain('\\"dryRun\\":true')
    expect(await blockNames()).toEqual(['Done', 'Start'])
  })

  it('runs source manual with entry.useMockPayload as a draft run with the sample payload', async () => {
    const response = await call(
      executeWorkflow,
      'POST',
      `/api/v2/workflows/${workflowId}/execute`,
      legacyDraftRun
    )

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.data.status).toBe('completed')
    expect(JSON.stringify(response.body.data.output)).toContain('sample-topic')
  })

  it('runs the same pre-rename draft run over MCP', async () => {
    const text = await callOverMcp({
      operation: 'executeWorkflow',
      params: { workflowId },
      body: legacyDraftRun,
    })

    expect(text).toContain('sample-topic')
    expect(text).not.toContain('isError')
  })
})
