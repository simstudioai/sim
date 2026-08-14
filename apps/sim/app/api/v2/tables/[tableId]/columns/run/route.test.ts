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
      startRun: vi.fn(),
    },
    MockTableRowsValidationError,
  }
})

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)
vi.mock('@/lib/table/application/rows', () => ({
  TableRowsValidationError: MockTableRowsValidationError,
}))
vi.mock('@/lib/table/application/runs', () => ({
  startTableRun: { operation: { id: 'tables.runs.start' }, execute: mocks.startRun },
}))

import { POST } from '@/app/api/v2/tables/[tableId]/columns/run/route'

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

function call(body: unknown) {
  const request = new NextRequest('http://localhost/api/v2/tables/table-1/columns/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
  return {
    request,
    response: POST(request, { params: Promise.resolve({ tableId: 'table-1' }) }),
  }
}

describe('POST /api/v2/tables/[tableId]/columns/run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.startRun.mockResolvedValue({ table: { id: 'table-1' }, dispatchId: 'dispatch-1' })
  })

  it('delegates the bounded run selection and presents the dispatch id', async () => {
    const predicate = { all: [{ field: 'status', op: 'eq', value: 'ready' }] }
    const invocation = call({
      workspaceId: WORKSPACE_ID,
      groupIds: ['group-1'],
      runMode: 'incomplete',
      filter: predicate,
      excludeRowIds: ['row-2'],
      limit: { type: 'rows', max: 25 },
    })
    const response = await invocation.response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { dispatchId: 'dispatch-1' } })
    expect(mocks.startRun).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        kind: 'selection',
        tableId: 'table-1',
        assertedWorkspaceId: WORKSPACE_ID,
        groupIds: ['group-1'],
        mode: 'incomplete',
        rowIds: undefined,
        predicate,
        excludeRowIds: ['row-2'],
        limit: { type: 'rows', max: 25 },
      },
      request: invocation.request,
    })
  })

  it('preserves an authoritative null dispatch as a no-op', async () => {
    mocks.startRun.mockResolvedValue({ table: { id: 'table-1' }, dispatchId: null })

    const response = await call({
      workspaceId: WORKSPACE_ID,
      groupIds: ['group-1'],
    }).response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { dispatchId: null } })
  })

  it('rejects mutually exclusive row and filter scopes before delegation', async () => {
    const response = await call({
      workspaceId: WORKSPACE_ID,
      groupIds: ['group-1'],
      rowIds: ['row-1'],
      filter: { all: [{ field: 'status', op: 'eq', value: 'ready' }] },
    }).response

    expect(response.status).toBe(400)
    expect(mocks.startRun).not.toHaveBeenCalled()
  })

  it('rejects an empty group selection before delegation', async () => {
    const response = await call({ workspaceId: WORKSPACE_ID, groupIds: [] }).response

    expect(response.status).toBe(400)
    expect(mocks.startRun).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await call({ workspaceId: WORKSPACE_ID, groupIds: ['group-1'] }).response

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })
})
