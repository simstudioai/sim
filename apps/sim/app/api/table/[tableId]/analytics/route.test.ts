/** @vitest-environment node */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/table/[tableId]/analytics/route'

const mocks = vi.hoisted(() => ({ session: vi.fn(), execute: vi.fn(), limit: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/core/rate-limiter', () => ({
  enforceUserRateLimit: mocks.limit,
  RateLimiter: class {},
}))
vi.mock('@/lib/table/application/analytics', () => ({
  readTableAnalytics: { operation: { id: 'tables.rows.analytics' }, execute: mocks.execute },
}))
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
  new NextRequest('http://localhost/api/table/tbl_test/analytics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  })
beforeEach(() => {
  vi.clearAllMocks()
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
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('validates the contract before the use case', async () => {
    expect(
      (await POST(request({ ...body, query: { ...body.query, sql: 'select *' } }), context)).status
    ).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('forwards the viewer and asserted scope and emits a private response', async () => {
    const response = await POST(request(body), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({ rows: [{ n: 0 }], truncated: false })
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'session', userId: 'viewer', sessionId: 'session' },
        input: { tableId: 'tbl_test', assertedWorkspaceId: 'workspace_test', query: body.query },
      })
    )
    expect(mocks.limit).toHaveBeenCalledWith('table-analytics', 'viewer', expect.any(Object))
  })
})
