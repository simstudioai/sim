import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { tableApplicationRowsMock } from '@sim/testing/mocks/table-application-rows.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancelRuns: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/table/application/rows', () => tableApplicationRowsMock)
vi.mock('@/lib/table/application/runs', () => ({
  cancelTableRuns: { operation: { id: 'tables.runs.cancel' }, execute: mocks.cancelRuns },
}))

import { POST } from '@/app/api/v2/tables/[tableId]/cancel-runs/route'

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

function call(body: unknown) {
  const request = new NextRequest('http://localhost/api/v2/tables/table-1/cancel-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
  return {
    request,
    response: POST(request, { params: Promise.resolve({ tableId: 'table-1' }) }),
  }
}

describe('POST /api/v2/tables/[tableId]/cancel-runs', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.cancelRuns.mockResolvedValue({ table: { id: 'table-1' }, cancelled: 4 })
  })

  it('delegates one canonical row scope without select-all fields', async () => {
    const invocation = call({ workspaceId: WORKSPACE_ID, scope: 'row', rowId: 'row-1' })
    const response = await invocation.response

    expect(response.status).toBe(200)
    expect(mocks.cancelRuns).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        scope: 'row',
        tableId: 'table-1',
        assertedWorkspaceId: WORKSPACE_ID,
        rowId: 'row-1',
      },
      request: invocation.request,
    })
  })

  it('rejects an incomplete or contradictory row scope before delegation', async () => {
    const missing = await call({ workspaceId: WORKSPACE_ID, scope: 'row' }).response
    const contradictory = await call({
      workspaceId: WORKSPACE_ID,
      scope: 'row',
      rowId: 'row-1',
      filter: { all: [{ field: 'status', op: 'eq', value: 'ready' }] },
    }).response

    expect(missing.status).toBe(400)
    expect(contradictory.status).toBe(400)
    expect(mocks.cancelRuns).not.toHaveBeenCalled()
  })
})
