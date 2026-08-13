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

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]/route'

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
  const request = new NextRequest(
    'http://localhost/api/v2/tables/table-1/rows/row-1/enrichment/group-1',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
      body: JSON.stringify(body),
    }
  )
  return {
    request,
    response: POST(request, {
      params: Promise.resolve({ tableId: 'table-1', rowId: 'row-1', groupId: 'group-1' }),
    }),
  }
}

describe('POST /api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.startRun.mockResolvedValue({ table: { id: 'table-1' }, dispatchId: 'dispatch-1' })
  })

  it('delegates the canonical row and group path scope', async () => {
    const invocation = call({ workspaceId: WORKSPACE_ID })
    const response = await invocation.response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { dispatchId: 'dispatch-1' } })
    expect(mocks.startRun).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        kind: 'row_enrichment',
        tableId: 'table-1',
        rowId: 'row-1',
        groupId: 'group-1',
        assertedWorkspaceId: WORKSPACE_ID,
      },
      request: invocation.request,
    })
  })

  it('preserves a null dispatch id instead of inventing one', async () => {
    mocks.startRun.mockResolvedValue({ table: { id: 'table-1' }, dispatchId: null })

    const response = await call({ workspaceId: WORKSPACE_ID }).response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { dispatchId: null } })
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await call({ workspaceId: WORKSPACE_ID }).response

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })

  it('rejects a missing workspace before delegation', async () => {
    const response = await call({}).response

    expect(response.status).toBe(400)
    expect(mocks.startRun).not.toHaveBeenCalled()
  })

  it('conceals canonical row or group lookup failures', async () => {
    mocks.startRun.mockRejectedValue(new OrchestrationError('not_found', 'Row not found'))

    const response = await call({ workspaceId: WORKSPACE_ID }).response

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })
})
