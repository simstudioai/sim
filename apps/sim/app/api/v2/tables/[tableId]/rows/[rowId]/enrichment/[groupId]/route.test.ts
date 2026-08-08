/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, MockTableRowsValidationError } = vi.hoisted(() => {
  class MockTableRowsValidationError extends Error {}
  return {
    mocks: {
      authenticate: vi.fn(),
      preauthRate: vi.fn(),
      operationRate: vi.fn(),
      gate: vi.fn(),
      startRun: vi.fn(),
    },
    MockTableRowsValidationError,
  }
})

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: class V2ApiKeyUnauthenticatedError extends Error {},
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mocks.preauthRate
    checkRateLimitDirectOrThrow = mocks.operationRate
  },
  getRateLimit: () => ({ maxTokens: 100, refillRate: 100, refillIntervalMs: 60_000 }),
}))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mocks.gate }))
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
  rateLimitSubjectIds: [`workspace:${WORKSPACE_ID}`],
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const RATE = {
  allowed: true,
  remaining: 99,
  resetAt: new Date('2026-01-01T01:00:00Z'),
  retryAfterMs: 0,
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
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE)
    mocks.operationRate.mockResolvedValue(RATE)
    mocks.gate.mockResolvedValue(null)
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
