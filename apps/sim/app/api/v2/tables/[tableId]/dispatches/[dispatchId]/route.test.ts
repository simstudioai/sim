import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ readDispatch: vi.fn(), cancelDispatch: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/table/application/runs', () => ({
  readTableDispatch: { operation: { id: 'tables.runs.read' }, execute: mocks.readDispatch },
  cancelTableDispatch: { operation: { id: 'tables.runs.cancel' }, execute: mocks.cancelDispatch },
}))

import { GET } from '@/app/api/v2/tables/[tableId]/dispatches/[dispatchId]/route'

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

function dispatch(status: 'pending' | 'dispatching' | 'complete' | 'cancelled') {
  return {
    id: 'dispatch-1',
    tableId: 'table-1',
    workspaceId: WORKSPACE_ID,
    requestId: 'request-1',
    mode: 'all' as const,
    scope: { groupIds: ['group-1'] },
    status,
    cursor: 42,
    limit: null,
    processedCount: 3,
    isManualRun: true,
    triggeredByUserId: 'user-1',
    requestedAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: status === 'complete' ? new Date('2026-01-01T00:01:00Z') : null,
    cancelledAt: status === 'cancelled' ? new Date('2026-01-01T00:02:00Z') : null,
  }
}

const PATH = 'http://localhost/api/v2/tables/table-1/dispatches/dispatch-1'
const PARAMS = { tableId: 'table-1', dispatchId: 'dispatch-1' }

function read(query = `?workspaceId=${WORKSPACE_ID}`) {
  const request = new NextRequest(`${PATH}${query}`, {
    method: 'GET',
    headers: { 'x-api-key': 'secret' },
  })
  return {
    request,
    response: GET(request, { params: Promise.resolve(PARAMS) }),
  }
}

describe('GET /api/v2/tables/[tableId]/dispatches/[dispatchId]', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.readDispatch.mockResolvedValue({ dispatch: dispatch('dispatching') })
    mocks.cancelDispatch.mockResolvedValue({ dispatch: dispatch('cancelled') })
  })

  /**
   * The regression this route exists to avoid: the first-party active-dispatch
   * schema stops at the in-flight states, and v2 parses responses outbound, so
   * a poller reaching the state it was waiting for would have got a 500.
   */
  it.each([
    ['pending', 'pending'],
    ['dispatching', 'dispatching'],
    ['complete', 'complete'],
    /** Stored with two `l`s; published with one, like every other table status. */
    ['cancelled', 'canceled'],
  ] as const)('answers 200 for a %s dispatch', async (stored, published) => {
    mocks.readDispatch.mockResolvedValue({ dispatch: dispatch(stored) })

    const response = await read().response

    expect(response.status).toBe(200)
    expect((await response.json()).data.status).toBe(published)
  })
})
