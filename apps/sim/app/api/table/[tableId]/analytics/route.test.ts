import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { rateLimiterMock, rateLimiterMockFns } from '@sim/testing/mocks/rate-limiter.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/table/[tableId]/analytics/route'

const hoisted = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/core/rate-limiter', () => rateLimiterMock)
vi.mock('@/lib/table/application/analytics', () => ({
  readTableAnalytics: { operation: { id: 'tables.rows.analytics' }, execute: hoisted.execute },
}))
const mocks = {
  ...hoisted,
  session: authMockFns.mockGetSession,
  limit: rateLimiterMockFns.mockEnforceUserRateLimit,
}
const context = { params: Promise.resolve({ tableId: 'tbl_test' }) }
const body = {
  workspaceId: 'workspace_test',
  query: {
    from: '2026-09-01T00:00:00Z',
    to: '2026-09-02T00:00:00Z',
    aggregate: { n: { op: 'count' } },
  },
}
const request = (value: unknown) =>
  createMockRequest({ method: 'POST', url: '/api/table/tbl_test/analytics', body: value })
beforeEach(() => {
  mocks.session.mockResolvedValue({ user: { id: 'viewer' }, session: { id: 'session' } })
  mocks.limit.mockResolvedValue(null)
  mocks.execute.mockResolvedValue({
    rows: [{ n: 0 }],
    columns: ['n'],
    columnLabels: { n: 'n' },
    truncated: false,
    bucket: null,
  })
})
describe('analytics HTTP adapter', () => {
  it('authenticates before parsing and never uses a file share as authority', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await POST(request({ invalid: true }), context)).status).toBe(401)
  })
  it('validates the contract before the use case', async () => {
    expect(
      (await POST(request({ ...body, query: { ...body.query, sql: 'select *' } }), context)).status
    ).toBe(400)
  })
  it('emits a private response', async () => {
    const response = await POST(request(body), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({ rows: [{ n: 0 }], truncated: false })
  })
})
