/**
 * @vitest-environment node
 */

import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listDispatches: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)
vi.mock('@/lib/table/application/runs', () => ({
  listTableDispatches: { operation: { id: 'tables.runs.read' }, execute: mocks.listDispatches },
}))

import { GET } from '@/app/api/v2/tables/[tableId]/dispatches/route'

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
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.listDispatches.mockResolvedValue({ table: { id: 'table-1' }, dispatches: [DISPATCH] })
  })

  it('delegates the canonical table scope and returns the full set', async () => {
    const invocation = list()
    const response = await invocation.response

    expect(response.status).toBe(200)
    expect(mocks.listDispatches).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { tableId: 'table-1', assertedWorkspaceId: WORKSPACE_ID },
      request: invocation.request,
    })
    const body = await response.json()
    expect(body.data).toHaveLength(1)
    expect(body.nextCursor).toBeNull()
  })

  /** The set is dispatcher-bounded, so there is no page for a limit to select. */
  it('rejects pagination parameters this list does not implement', async () => {
    const response = await list(`?workspaceId=${WORKSPACE_ID}&limit=10`).response

    expect(response.status).toBe(400)
    expect(mocks.listDispatches).not.toHaveBeenCalled()
  })
})
