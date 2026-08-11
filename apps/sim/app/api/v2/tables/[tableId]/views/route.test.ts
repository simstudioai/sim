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
  list: vi.fn(),
  create: vi.fn(),
  emails: vi.fn(),
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
  listTableViewsUseCase: { operation: { id: 'tables.views.list' }, execute: mocks.list },
  createTableViewUseCase: { operation: { id: 'tables.views.create' }, execute: mocks.create },
}))
vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: mocks.emails,
  getRequiredUserEmail: mocks.email,
  requireResolvedUserEmail: (emails: Map<string, string>, userId: string) => emails.get(userId),
}))

import { GET, POST } from '@/app/api/v2/tables/[tableId]/views/route'

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
  isDefault: false,
  createdBy: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}
const context = { params: Promise.resolve({ tableId: 'table-1' }) }

describe('/api/v2/tables/[tableId]/views', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(auth)
    mocks.preauthRate.mockResolvedValue(rate)
    mocks.operationRate.mockResolvedValue(rate)
    mocks.gate.mockResolvedValue(null)
    mocks.list.mockResolvedValue({ views: [view] })
    mocks.create.mockResolvedValue({ view })
    mocks.emails.mockResolvedValue(new Map([['user-1', 'user@example.com']]))
    mocks.email.mockResolvedValue('user@example.com')
  })

  it('lists bounded views and resolves creator identities in the v2 presenter', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/v2/tables/table-1/views?workspaceId=${WORKSPACE_ID}`
    )
    const response = await GET(req, context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [
        {
          id: 'view-1',
          tableId: 'table-1',
          name: 'Active',
          config: {},
          isDefault: false,
          createdByEmail: 'user@example.com',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    })
    expect(mocks.list).toHaveBeenCalledWith({
      principal,
      input: { tableId: 'table-1', workspaceId: WORKSPACE_ID },
      request: req,
    })
  })

  it('creates through the authorized view use case and preserves 201', async () => {
    const req = new NextRequest('http://localhost:3000/api/v2/tables/table-1/views', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, name: 'Active', config: {} }),
    })
    const response = await POST(req, context)

    expect(response.status).toBe(201)
    expect((await response.json()).data.createdByEmail).toBe('user@example.com')
    expect(mocks.create).toHaveBeenCalledWith({
      principal,
      input: { tableId: 'table-1', workspaceId: WORKSPACE_ID, name: 'Active', config: {} },
      request: req,
    })
  })
})
