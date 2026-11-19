/**
 * Sim MCP code mode against real PostgreSQL and the real isolated-vm pool,
 * through the `/api/mcp` route a client reaches: API-key authentication, the
 * scope gate, the sandbox, and every `sim.api` call dispatched to its own v2
 * route. Each case is a way a program could exceed what its caller may do one
 * call at a time, or lose the trail of what it already changed.
 */
import { db } from '@sim/db'
import { apiKey, permissions, user, userTableDefinitions, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { authMock } from '@sim/testing/mocks/auth.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

import { hashApiKey } from '@/lib/api-key/crypto'
import { POST as simMcpPost } from '@/app/api/mcp/route'

const ORIGIN = 'http://localhost:3000'
const userId = generateId()
const workspaceId = generateId()
const writeKey = `sk-sim-fixture-${generateId()}`
const readKey = `sk-sim-fixture-${generateId()}`

interface ToolResult {
  isError?: boolean
  content: Array<{ type: string; text: string }>
  structuredContent?: { result: unknown; calls: Array<Record<string, unknown>>; logs?: string }
}

async function mcp(key: string, message: Record<string, unknown>) {
  const request = new NextRequest(`${ORIGIN}/api/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
      'x-api-key': key,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...message }),
  })
  const response = await simMcpPost(request, { params: Promise.resolve({}) } as never)
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

async function runCode(
  tool: 'execute_read_code' | 'execute_write_code',
  code: string,
  options: { key?: string; timeoutMs?: number } = {}
): Promise<ToolResult> {
  const { status, body } = await mcp(options.key ?? writeKey, {
    method: 'tools/call',
    params: {
      name: tool,
      arguments: { code, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) },
    },
  })
  expect(status, JSON.stringify(body)).toBe(200)
  return body.result as ToolResult
}

/** A failed run's tool error, parsed: the error, and every call made before it. */
function failureOf(result: ToolResult) {
  expect(result.isError, JSON.stringify(result)).toBe(true)
  return JSON.parse(result.content[0].text) as {
    error: Record<string, unknown>
    calls: Array<Record<string, unknown>>
    logs?: string
  }
}

async function tableNames(): Promise<string[]> {
  const rows = await db
    .select({ name: userTableDefinitions.name })
    .from(userTableDefinitions)
    .where(eq(userTableDefinitions.workspaceId, workspaceId))
  return rows.map((row) => row.name).sort()
}

const TABLE_SCHEMA = { columns: [{ name: 'title', type: 'string' }] }

describe('Sim MCP code mode in PostgreSQL and the isolate pool', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Code mode fixture',
      email: `${userId}@code-mode.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Code mode fixture',
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
    await db.insert(apiKey).values([
      {
        id: generateId(),
        userId,
        name: 'Write',
        key: writeKey,
        keyHash: hashApiKey(writeKey),
        type: 'personal',
        access: 'write',
      },
      {
        id: generateId(),
        userId,
        name: 'Read',
        key: readKey,
        keyHash: hashApiKey(readKey),
        type: 'personal',
        access: 'read',
      },
    ])
  })

  beforeEach(() => {
    featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
      async (flag: string, target?: unknown) =>
        flag === 'mcp-code-mode' && toRecord(target).userId === userId
    )
  })

  afterAll(async () => {
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
    await db.$client.end()
  })

  it('lists the code tools only when the flag is on for the caller', async () => {
    const listed = await mcp(writeKey, { method: 'tools/list' })
    const names = (listed.body.result as { tools: Array<{ name: string }> }).tools.map(
      (t) => t.name
    )
    expect(names).toEqual(expect.arrayContaining(['execute_read_code', 'execute_write_code']))

    featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(false)
    const hidden = await mcp(writeKey, { method: 'tools/list' })
    const hiddenNames = (hidden.body.result as { tools: Array<{ name: string }> }).tools.map(
      (t) => t.name
    )
    expect(hiddenNames).not.toContain('execute_read_code')
    expect(hiddenNames).not.toContain('execute_write_code')
    const refused = await mcp(writeKey, {
      method: 'tools/call',
      params: { name: 'execute_read_code', arguments: { code: 'return 1' } },
    })
    expect(refused.body.result).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining('Tool execute_read_code not found') }],
    })
  })

  it('writes through real routes and reads them back with paging, returning only the result', async () => {
    const names = [`cm_a_${generateId().slice(0, 8)}`, `cm_b_${generateId().slice(0, 8)}`]
    const written = await runCode(
      'execute_write_code',
      `
      const created: string[] = []
      for (const name of ${JSON.stringify(names)}) {
        const { data } = await sim.api.createTable({ body: { workspaceId: ${JSON.stringify(workspaceId)}, name, schema: ${JSON.stringify(TABLE_SCHEMA)} } })
        created.push(data.name)
      }
      return created
      `
    )
    expect(written.isError, JSON.stringify(written)).toBeFalsy()
    expect(written.structuredContent?.result).toEqual(names)
    expect(written.structuredContent?.calls.map((c) => [c.operation, c.status])).toEqual([
      ['createTable', 201],
      ['createTable', 201],
    ])
    expect(await tableNames()).toEqual(expect.arrayContaining(names))

    const read = await runCode(
      'execute_read_code',
      `
      const found = []
      let cursor
      do {
        const page = await sim.api.listTables({ query: { workspaceId: ${JSON.stringify(workspaceId)}, limit: 1, ...(cursor ? { cursor } : {}) } })
        found.push(...page.data.map((t) => t.name))
        cursor = page.nextCursor
      } while (cursor)
      console.log('pages', found.length)
      return found.sort()
      `
    )
    expect(read.isError, JSON.stringify(read)).toBeFalsy()
    expect(read.structuredContent?.result).toEqual(await tableNames())
    expect(
      read.structuredContent?.calls.every((c) => c.operation === 'listTables' && c.status === 200)
    ).toBe(true)
    expect(read.structuredContent?.logs).toBe(`pages ${(await tableNames()).length}`)
  })

  it('refuses every write in a read program on the host, without changing a row', async () => {
    const before = await tableNames()
    const result = await runCode(
      'execute_read_code',
      `
      try {
        await sim.api.createTable({ body: { workspaceId: ${JSON.stringify(workspaceId)}, name: 'cm_refused', schema: ${JSON.stringify(TABLE_SCHEMA)} } })
        return 'created'
      } catch (error) {
        return { name: error.name, status: error.status, code: error.code }
      }
      `
    )
    expect(result.structuredContent?.result).toEqual({
      name: 'SimApiError',
      status: 403,
      code: 'WRITE_NOT_ALLOWED',
    })
    expect(result.structuredContent?.calls).toEqual([
      expect.objectContaining({ operation: 'createTable', refused: expect.any(String) }),
    ])
    expect(await tableNames()).toEqual(before)
  })

  it('refuses the write code tool to a read-only key before any program runs', async () => {
    const before = await tableNames()
    const { status, body } = await mcp(readKey, {
      method: 'tools/call',
      params: {
        name: 'execute_write_code',
        arguments: {
          code: `await sim.api.createTable({ body: { workspaceId: ${JSON.stringify(workspaceId)}, name: 'cm_read_key', schema: ${JSON.stringify(TABLE_SCHEMA)} } })`,
        },
      },
    })
    expect(status).toBe(403)
    expect(body).toMatchObject({ error: { details: { code: 'READ_ONLY_API_KEY' } } })
    expect(await tableNames()).toEqual(before)
  })

  it('hands API errors to the program as catchable SimApiErrors with the v2 envelope', async () => {
    const result = await runCode(
      'execute_read_code',
      `
      try {
        await sim.api.getTable({ params: { tableId: ${JSON.stringify(generateId())} }, query: { workspaceId: ${JSON.stringify(workspaceId)} } })
      } catch (error) {
        return { name: error.name, status: error.status, code: error.code, isError: error instanceof SimApiError }
      }
      `
    )
    expect(result.structuredContent?.result).toMatchObject({
      name: 'SimApiError',
      status: 404,
      code: 'NOT_FOUND',
      isError: true,
    })
  })

  it('passes a numeric path parameter, as signatures declare it, through to its route', async () => {
    const result = await runCode(
      'execute_read_code',
      `
      try {
        await sim.api.getFileVersion({ params: { fileId: 'wf_${generateId().replaceAll('-', '')}', version: 1 }, query: { workspaceId: ${JSON.stringify(workspaceId)} } })
      } catch (error) {
        return { status: error.status, code: error.code }
      }
      `
    )
    expect(result.structuredContent?.result).toEqual({ status: 404, code: 'NOT_FOUND' })
  })

  it('gives the program no network and no credential', async () => {
    const result = await runCode(
      'execute_read_code',
      `
      const values = []
      const seen = new Set()
      const visit = (value, depth) => {
        if (value === null || value === undefined || depth > 5) return
        if (typeof value === 'string') { values.push(value.slice(0, 2000)); return }
        if (typeof value !== 'object' && typeof value !== 'function') return
        if (seen.has(value)) return
        seen.add(value)
        if (typeof value === 'function') { try { values.push(String(value).slice(0, 2000)) } catch {} }
        for (const key of Object.getOwnPropertyNames(value)) {
          try { visit(value[key], depth + 1) } catch {}
        }
      }
      visit(globalThis, 0)
      return { fetch: typeof fetch, xhr: typeof XMLHttpRequest, process: typeof process, require: typeof require, globals: values.join('\\n').slice(0, 900000) }
      `
    )
    const value = result.structuredContent?.result as Record<string, string>
    expect(value).toMatchObject({
      fetch: 'undefined',
      xhr: 'undefined',
      process: 'undefined',
      require: 'undefined',
    })
    expect(value.globals).not.toContain(writeKey)
    expect(value.globals).not.toContain(hashApiKey(writeKey))
  })

  it('sends no queued call once the program has ended, and marks every call’s outcome', async () => {
    const prefix = `cm_q_${generateId().slice(0, 8)}`
    const failed = failureOf(
      await runCode(
        'execute_write_code',
        `
        for (let i = 0; i < 40; i++) {
          sim.api.createTable({ body: { workspaceId: ${JSON.stringify(workspaceId)}, name: '${prefix}_' + i, schema: ${JSON.stringify(TABLE_SCHEMA)} } }).catch(() => {})
        }
        throw new Error('stopped while writes were queued')
        `
      )
    )
    expect(failed.error.message).toBe('stopped while writes were queued')
    await sleep(3000)
    const created = (await tableNames()).filter((name) => name.startsWith(prefix))
    const sent = failed.calls.filter((call) => call.refused === undefined)
    expect(sent.length).toBeLessThan(failed.calls.length)
    expect(created.length).toBeLessThanOrEqual(sent.length)
    for (const call of failed.calls) {
      expect(
        call.status !== undefined || call.refused !== undefined || call.unreadable !== undefined
      ).toBe(true)
    }
  })

  it('reports an uncaught error with the calls that already ran', async () => {
    const failed = failureOf(
      await runCode(
        'execute_read_code',
        `
        await sim.api.listWorkspaces()
        throw new Error('stopped after listing')
        `
      )
    )
    expect(failed.error).toMatchObject({ name: 'Error', message: 'stopped after listing' })
    expect(failed.calls).toEqual([
      expect.objectContaining({ operation: 'listWorkspaces', status: 200 }),
    ])
  })

  it('accepts TypeScript and reports syntax errors on the caller’s line', async () => {
    const typed = await runCode(
      'execute_read_code',
      `
      interface Row { id: string }
      const rows: Row[] = [{ id: 'a' }]
      return rows.map((row): string => row.id)
      `
    )
    expect(typed.structuredContent?.result).toEqual(['a'])

    const broken = await runCode('execute_read_code', 'const a = 1\nconst = 2')
    expect(broken.isError).toBe(true)
    expect(broken.content[0].text).toMatch(/^The program does not parse\.\nLine 2: /)
  })

  it('stops a program at its timeout, at its call cap, and when its result is too large', async () => {
    const timedOut = failureOf(
      await runCode('execute_read_code', 'while (true) {}', { timeoutMs: 1000 })
    )
    expect(timedOut.error.name).toBe('TimeoutError')

    const capped = failureOf(
      await runCode(
        'execute_read_code',
        `
        for (let i = 0; i < 201; i++) {
          try { await sim.api.notAnOperation() } catch (error) { if (error.name !== 'SimApiError') throw error }
        }
        `
      )
    )
    expect(capped.error.message).toContain('at most 200')
    expect(capped.calls).toHaveLength(200)

    const large = failureOf(
      await runCode('execute_read_code', "return 'x'.repeat(2 * 1024 * 1024)")
    )
    expect(large.error.name).toBe('RangeError')
    expect(String(large.error.message)).toContain('at most 1048576')
  })
})
