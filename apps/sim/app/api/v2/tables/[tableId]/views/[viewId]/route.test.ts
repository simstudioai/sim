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
  read: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  email: vi.fn(),
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
vi.mock('@/lib/table/application/views', () => ({
  readTableViewUseCase: { operation: { id: 'tables.views.read' }, execute: mocks.read },
  updateTableViewUseCase: { operation: { id: 'tables.views.update' }, execute: mocks.update },
  deleteTableViewUseCase: { operation: { id: 'tables.views.delete' }, execute: mocks.remove },
}))
vi.mock('@/lib/users/queries', () => ({ getRequiredUserEmail: mocks.email }))

import { DELETE, GET, PATCH } from '@/app/api/v2/tables/[tableId]/views/[viewId]/route'

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
const view = {
  id: 'view-1',
  tableId: 'table-1',
  name: 'Active',
  config: {},
  isDefault: true,
  createdBy: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}
const context = { params: Promise.resolve({ tableId: 'table-1', viewId: 'view-1' }) }

function request(method: 'GET' | 'PATCH' | 'DELETE', body?: unknown) {
  return new NextRequest(
    `http://localhost:3000/api/v2/tables/table-1/views/view-1${method === 'PATCH' ? '' : `?workspaceId=${WORKSPACE_ID}`}`,
    {
      method,
      headers: { 'x-api-key': 'secret', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }
  )
}

describe('/api/v2/tables/[tableId]/views/[viewId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(auth)
    mocks.preauthRate.mockResolvedValue(rate)
    mocks.operationRate.mockResolvedValue(rate)
    mocks.gate.mockResolvedValue(null)
    mocks.read.mockResolvedValue({ view })
    mocks.update.mockResolvedValue({ view, changed: false })
    mocks.remove.mockResolvedValue({ viewId: 'view-1' })
    mocks.email.mockResolvedValue('user@example.com')
  })

  it('reads the view through canonical table and view identities', async () => {
    const req = request('GET')
    const response = await GET(req, context)

    expect(response.status).toBe(200)
    expect((await response.json()).data.id).toBe('view-1')
    expect(mocks.read).toHaveBeenCalledWith({
      principal,
      input: { tableId: 'table-1', viewId: 'view-1', workspaceId: WORKSPACE_ID },
      request: req,
    })
  })

  it('preserves no-op PATCH response compatibility', async () => {
    const response = await PATCH(
      request('PATCH', { workspaceId: WORKSPACE_ID, name: 'Active' }),
      context
    )

    expect(response.status).toBe(200)
    expect((await response.json()).data.name).toBe('Active')
  })

  it('deletes through the authorized view use case', async () => {
    const response = await DELETE(request('DELETE'), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { id: 'view-1', deleted: true } })
    expect(mocks.remove).toHaveBeenCalledOnce()
  })
})
