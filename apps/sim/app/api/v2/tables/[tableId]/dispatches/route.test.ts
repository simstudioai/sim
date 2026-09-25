import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, MockTableRowsValidationError } = vi.hoisted(() => {
  class MockTableRowsValidationError extends Error {}
  return {
    mocks: { listDispatches: vi.fn(), startRun: vi.fn() },
    MockTableRowsValidationError,
  }
})

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/table/application/rows', () => ({
  TableRowsValidationError: MockTableRowsValidationError,
}))
vi.mock('@/lib/table/application/runs', () => ({
  listTableDispatches: { operation: { id: 'tables.runs.read' }, execute: mocks.listDispatches },
  startTableRun: { operation: { id: 'tables.runs.start' }, execute: mocks.startRun },
}))

import { POST } from '@/app/api/v2/tables/[tableId]/dispatches/route'

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
function create(body: unknown) {
  const request = new NextRequest('http://localhost/api/v2/tables/table-1/dispatches', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
  return {
    request,
    response: POST(request, { params: Promise.resolve({ tableId: 'table-1' }) }),
  }
}

/**
 * The create moved here from `POST /columns/run`: it mints the resource this path already
 * lists, gets, and cancels, so all four verbs now name the same thing.
 */
describe('POST /api/v2/tables/[tableId]/dispatches', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.startRun.mockResolvedValue({ table: { id: 'table-1' }, dispatchId: 'dispatch-1' })
  })

  it('delegates the bounded run selection and presents the dispatch id', async () => {
    const predicate = { all: [{ field: 'status', op: 'eq', value: 'ready' }] }
    const invocation = create({
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

  it('rejects mutually exclusive row and filter scopes before delegation', async () => {
    const response = await create({
      workspaceId: WORKSPACE_ID,
      groupIds: ['group-1'],
      rowIds: ['row-1'],
      filter: { all: [{ field: 'status', op: 'eq', value: 'ready' }] },
    }).response

    expect(response.status).toBe(400)
    expect(mocks.startRun).not.toHaveBeenCalled()
  })
})
