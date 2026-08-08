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
      upsertRow: vi.fn(),
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
  upsertTableRow: { operation: { id: 'tables.rows.upsert' }, execute: mocks.upsertRow },
}))

import { POST } from '@/app/api/v2/tables/[tableId]/rows/upsert/route'

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
  schema: { columns: [{ id: 'column-email', name: 'email', type: 'string' as const }] },
}
const ROW = {
  id: 'row-1',
  data: { 'column-email': 'ada@example.com' },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}

describe('POST /api/v2/tables/[tableId]/rows/upsert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE)
    mocks.operationRate.mockResolvedValue(RATE)
    mocks.gate.mockResolvedValue(null)
    mocks.upsertRow.mockResolvedValue({ table: TABLE, row: ROW, operation: 'update' })
  })

  it('delegates the public conflict-target name unchanged for canonical ID resolution', async () => {
    const request = new NextRequest('http://localhost/api/v2/tables/table-1/rows/upsert', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        data: { email: 'ada@example.com' },
        conflictTarget: 'email',
      }),
    })
    const response = await POST(request, {
      params: Promise.resolve({ tableId: 'table-1' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        row: {
          id: 'row-1',
          data: { email: 'ada@example.com' },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
        operation: 'update',
      },
    })
    expect(mocks.upsertRow).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        tableId: 'table-1',
        assertedWorkspaceId: WORKSPACE_ID,
        data: { email: 'ada@example.com' },
        conflictTarget: 'email',
      },
      request,
    })
  })

  it('rejects an empty conflict target before delegation', async () => {
    const request = new NextRequest('http://localhost/api/v2/tables/table-1/rows/upsert', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        data: { email: 'ada@example.com' },
        conflictTarget: '',
      }),
    })
    const response = await POST(request, {
      params: Promise.resolve({ tableId: 'table-1' }),
    })

    expect(response.status).toBe(400)
    expect(mocks.upsertRow).not.toHaveBeenCalled()
  })
})
