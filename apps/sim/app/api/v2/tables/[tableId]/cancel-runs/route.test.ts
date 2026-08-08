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
      cancelRuns: vi.fn(),
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
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE)
    mocks.operationRate.mockResolvedValue(RATE)
    mocks.gate.mockResolvedValue(null)
    mocks.cancelRuns.mockResolvedValue({ table: { id: 'table-1' }, cancelled: 4 })
  })

  it('delegates a filtered all-scope cancellation and reports the authoritative count', async () => {
    const predicate = { all: [{ field: 'status', op: 'eq', value: 'ready' }] }
    const invocation = call({
      workspaceId: WORKSPACE_ID,
      scope: 'all',
      filter: predicate,
      excludeRowIds: ['row-2'],
    })
    const response = await invocation.response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { cancelled: 4 } })
    expect(mocks.cancelRuns).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        scope: 'all',
        tableId: 'table-1',
        assertedWorkspaceId: WORKSPACE_ID,
        predicate,
        excludeRowIds: ['row-2'],
      },
      request: invocation.request,
    })
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

  it('preserves an authoritative zero-cancellation result', async () => {
    mocks.cancelRuns.mockResolvedValue({ table: { id: 'table-1' }, cancelled: 0 })

    const response = await call({ workspaceId: WORKSPACE_ID, scope: 'all' }).response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { cancelled: 0 } })
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
