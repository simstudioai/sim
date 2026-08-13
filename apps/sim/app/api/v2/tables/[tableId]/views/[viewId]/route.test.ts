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
  read: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  email: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)
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
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`],
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const columns = [
  { id: 'col_a', name: 'Status', type: 'text' as const },
  { id: 'col_b', name: 'Email', type: 'text' as const },
]
const view = {
  id: 'view-1',
  tableId: 'table-1',
  name: 'Active',
  config: {
    hiddenColumns: ['col_b'],
    sort: [{ field: 'col_a', direction: 'desc' as const }],
    filter: { all: [{ field: 'col_a', op: 'eq' as const, value: 'open' }] },
  },
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
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.read.mockResolvedValue({ view, columns })
    mocks.update.mockResolvedValue({ view, columns, changed: false })
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

  /**
   * Storage keys on stable column ids; this surface reads and writes column
   * names, so a `col_…` id must never reach the caller.
   */
  it('presents the saved config keyed by column name', async () => {
    const response = await GET(request('GET'), context)

    expect((await response.json()).data.config).toEqual({
      hiddenColumns: ['Email'],
      sort: [{ field: 'Status', direction: 'desc' }],
      filter: { all: [{ field: 'Status', op: 'eq', value: 'open' }] },
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

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await GET(request('GET'), context)

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })
})
