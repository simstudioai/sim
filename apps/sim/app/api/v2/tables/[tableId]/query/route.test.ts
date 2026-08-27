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

import { v2QueryRowsContract } from '@/lib/api/contracts/v2/tables'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { encodeScopedCursor } from '@/app/api/v2/lib/response'
import { POST } from '@/app/api/v2/tables/[tableId]/query/route'

/** A query cursor exactly as the route mints one, for the table given. */
function queryCursor(tableId: string, inner: string): string {
  return encodeScopedCursor(cursorScopeKey(cursorRoute(v2QueryRowsContract, { tableId })), inner)
}

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
  const request = new NextRequest('http://localhost/api/v2/tables/table-1/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
  return {
    request,
    response: POST(request, { params: Promise.resolve({ tableId: 'table-1' }) }),
  }
}

describe('POST /api/v2/tables/[tableId]/query', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.queryRows.mockResolvedValue({ table: TABLE, rows: [ROW], nextCursor: null })
  })

  it('delegates the typed query and preserves the public row envelope', async () => {
    const predicate = { all: [{ field: 'name', op: 'eq', value: 'Ada' }] }
    const invocation = call({ workspaceId: WORKSPACE_ID, predicate })
    const response = await invocation.response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [
        {
          id: 'row-1',
          data: { name: 'Ada' },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    })
    expect(mocks.queryRows).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        tableId: 'table-1',
        assertedWorkspaceId: WORKSPACE_ID,
        predicate,
        sort: undefined,
        cursor: undefined,
        limit: 100,
        includeTotal: false,
        includeRunState: false,
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

  it('queries every row when the predicate is omitted', async () => {
    const invocation = call({ workspaceId: WORKSPACE_ID })
    const response = await invocation.response

    expect(response.status).toBe(200)
    expect(mocks.queryRows).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        tableId: 'table-1',
        assertedWorkspaceId: WORKSPACE_ID,
        predicate: undefined,
        sort: undefined,
        cursor: undefined,
        limit: 100,
        includeTotal: false,
        includeRunState: false,
      },
      request: invocation.request,
    })
  })

  it('preserves explicit limit=0 as the unbounded opt-in', async () => {
    await call({ workspaceId: WORKSPACE_ID, limit: 0 }).response

    expect(mocks.queryRows).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ limit: undefined }) })
    )
  })

  it('rejects a v1-shaped filter key instead of answering with an unfiltered page', async () => {
    const response = await call({
      workspaceId: WORKSPACE_ID,
      filter: { name: { $eq: 'Ada' } },
    }).response

    expect(response.status).toBe(400)
    expect(mocks.queryRows).not.toHaveBeenCalled()
  })

  it('rejects an invalid page limit after admission and before delegation', async () => {
    const response = await call({ workspaceId: WORKSPACE_ID, limit: 5000 }).response

    expect(response.status).toBe(400)
    expect(v2RouteMocks.authenticate).toHaveBeenCalledOnce()
    expect(v2RouteMocks.operationRate).toHaveBeenCalledTimes(AUTH.rateLimitSubjectIds.length)
    expect(mocks.queryRows).not.toHaveBeenCalled()
  })

  it('keeps malformed POST query cursors as a structured 400', async () => {
    mocks.queryRows.mockRejectedValue(
      new MockTableRowsValidationError('Invalid cursor', { code: 'INVALID_CURSOR' })
    )

    const response = await call({
      workspaceId: WORKSPACE_ID,
      cursor: queryCursor('table-1', 'malformed'),
    }).response

    expect(response.status).toBe(400)
    expect((await response.json()).error.details).toEqual({ code: 'INVALID_CURSOR' })
  })

  /**
   * The row codec binds the predicate and sort a page was produced under but
   * carries no table identity, so an unfiltered token from one table decoded
   * cleanly against another and answered 200 with that other table's rows.
   */
  it('refuses a query cursor minted on a different table', async () => {
    const response = await call({
      workspaceId: WORKSPACE_ID,
      cursor: queryCursor('table-2', 'native-row-cursor'),
    }).response

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toMatch(/requested filters/)
    expect(mocks.queryRows).not.toHaveBeenCalled()
  })

  it('enforces the one MiB body cap before delegation', async () => {
    const response = await call({ workspaceId: WORKSPACE_ID, cursor: 'x'.repeat(1024 * 1024) })
      .response

    expect(response.status).toBe(413)
    expect(mocks.queryRows).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await call({ workspaceId: WORKSPACE_ID }).response

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })
})
