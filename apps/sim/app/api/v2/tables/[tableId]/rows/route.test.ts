/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, MockTableRowsValidationError } = vi.hoisted(() => {
  class MockTableRowsValidationError extends Error {}
  return {
    mocks: {
      authenticate: vi.fn(),
      preauthRate: vi.fn(),
      operationRate: vi.fn(),
      gate: vi.fn(),
      listRows: vi.fn(),
      createRows: vi.fn(),
      updateRows: vi.fn(),
      deleteRows: vi.fn(),
    },
    MockTableRowsValidationError,
  }
})

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: class V2ApiKeyUnauthenticatedError extends Error {},
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mocks.preauthRate
    checkRateLimitDirectOrThrow = mocks.operationRate
  },
  getRateLimit: () => ({ maxTokens: 100, refillRate: 100, refillIntervalMs: 60_000 }),
}))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mocks.gate }))
vi.mock('@/lib/table/application/rows', () => ({
  TableRowsValidationError: MockTableRowsValidationError,
  listTableRows: { operation: { id: 'tables.rows.list' }, execute: mocks.listRows },
  createTableRows: { operation: { id: 'tables.rows.create' }, execute: mocks.createRows },
  updateTableRows: { operation: { id: 'tables.rows.update_many' }, execute: mocks.updateRows },
  deleteTableRows: { operation: { id: 'tables.rows.delete_many' }, execute: mocks.deleteRows },
}))

import { DELETE, GET, PATCH, POST } from '@/app/api/v2/tables/[tableId]/rows/route'

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = {
  kind: 'workspace_api_key' as const,
  workspaceId: WORKSPACE_ID,
  keyId: 'key-1',
}
const AUTH = {
  principal: PRINCIPAL,
  rolloutUserId: 'owner-1',
  rateLimitSubjectIds: [`workspace:${WORKSPACE_ID}`],
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const RATE = {
  allowed: true,
  remaining: 99,
  resetAt: new Date('2026-01-01T01:00:00Z'),
  retryAfterMs: 0,
}
const TABLE = {
  id: 'table-1',
  workspaceId: WORKSPACE_ID,
  schema: { columns: [{ id: 'column-name', name: 'name', type: 'string' as const }] },
}
const ROW = {
  id: 'row-1',
  data: { 'column-name': 'Ada' },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}
const CONTEXT = { params: Promise.resolve({ tableId: 'table-1' }) }

function request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown, query = '') {
  return new NextRequest(`http://localhost/api/v2/tables/table-1/rows${query}`, {
    method,
    headers: {
      'x-api-key': 'secret',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('/api/v2/tables/[tableId]/rows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE)
    mocks.operationRate.mockResolvedValue(RATE)
    mocks.gate.mockResolvedValue(null)
    mocks.listRows.mockResolvedValue({ table: TABLE, rows: [ROW], nextCursor: null })
    mocks.createRows.mockResolvedValue({ kind: 'single', table: TABLE, row: ROW })
    mocks.updateRows.mockResolvedValue({
      table: TABLE,
      affectedCount: 1,
      affectedRowIds: ['row-1'],
    })
    mocks.deleteRows.mockResolvedValue({
      kind: 'ids',
      table: TABLE,
      deletedCount: 1,
      deletedRowIds: ['row-1'],
      requestedCount: 2,
      missingRowIds: ['row-2'],
    })
  })

  it('passes the opaque native row cursor through the route unchanged', async () => {
    const cursor = 'native-row-cursor'
    mocks.listRows.mockResolvedValue({
      table: TABLE,
      rows: [ROW],
      nextCursor: 'next-native-cursor',
    })
    const req = request(
      'GET',
      undefined,
      `?workspaceId=${WORKSPACE_ID}&limit=25&cursor=${encodeURIComponent(cursor)}`
    )
    const response = await GET(req, CONTEXT)

    expect(response.status).toBe(200)
    expect(mocks.listRows).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        tableId: 'table-1',
        assertedWorkspaceId: WORKSPACE_ID,
        limit: 25,
        cursor,
      },
      request: req,
    })
    expect((await response.json()).nextCursor).toBe('next-native-cursor')
  })

  it('delegates single and batch creation through one semantic use case', async () => {
    const single = request('POST', { workspaceId: WORKSPACE_ID, data: { name: 'Ada' } })
    expect((await (await POST(single, CONTEXT)).json()).data.id).toBe('row-1')
    expect(mocks.createRows).toHaveBeenLastCalledWith({
      principal: PRINCIPAL,
      input: {
        kind: 'single',
        tableId: 'table-1',
        assertedWorkspaceId: WORKSPACE_ID,
        data: { name: 'Ada' },
      },
      request: single,
    })

    mocks.createRows.mockResolvedValue({ kind: 'batch', table: TABLE, rows: [ROW] })
    const batch = request('POST', { workspaceId: WORKSPACE_ID, rows: [{ name: 'Ada' }] })
    expect((await (await POST(batch, CONTEXT)).json()).data.insertedCount).toBe(1)
    expect(mocks.createRows).toHaveBeenLastCalledWith({
      principal: PRINCIPAL,
      input: {
        kind: 'batch',
        tableId: 'table-1',
        assertedWorkspaceId: WORKSPACE_ID,
        rows: [{ name: 'Ada' }],
      },
      request: batch,
    })
  })

  it('preserves authoritative bulk update counts including a zero-match result', async () => {
    mocks.updateRows.mockResolvedValue({ table: TABLE, affectedCount: 0, affectedRowIds: [] })
    const req = request('PATCH', {
      workspaceId: WORKSPACE_ID,
      filter: { all: [{ field: 'name', op: 'eq', value: 'missing' }] },
      data: { name: 'Grace' },
    })
    const response = await PATCH(req, CONTEXT)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { updatedCount: 0, updatedRowIds: [] } })
  })

  it('preserves id-delete requested and missing-row reporting', async () => {
    const req = request('DELETE', {
      workspaceId: WORKSPACE_ID,
      rowIds: ['row-1', 'row-2'],
    })
    const response = await DELETE(req, CONTEXT)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        deletedCount: 1,
        deletedRowIds: ['row-1'],
        requestedCount: 2,
        missingRowIds: ['row-2'],
      },
    })
  })
})
