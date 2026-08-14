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

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  emails: vi.fn(),
  email: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)
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
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`],
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const columns = [{ id: 'col_a', name: 'Status', type: 'text' as const }]
const view = {
  id: 'view-1',
  tableId: 'table-1',
  name: 'Active',
  config: { sort: [{ field: 'col_a', direction: 'desc' as const }] },
  isDefault: false,
  createdBy: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}
const context = { params: Promise.resolve({ tableId: 'table-1' }) }

describe('/api/v2/tables/[tableId]/views', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.list.mockResolvedValue({ views: [view], columns })
    mocks.create.mockResolvedValue({ view, columns })
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
          config: { sort: [{ field: 'Status', direction: 'desc' }] },
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

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/tables/table-1/views?workspaceId=${WORKSPACE_ID}`
      ),
      context
    )

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })
})
