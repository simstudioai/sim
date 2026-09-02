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

import { GET, POST } from '@/app/api/v2/tables/[tableId]/dispatches/route'

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
const DISPATCH = {
  id: 'dispatch-1',
  tableId: 'table-1',
  workspaceId: WORKSPACE_ID,
  requestId: 'request-1',
  mode: 'incomplete' as const,
  scope: { groupIds: ['group-1'], rowIds: ['row-1'] },
  status: 'pending' as const,
  cursor: 0,
  limit: { type: 'rows' as const, max: 100 },
  processedCount: 0,
  isManualRun: false,
  triggeredByUserId: null,
  requestedAt: new Date('2026-01-01T00:00:00Z'),
  completedAt: null,
  cancelledAt: null,
}
const COMPLETED_DISPATCH = {
  ...DISPATCH,
  id: 'dispatch-2',
  status: 'complete' as const,
  processedCount: 13,
  requestedAt: new Date('2026-01-01T00:10:00Z'),
  completedAt: new Date('2026-01-01T00:12:00Z'),
}

function list(query = `?workspaceId=${WORKSPACE_ID}`) {
  const request = new NextRequest(`http://localhost/api/v2/tables/table-1/dispatches${query}`, {
    method: 'GET',
    headers: { 'x-api-key': 'secret' },
  })
  return {
    request,
    response: GET(request, { params: Promise.resolve({ tableId: 'table-1' }) }),
  }
}

describe('GET /api/v2/tables/[tableId]/dispatches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.listDispatches.mockResolvedValue({
      table: { id: 'table-1' },
      dispatches: [COMPLETED_DISPATCH, DISPATCH],
    })
    mocks.startRun.mockResolvedValue({ table: { id: 'table-1' }, dispatchId: 'dispatch-1' })
  })

  /**
   * Settled dispatches are part of the set: a run that completed between two
   * polls must still show up next to the `dispatchId` its create returned.
   */
  it('delegates the canonical table scope and returns the full set, settled dispatches included', async () => {
    const invocation = list()
    const response = await invocation.response

    expect(response.status).toBe(200)
    expect(mocks.listDispatches).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { tableId: 'table-1', assertedWorkspaceId: WORKSPACE_ID },
      request: invocation.request,
    })
    const body = await response.json()
    expect(body.data.map((dispatch: { id: string; status: string }) => dispatch.status)).toEqual([
      'complete',
      'pending',
    ])
    expect(body.data[0]).toMatchObject({ id: 'dispatch-2', processedCount: 13 })
    expect(body.nextCursor).toBeNull()
  })

  /** The set is capped by the use case, so there is no page for a limit to select. */
  it('rejects pagination parameters this list does not implement', async () => {
    const response = await list(`?workspaceId=${WORKSPACE_ID}&limit=10`).response

    expect(response.status).toBe(400)
    expect(mocks.listDispatches).not.toHaveBeenCalled()
  })
})

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
    vi.clearAllMocks()
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

  it('preserves an authoritative null dispatch as a no-op', async () => {
    mocks.startRun.mockResolvedValue({ table: { id: 'table-1' }, dispatchId: null })

    const response = await create({
      workspaceId: WORKSPACE_ID,
      groupIds: ['group-1'],
    }).response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { dispatchId: null } })
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

  it('rejects an empty group selection before delegation', async () => {
    const response = await create({ workspaceId: WORKSPACE_ID, groupIds: [] }).response

    expect(response.status).toBe(400)
    expect(mocks.startRun).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await create({ workspaceId: WORKSPACE_ID, groupIds: ['group-1'] }).response

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })
})
