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
      findRows: vi.fn(),
    },
    MockTableRowsValidationError,
  }
})

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)
vi.mock('@/lib/table/application/rows', () => ({
  TableRowsValidationError: MockTableRowsValidationError,
  findTableRows: { operation: { id: 'tables.rows.find' }, execute: mocks.findRows },
}))

import { v2Error } from '@/app/api/v2/lib/response'
import { POST } from '@/app/api/v2/tables/[tableId]/rows/find/route'

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

function call(body: unknown) {
  const request = new NextRequest('http://localhost/api/v2/tables/table-1/rows/find', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
  return {
    request,
    response: POST(request, { params: Promise.resolve({ tableId: 'table-1' }) }),
  }
}

describe('POST /api/v2/tables/[tableId]/rows/find', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.findRows.mockResolvedValue({
      table: TABLE,
      matches: [{ ordinal: 3, rowId: 'row-1', column: 'column-name' }],
      truncated: true,
    })
  })

  it('delegates the bounded lookup and presents column names', async () => {
    const predicate = { all: [{ field: 'name', op: 'eq', value: 'Ada' }] }
    const sort = [{ field: 'name', direction: 'asc' }]
    const invocation = call({ workspaceId: WORKSPACE_ID, q: 'ada', predicate, sort })
    const response = await invocation.response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        matches: [{ ordinal: 3, rowId: 'row-1', column: 'name' }],
        truncated: true,
      },
    })
    expect(mocks.findRows).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        tableId: 'table-1',
        assertedWorkspaceId: WORKSPACE_ID,
        q: 'ada',
        predicate,
        sort,
      },
      request: invocation.request,
    })
  })

  it('rejects an empty search after admission and before delegation', async () => {
    const response = await call({ workspaceId: WORKSPACE_ID, q: '' }).response

    expect(response.status).toBe(400)
    expect(v2RouteMocks.authenticate).toHaveBeenCalledOnce()
    expect(mocks.findRows).not.toHaveBeenCalled()
  })

  it('stops at the rollout gate before the shared use case', async () => {
    v2RouteMocks.gate.mockResolvedValue(v2Error('NOT_FOUND', 'Not found'))

    const response = await call({ workspaceId: WORKSPACE_ID, q: 'ada' }).response

    expect(response.status).toBe(404)
    expect(mocks.findRows).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await call({ workspaceId: WORKSPACE_ID, q: 'ada' }).response

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })
})
