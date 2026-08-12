/**
 * @vitest-environment node
 */

import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, MockTableRowsValidationError } = vi.hoisted(() => {
  class MockTableRowsValidationError extends Error {}
  return {
    mocks: {
      listRows: vi.fn(),
      createRows: vi.fn(),
      updateRows: vi.fn(),
      deleteRows: vi.fn(),
    },
    MockTableRowsValidationError,
  }
})

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)
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
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`],
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
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
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
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

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await GET(
      request('GET', undefined, `?workspaceId=${WORKSPACE_ID}&limit=25`),
      CONTEXT
    )

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })

  it('delegates single and batch creation through one semantic use case', async () => {
    const single = request('POST', { workspaceId: WORKSPACE_ID, data: { name: 'Ada' } })
    const singleResponse = await POST(single, CONTEXT)
    // 201 on both arms: every v2 create answers the same status, batch included.
    expect(singleResponse.status).toBe(201)
    expect((await singleResponse.json()).data.id).toBe('row-1')
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
    const batchResponse = await POST(batch, CONTEXT)
    expect(batchResponse.status).toBe(201)
    expect((await batchResponse.json()).data.insertedCount).toBe(1)
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
