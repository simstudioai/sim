/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  preauthRate: vi.fn(),
  operationRate: vi.fn(),
  gate: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

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
vi.mock('@/lib/table/application/columns', () => ({
  addTableColumnUseCase: { operation: { id: 'tables.columns.add' }, execute: mocks.add },
  updateTableColumnUseCase: { operation: { id: 'tables.columns.update' }, execute: mocks.update },
  deleteTableColumnUseCase: { operation: { id: 'tables.columns.delete' }, execute: mocks.remove },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { DELETE, PATCH, POST } from '@/app/api/v2/tables/[tableId]/columns/route'

const WORKSPACE_ID = 'workspace-1'
const principal = {
  kind: 'workspace_api_key' as const,
  workspaceId: WORKSPACE_ID,
  keyId: 'key-1',
}
const auth = {
  principal,
  rolloutUserId: 'owner-1',
  rateLimitSubjectIds: [`workspace:${WORKSPACE_ID}`],
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const rate = {
  allowed: true,
  remaining: 99,
  resetAt: new Date('2026-01-01T01:00:00.000Z'),
  retryAfterMs: 0,
}
const table = {
  id: 'table-1',
  name: 'Contacts',
  schema: {
    columns: [
      { id: 'col-1', name: 'Name', type: 'string' as const, required: false, unique: false },
    ],
  },
}
const context = { params: Promise.resolve({ tableId: 'table-1' }) }

function request(method: 'POST' | 'PATCH' | 'DELETE', body: unknown) {
  return new NextRequest('http://localhost:3000/api/v2/tables/table-1/columns', {
    method,
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
}

describe('/api/v2/tables/[tableId]/columns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(auth)
    mocks.preauthRate.mockResolvedValue(rate)
    mocks.operationRate.mockResolvedValue(rate)
    mocks.gate.mockResolvedValue(null)
    mocks.add.mockResolvedValue({ table })
    mocks.update.mockResolvedValue({ table, changed: false })
    mocks.remove.mockResolvedValue({ table })
  })

  it('delegates column creation with canonical path and body inputs', async () => {
    const req = request('POST', {
      workspaceId: WORKSPACE_ID,
      column: { name: 'Name', type: 'string' },
    })
    const response = await POST(req, context)

    expect(response.status).toBe(200)
    expect((await response.json()).data.columns).toEqual([
      { id: 'col-1', name: 'Name', type: 'string', required: false, unique: false },
    ])
    expect(mocks.add).toHaveBeenCalledWith({
      principal,
      input: {
        tableId: 'table-1',
        workspaceId: WORKSPACE_ID,
        column: { name: 'Name', type: 'string' },
      },
      request: req,
    })
  })

  it('maps typed application validation failures without inspecting messages', async () => {
    mocks.update.mockRejectedValueOnce(new OrchestrationError('validation', 'Invalid column'))

    const response = await PATCH(
      request('PATCH', {
        workspaceId: WORKSPACE_ID,
        columnName: 'Name',
        updates: { name: 'Renamed' },
      }),
      context
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toBe('Invalid column')
  })

  it('delegates deletion and returns the authoritative surviving schema', async () => {
    const response = await DELETE(
      request('DELETE', { workspaceId: WORKSPACE_ID, columnName: 'Other' }),
      context
    )

    expect(response.status).toBe(200)
    expect(mocks.remove).toHaveBeenCalledOnce()
  })
})
