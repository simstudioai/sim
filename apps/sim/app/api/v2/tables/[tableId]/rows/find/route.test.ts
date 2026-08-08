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
      findRows: vi.fn(),
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
  findTableRows: { operation: { id: 'tables.rows.find' }, execute: mocks.findRows },
}))

import { POST } from '@/app/api/v2/tables/[tableId]/rows/find/route'

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
const TABLE = {
  id: 'table-1',
  workspaceId: WORKSPACE_ID,
  schema: { columns: [{ id: 'column-name', name: 'name', type: 'string' as const }] },
}

function call(body: unknown) {
  const request = new NextRequest('http://localhost/api/v2/tables/table-1/rows/find', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
  return {
    request,
    response: POST(request, { params: Promise.resolve({ tableId: 'table-1' }) }),
  }
}

describe('POST /api/v2/tables/[tableId]/rows/find', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE)
    mocks.operationRate.mockResolvedValue(RATE)
    mocks.gate.mockResolvedValue(null)
    mocks.findRows.mockResolvedValue({
      table: TABLE,
      matches: [{ ordinal: 3, rowId: 'row-1', column: 'column-name' }],
      truncated: true,
    })
  })

  it('delegates the bounded lookup and presents column names', async () => {
    const predicate = { all: [{ field: 'name', op: 'eq', value: 'Ada' }] }
    const sort = [{ field: 'name', direction: 'asc' }]
    const invocation = call({ workspaceId: WORKSPACE_ID, q: 'ada', predicate, sort })
    const response = await invocation.response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        matches: [{ ordinal: 3, rowId: 'row-1', column: 'name' }],
        truncated: true,
      },
    })
    expect(mocks.findRows).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        tableId: 'table-1',
        assertedWorkspaceId: WORKSPACE_ID,
        q: 'ada',
        predicate,
        sort,
      },
      request: invocation.request,
    })
  })

  it('rejects an empty search after admission and before delegation', async () => {
    const response = await call({ workspaceId: WORKSPACE_ID, q: '' }).response

    expect(response.status).toBe(400)
    expect(mocks.authenticate).toHaveBeenCalledOnce()
    expect(mocks.findRows).not.toHaveBeenCalled()
  })

  it('stops at the rollout gate before the shared use case', async () => {
    const { v2Error } = await import('@/app/api/v2/lib/response')
    mocks.gate.mockResolvedValue(v2Error('NOT_FOUND', 'Not found'))

    const response = await call({ workspaceId: WORKSPACE_ID, q: 'ada' }).response

    expect(response.status).toBe(404)
    expect(mocks.findRows).not.toHaveBeenCalled()
  })
})
