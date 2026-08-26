/**
 * @vitest-environment node
 */

import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, MockTableRowsValidationError } = vi.hoisted(() => {
  class MockTableRowsValidationError extends Error {
    constructor(
      message: string,
      readonly details?: unknown
    ) {
      super(message)
    }
  }
  return {
    mocks: {
      queryRows: vi.fn(),
    },
    MockTableRowsValidationError,
  }
})

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/table/application/rows', () => ({
  TableRowsValidationError: MockTableRowsValidationError,
  queryTableRows: { operation: { id: 'tables.rows.query' }, execute: mocks.queryRows },
}))

import { POST } from '@/app/api/v2/tables/[tableId]/query/count/route'

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = {
  kind: 'workspace_api_key' as const,
  workspaceId: WORKSPACE_ID,
  keyId: 'key-1',
}
const AUTH = {
  principal: PRINCIPAL,
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

function call(body: unknown) {
  const request = new NextRequest('http://localhost/api/v2/tables/table-1/query/count', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
  return {
    request,
    response: POST(request, { params: Promise.resolve({ tableId: 'table-1' }) }),
  }
}

describe('POST /api/v2/tables/[tableId]/query/count', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.queryRows.mockResolvedValue({
      table: TABLE,
      rows: [ROW],
      rowCount: 1,
      totalCount: 4321,
      nextCursor: 'cursor-1',
    })
  })

  it('counts the predicate matches across the whole table, not the page', async () => {
    const predicate = { all: [{ field: 'name', op: 'eq', value: 'Ada' }] }
    const invocation = call({ workspaceId: WORKSPACE_ID, predicate })
    const response = await invocation.response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { totalCount: 4321 } })
    expect(mocks.queryRows).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        tableId: 'table-1',
        assertedWorkspaceId: WORKSPACE_ID,
        predicate,
        limit: 1,
        includeTotal: true,
      },
      request: invocation.request,
    })
  })

  it('normalizes a plain condition into a predicate group', async () => {
    const condition = { field: 'phone', op: 'isEmpty' }
    const invocation = call({ workspaceId: WORKSPACE_ID, predicate: condition })
    const response = await invocation.response

    expect(response.status).toBe(200)
    expect(mocks.queryRows).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ predicate: { all: [condition] } }),
      })
    )
  })

  it('counts the whole table when no predicate is sent', async () => {
    mocks.queryRows.mockResolvedValue({
      table: TABLE,
      rows: [],
      rowCount: 0,
      totalCount: 0,
      nextCursor: null,
    })

    const response = await call({ workspaceId: WORKSPACE_ID }).response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { totalCount: 0 } })
    expect(mocks.queryRows).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ predicate: undefined }) })
    )
  })

  it('rejects the paging controls a count has no use for', async () => {
    const response = await call({ workspaceId: WORKSPACE_ID, limit: 10, cursor: 'x' }).response

    expect(response.status).toBe(400)
    expect(mocks.queryRows).not.toHaveBeenCalled()
  })

  it('keeps a malformed predicate as a structured 400', async () => {
    mocks.queryRows.mockRejectedValue(
      new MockTableRowsValidationError('Unknown column "nope"', { code: 'INVALID_PREDICATE' })
    )

    const response = await call({
      workspaceId: WORKSPACE_ID,
      predicate: { all: [{ field: 'nope', op: 'eq', value: 1 }] },
    }).response

    expect(response.status).toBe(400)
    expect((await response.json()).error.details).toEqual({ code: 'INVALID_PREDICATE' })
  })

  it('never presents a fabricated zero when no total was computed', async () => {
    mocks.queryRows.mockResolvedValue({
      table: TABLE,
      rows: [ROW],
      rowCount: 1,
      totalCount: null,
      nextCursor: null,
    })

    const response = await call({ workspaceId: WORKSPACE_ID }).response

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await call({ workspaceId: WORKSPACE_ID }).response

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })
})
