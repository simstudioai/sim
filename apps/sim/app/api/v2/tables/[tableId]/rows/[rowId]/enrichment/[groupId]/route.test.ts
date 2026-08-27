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
    mocks: {
      startRun: vi.fn(),
      readEnrichment: vi.fn(),
    },
    MockTableRowsValidationError,
  }
})

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/table/application/rows', () => ({
  TableRowsValidationError: MockTableRowsValidationError,
  readTableRowEnrichmentDetail: {
    operation: { id: 'tables.rows.read' },
    execute: mocks.readEnrichment,
  },
}))
vi.mock('@/lib/table/application/runs', () => ({
  startTableRun: { operation: { id: 'tables.runs.start' }, execute: mocks.startRun },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET, POST } from '@/app/api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]/route'

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

describe('GET /api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]', () => {
  const DETAIL = {
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:02.000Z',
    durationMs: 2000,
    totalCost: 0.02,
    matchedProvider: 'hunter',
    aborted: false,
    providers: [
      {
        id: 'hunter',
        label: 'Hunter',
        toolId: 'hunter_find_email',
        status: 'matched' as const,
        cost: 0.02,
        durationMs: 2000,
        error: null,
      },
    ],
  }

  function read() {
    const request = new NextRequest(
      `http://localhost/api/v2/tables/table-1/rows/row-1/enrichment/group-1?workspaceId=${WORKSPACE_ID}`,
      { method: 'GET', headers: { 'x-api-key': 'secret' } }
    )
    return {
      request,
      response: GET(request, {
        params: Promise.resolve({ tableId: 'table-1', rowId: 'row-1', groupId: 'group-1' }),
      }),
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.readEnrichment.mockResolvedValue({ table: { id: 'table-1' }, detail: DETAIL })
  })

  it('delegates the canonical row and group scope and publishes the cascade', async () => {
    const invocation = read()
    const response = await invocation.response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: DETAIL })
    expect(mocks.readEnrichment).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        tableId: 'table-1',
        rowId: 'row-1',
        groupId: 'group-1',
        assertedWorkspaceId: WORKSPACE_ID,
      },
      request: invocation.request,
    })
  })

  /** A cell that never ran is a real answer, not a missing resource. */
  it('answers null for a cell with no recorded run', async () => {
    mocks.readEnrichment.mockResolvedValue({ table: { id: 'table-1' }, detail: null })

    const response = await read().response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: null })
  })

  it('rejects an unauthenticated read', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await read().response

    expect(response.status).toBe(401)
    expect(mocks.readEnrichment).not.toHaveBeenCalled()
  })
})
