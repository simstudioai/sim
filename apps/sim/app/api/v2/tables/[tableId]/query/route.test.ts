/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, MockTableRowsValidationError } = vi.hoisted(() => {
  class MockTableRowsValidationError extends Error {
    constructor(
      message: string,
      readonly details?: unknown
    ) {
      super(message)
    }
  }
  return {
    mocks: {
      authenticate: vi.fn(),
      preauthRate: vi.fn(),
      operationRate: vi.fn(),
      gate: vi.fn(),
      queryRows: vi.fn(),
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
  queryTableRows: { operation: { id: 'tables.rows.query' }, execute: mocks.queryRows },
}))

import { POST } from '@/app/api/v2/tables/[tableId]/query/route'

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
const ROW = {
  id: 'row-1',
  data: { 'column-name': 'Ada' },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}

function call(body: unknown) {
  const request = new NextRequest('http://localhost/api/v2/tables/table-1/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
  return {
    request,
    response: POST(request, { params: Promise.resolve({ tableId: 'table-1' }) }),
  }
}

describe('POST /api/v2/tables/[tableId]/query', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE)
    mocks.operationRate.mockResolvedValue(RATE)
    mocks.gate.mockResolvedValue(null)
    mocks.queryRows.mockResolvedValue({ table: TABLE, rows: [ROW], nextCursor: null })
  })

  it('delegates the typed query and preserves the public row envelope', async () => {
    const predicate = { all: [{ field: 'name', op: 'eq', value: 'Ada' }] }
    const invocation = call({ workspaceId: WORKSPACE_ID, predicate })
    const response = await invocation.response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [
        {
          id: 'row-1',
          data: { name: 'Ada' },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    })
    expect(mocks.queryRows).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        tableId: 'table-1',
        assertedWorkspaceId: WORKSPACE_ID,
        predicate,
        sort: undefined,
        cursor: undefined,
        limit: 100,
        includeTotal: false,
      },
      request: invocation.request,
    })
  })

  it('preserves explicit limit=0 as the unbounded opt-in', async () => {
    await call({ workspaceId: WORKSPACE_ID, limit: 0 }).response

    expect(mocks.queryRows).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ limit: undefined }) })
    )
  })

  it('rejects an invalid page limit after admission and before delegation', async () => {
    const response = await call({ workspaceId: WORKSPACE_ID, limit: 5000 }).response

    expect(response.status).toBe(400)
    expect(mocks.authenticate).toHaveBeenCalledOnce()
    expect(mocks.operationRate).toHaveBeenCalledOnce()
    expect(mocks.queryRows).not.toHaveBeenCalled()
  })

  it('keeps malformed POST query cursors as a structured 400', async () => {
    mocks.queryRows.mockRejectedValue(
      new MockTableRowsValidationError('Invalid cursor', { code: 'INVALID_CURSOR' })
    )

    const response = await call({ workspaceId: WORKSPACE_ID, cursor: 'malformed' }).response

    expect(response.status).toBe(400)
    expect((await response.json()).error.details).toEqual({ code: 'INVALID_CURSOR' })
  })

  it('enforces the one MiB body cap before delegation', async () => {
    const response = await call({ workspaceId: WORKSPACE_ID, cursor: 'x'.repeat(1024 * 1024) })
      .response

    expect(response.status).toBe(413)
    expect(mocks.queryRows).not.toHaveBeenCalled()
  })
})
