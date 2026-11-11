/**
 * Read-only and expiring API keys against real PostgreSQL, through the route
 * handlers a caller reaches: the v2 builders, the Sim MCP server, v1, the legacy
 * execute route, a workflow MCP server, and the resume and cancel legs. A
 * read-only key must be refused every write on every path without changing a
 * row, keep its reads, and an expired key must say it expired. The keys used
 * here are minted through the settings routes, so the create path's bounds are
 * exercised by the same suite.
 */
import { db } from '@sim/db'
import {
  apiKey,
  knowledgeBase,
  knowledgeBaseTagDefinitions,
  permissions,
  user,
  userTableDefinitions,
  workflow,
  workflowExecutionLogs,
  workflowMcpServer,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { authMock, authMockFns } from '@sim/testing'
import { featureFlagsMock } from '@sim/testing/mocks/feature-flags.mock'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

import { hashApiKey } from '@/lib/api-key/crypto'
import { READ_ONLY_API_KEY_DENIED } from '@/lib/api-key/policy-messages'
import { POST as simMcpPost } from '@/app/api/mcp/route'
import { POST as workflowMcpPost } from '@/app/api/mcp/serve/[serverId]/route'
import { POST as legacyResume } from '@/app/api/resume/[workflowId]/[executionId]/[contextId]/route'
import { POST as createPersonalKey } from '@/app/api/users/me/api-keys/route'
import { POST as v1KnowledgeSearch } from '@/app/api/v1/knowledge/search/route'
import { POST as v1CreateTable, GET as v1ListTables } from '@/app/api/v1/tables/route'
import { GET as v2Meta } from '@/app/api/v2/meta/route'
import { POST as v2CreateTable, GET as v2ListTables } from '@/app/api/v2/tables/route'
import { POST as v2CancelRun } from '@/app/api/v2/workflows/[workflowId]/runs/[runId]/cancel/route'
import { POST as v2ResumeRun } from '@/app/api/v2/workflows/[workflowId]/runs/[runId]/resume/route'
import { POST as legacyExecute } from '@/app/api/workflows/[id]/execute/route'
import { POST as internalCancelRun } from '@/app/api/workflows/[id]/executions/[executionId]/cancel/route'
import { POST as createWorkspaceKey } from '@/app/api/workspaces/[id]/api-keys/route'

const ORIGIN = 'http://localhost:3000'
const DAY_MS = 24 * 60 * 60 * 1000

const userId = generateId()
const workspaceId = generateId()
const workflowId = generateId()
const mcpServerId = generateId()
const knowledgeBaseId = generateId()
const legacyKey = `sk-sim-fixture-${generateId()}`
const expiredKey = `sk-sim-fixture-${generateId()}`

let readPersonalKey = ''
let readWorkspaceKey = ''

type RouteHandler = (request: NextRequest, context: { params: Promise<never> }) => Promise<Response>

interface CallOptions {
  method?: string
  key?: string
  body?: unknown
  params?: Record<string, string>
  headers?: Record<string, string>
}

async function call(handler: unknown, path: string, options: CallOptions = {}) {
  const headers = new Headers({ 'x-forwarded-for': '127.0.0.1', ...options.headers })
  if (options.key) headers.set('x-api-key', options.key)
  if (options.body !== undefined) headers.set('content-type', 'application/json')
  const request = new NextRequest(`${ORIGIN}${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const response = await (handler as RouteHandler)(request, {
    params: Promise.resolve(options.params ?? {}) as Promise<never>,
  })
  const text = await response.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {}
  return { status: response.status, body }
}

/** Table names must match `NAME_PATTERN`, so the generated id's hyphens become underscores. */
function tableBody(label: string) {
  return {
    workspaceId,
    name: `${label}_${generateId().replaceAll('-', '_')}`,
    schema: { columns: [{ name: 'title', type: 'string' }] },
  }
}

async function tableCount(): Promise<number> {
  const rows = await db
    .select({ id: userTableDefinitions.id })
    .from(userTableDefinitions)
    .where(eq(userTableDefinitions.workspaceId, workspaceId))
  return rows.length
}

async function executionCount(): Promise<number> {
  const rows = await db
    .select({ id: workflowExecutionLogs.id })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.workflowId, workflowId))
  return rows.length
}

function mcpToolCall(name: string, args: Record<string, unknown>) {
  return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
}

const MCP_HEADERS = { accept: 'application/json, text/event-stream' }

describe('read-only and expiring API keys in PostgreSQL', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Read-only key fixture',
      email: `${userId}@read-only-key.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Read-only key fixture',
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
      name: 'Read-only key fixture',
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workflowMcpServer).values({
      id: mcpServerId,
      workspaceId,
      createdBy: userId,
      name: 'Read-only key fixture',
    })
    await db.insert(knowledgeBase).values({
      id: knowledgeBaseId,
      userId,
      workspaceId,
      name: 'Read-only key fixture',
    })
    await db.insert(knowledgeBaseTagDefinitions).values({
      id: generateId(),
      knowledgeBaseId,
      tagSlot: 'tag1',
      displayName: 'Topic',
      fieldType: 'text',
    })
    await db.insert(apiKey).values([
      {
        id: generateId(),
        userId,
        name: 'Created before access levels',
        key: legacyKey,
        keyHash: hashApiKey(legacyKey),
        type: 'personal',
      },
      {
        id: generateId(),
        userId,
        name: 'Expired',
        key: expiredKey,
        keyHash: hashApiKey(expiredKey),
        type: 'personal',
        expiresAt: new Date(Date.now() - 1000),
      },
    ])
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: userId, name: 'Read-only key fixture', email: `${userId}@read-only-key.test` },
      session: { id: 'fixture-session' },
    })
  })

  afterAll(async () => {
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
    await db.$client.end()
  })

  it('rejects an expiry outside one day to one year, and an unparseable one, without creating a key', async () => {
    const before = await db.select({ id: apiKey.id }).from(apiKey).where(eq(apiKey.userId, userId))
    for (const expiresAt of [
      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      new Date(Date.now() + 400 * DAY_MS).toISOString(),
      new Date(Date.now() - DAY_MS).toISOString(),
      'next tuesday',
    ]) {
      const created = await call(createPersonalKey, '/api/users/me/api-keys', {
        body: { name: `Bad expiry ${generateId()}`, expiresAt },
      })
      expect(created.status, expiresAt).toBe(400)
    }
    const invalidAccess = await call(createPersonalKey, '/api/users/me/api-keys', {
      body: { name: `Bad access ${generateId()}`, access: 'admin' },
    })
    expect(invalidAccess.status).toBe(400)
    const after = await db.select({ id: apiKey.id }).from(apiKey).where(eq(apiKey.userId, userId))
    expect(after).toHaveLength(before.length)
  })

  it('reserves the delegation key-name prefix', async () => {
    const created = await call(createPersonalKey, '/api/users/me/api-keys', {
      body: { name: `mothership-delegation:${userId}`, access: 'write' },
    })
    expect(created.status).toBe(400)
  })

  it('mints read-only personal and workspace keys that report their access and expiry', async () => {
    const expiresAt = new Date(Date.now() + 30 * DAY_MS).toISOString()
    const personal = await call(createPersonalKey, '/api/users/me/api-keys', {
      body: { name: `Read personal ${generateId()}`, access: 'read', expiresAt },
    })
    expect(personal.status).toBe(200)
    expect(personal.body).toMatchObject({ key: { access: 'read', expiresAt } })
    readPersonalKey = (personal.body as { key: { key: string } }).key.key

    const scoped = await call(createWorkspaceKey, `/api/workspaces/${workspaceId}/api-keys`, {
      body: { name: `Read workspace ${generateId()}`, access: 'read', expiresAt: null },
      params: { id: workspaceId },
    })
    expect(scoped.status).toBe(200)
    expect(scoped.body).toMatchObject({ key: { access: 'read', expiresAt: null } })
    readWorkspaceKey = (scoped.body as { key: { key: string } }).key.key

    for (const key of [readPersonalKey, readWorkspaceKey]) {
      const meta = await call(v2Meta, '/api/v2/meta', { key })
      expect(meta.status).toBe(200)
      expect(meta.body).toMatchObject({ data: { scopes: ['api:read', 'search:read'] } })
    }
    const personalMeta = await call(v2Meta, '/api/v2/meta', { key: readPersonalKey })
    expect(personalMeta.body).toMatchObject({ data: { expiresAt } })
  })

  it('keeps every read on v2, v1, and both MCP servers', async () => {
    for (const key of [readPersonalKey, readWorkspaceKey]) {
      const v2 = await call(v2ListTables, `/api/v2/tables?workspaceId=${workspaceId}`, { key })
      expect(v2.status).toBe(200)

      const v1 = await call(v1ListTables, `/api/v1/tables?workspaceId=${workspaceId}`, { key })
      expect(v1.status).toBe(200)

      const mcpRead = await call(simMcpPost, '/api/mcp', {
        key,
        headers: MCP_HEADERS,
        body: mcpToolCall('call_read_operation', {
          operation: 'listTables',
          query: { workspaceId },
        }),
      })
      expect(mcpRead.status).toBe(200)
      expect(JSON.stringify(mcpRead.body)).not.toContain('READ_ONLY_API_KEY')

      const workflowMcpList = await call(workflowMcpPost, `/api/mcp/serve/${mcpServerId}`, {
        key,
        params: { serverId: mcpServerId },
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      })
      expect(workflowMcpList.status).toBe(200)
    }

    /** Search reads through POST, so the v1 write gate lets it through. Tag-only, so nothing embeds. */
    for (const key of [readPersonalKey, readWorkspaceKey]) {
      const search = await call(v1KnowledgeSearch, '/api/v1/knowledge/search', {
        key,
        body: {
          workspaceId,
          knowledgeBaseIds: knowledgeBaseId,
          tagFilters: [{ tagName: 'Topic', value: 'fixture' }],
        },
      })
      expect(search.status, JSON.stringify(search.body)).toBe(200)
    }
  })

  it('refuses every write path with READ_ONLY_API_KEY and changes nothing', async () => {
    const tablesBefore = await tableCount()
    const runId = generateId()

    for (const key of [readPersonalKey, readWorkspaceKey]) {
      const v2 = await call(v2CreateTable, '/api/v2/tables', {
        key,
        body: tableBody('v2'),
      })
      expect(v2.status).toBe(403)
      expect(v2.body).toMatchObject({
        error: { code: 'FORBIDDEN', details: { code: 'READ_ONLY_API_KEY' } },
      })

      const mcpWrite = await call(simMcpPost, '/api/mcp', {
        key,
        headers: MCP_HEADERS,
        body: mcpToolCall('call_write_operation', {
          operation: 'createTable',
          body: tableBody('mcp'),
        }),
      })
      expect(mcpWrite.status).toBe(403)
      expect(mcpWrite.body).toMatchObject({ error: { details: { code: 'READ_ONLY_API_KEY' } } })

      const v1 = await call(v1CreateTable, '/api/v1/tables', {
        key,
        body: tableBody('v1'),
      })
      expect(v1.status).toBe(403)
      expect(v1.body).toEqual({
        error: READ_ONLY_API_KEY_DENIED,
        details: { code: 'READ_ONLY_API_KEY' },
      })

      const execute = await call(legacyExecute, `/api/workflows/${workflowId}/execute`, {
        key,
        params: { id: workflowId },
        body: { input: {} },
      })
      expect(execute.status).toBe(403)
      expect(execute.body).toMatchObject({ details: { code: 'READ_ONLY_API_KEY' } })

      const toolCall = await call(workflowMcpPost, `/api/mcp/serve/${mcpServerId}`, {
        key,
        params: { serverId: mcpServerId },
        body: mcpToolCall('fixture_tool', {}),
      })
      expect(toolCall.status).toBe(403)
      expect(toolCall.body).toMatchObject({ error: { data: { code: 'READ_ONLY_API_KEY' } } })

      const v2Resume = await call(
        v2ResumeRun,
        `/api/v2/workflows/${workflowId}/runs/${runId}/resume`,
        { key, params: { workflowId, runId }, body: { input: {} } }
      )
      expect(v2Resume.status).toBe(403)
      expect(v2Resume.body).toMatchObject({ error: { details: { code: 'READ_ONLY_API_KEY' } } })

      const v2Cancel = await call(
        v2CancelRun,
        `/api/v2/workflows/${workflowId}/runs/${runId}/cancel`,
        { key, method: 'POST', params: { workflowId, runId } }
      )
      expect(v2Cancel.status).toBe(403)
      expect(v2Cancel.body).toMatchObject({ error: { details: { code: 'READ_ONLY_API_KEY' } } })

      const internalCancel = await call(
        internalCancelRun,
        `/api/workflows/${workflowId}/executions/${runId}/cancel`,
        { key, method: 'POST', params: { id: workflowId, executionId: runId } }
      )
      expect(internalCancel.status).toBe(403)
      expect(internalCancel.body).toMatchObject({ error: READ_ONLY_API_KEY_DENIED })

      const resume = await call(
        legacyResume,
        `/api/resume/${workflowId}/${runId}/${generateId()}`,
        {
          key,
          params: { workflowId, executionId: runId, contextId: generateId() },
          body: { input: {} },
        }
      )
      expect(resume.status).toBe(403)
      expect(resume.body).toMatchObject({ error: READ_ONLY_API_KEY_DENIED })
    }

    expect(await tableCount()).toBe(tablesBefore)
    expect(await executionCount()).toBe(0)
  })

  it('treats a key created before access levels as full access', async () => {
    const meta = await call(v2Meta, '/api/v2/meta', { key: legacyKey })
    expect(meta.body).toMatchObject({
      data: { scopes: ['api:read', 'api:write', 'search:read'], expiresAt: null },
    })

    const tablesBefore = await tableCount()
    const created = await call(v2CreateTable, '/api/v2/tables', {
      key: legacyKey,
      body: tableBody('legacy'),
    })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect(await tableCount()).toBe(tablesBefore + 1)
  })

  it('answers an expired key with an expiry message on v2 and v1', async () => {
    const v2 = await call(v2Meta, '/api/v2/meta', { key: expiredKey })
    expect(v2.status).toBe(401)
    expect(v2.body).toMatchObject({ error: { message: 'API key has expired' } })

    const v1 = await call(v1ListTables, `/api/v1/tables?workspaceId=${workspaceId}`, {
      key: expiredKey,
    })
    expect(v1.status).toBe(401)
    expect(v1.body).toEqual({ error: 'API key has expired' })
  })
})
