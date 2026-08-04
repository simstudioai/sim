/**
 * @vitest-environment node
 *
 * Public v2 saved views: list and create. A view is presentation state, so the
 * read needs only `read` while saving one needs `write`.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceScope,
  mockCheckAccess,
  mockListTableViews,
  mockCreateTableView,
  mockGateError,
  TableViewValidationError,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockCheckAccess: vi.fn(),
  mockListTableViews: vi.fn(),
  mockCreateTableView: vi.fn(),
  mockGateError: vi.fn(),
  TableViewValidationError: class TableViewValidationError extends Error {},
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceScope: mockResolveWorkspaceScope,
}))

vi.mock('@/app/api/table/utils', () => ({
  checkAccess: mockCheckAccess,
  normalizeColumn: (col: Record<string, unknown>) => col,
  rootErrorMessage: (error: unknown) => String(error),
  rowWriteErrorResponse: () => null,
}))

vi.mock('@/lib/table', () => ({
  listTableViews: mockListTableViews,
  createTableView: mockCreateTableView,
  TableViewValidationError,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mockGateError }))

import { GET, POST } from '@/app/api/v2/tables/[tableId]/views/route'

const COLUMNS = [{ id: 'col-1', name: 'status', type: 'string' }]
const TABLE = { id: 'table-1', workspaceId: 'ws-1', schema: { columns: COLUMNS } }
const VIEW = {
  id: 'view-1',
  tableId: 'table-1',
  name: 'Active',
  config: { filter: { all: [{ field: 'col-1', op: 'eq', value: 'active' }] } },
  isDefault: true,
  createdBy: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}
const API_VIEW = {
  ...VIEW,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  workspaceId: 'ws-1',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-01-01T01:00:00Z'),
}

function callGet() {
  const req = new NextRequest(
    'http://localhost:3000/api/v2/tables/table-1/views?workspaceId=ws-1',
    { method: 'GET' }
  )
  return GET(req, { params: Promise.resolve({ tableId: 'table-1' }) })
}

function callPost(body: unknown) {
  const req = new NextRequest('http://localhost:3000/api/v2/tables/table-1/views', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ tableId: 'table-1' }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
  mockResolveWorkspaceScope.mockResolvedValue(null)
  mockCheckAccess.mockResolvedValue({ ok: true, table: TABLE })
  mockGateError.mockResolvedValue(null)
})

describe('GET /api/v2/tables/[tableId]/views', () => {
  it('returns every view as one full page with ISO timestamps', async () => {
    mockListTableViews.mockResolvedValue([VIEW])

    const res = await callGet()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: [API_VIEW], nextCursor: null })
    // The columns are passed so stale references are pruned from each config.
    expect(mockListTableViews).toHaveBeenCalledWith('table-1', COLUMNS)
  })

  it('404s a table in another workspace without listing', async () => {
    mockCheckAccess.mockResolvedValue({ ok: true, table: { ...TABLE, workspaceId: 'ws-other' } })

    const res = await callGet()

    expect(res.status).toBe(404)
    expect(mockListTableViews).not.toHaveBeenCalled()
  })

  it('masks a permission failure as 404 so table existence never leaks', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callGet()

    expect(res.status).toBe(404)
    expect(mockListTableViews).not.toHaveBeenCalled()
  })

  it('429s a throttled caller', async () => {
    mockCheckRateLimit.mockResolvedValue({
      ...RATE_LIMIT_OK,
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
    })

    const res = await callGet()

    expect(res.status).toBe(429)
    expect(mockListTableViews).not.toHaveBeenCalled()
  })
})

describe('POST /api/v2/tables/[tableId]/views', () => {
  it('creates the view with the caller as author and answers 201', async () => {
    mockCreateTableView.mockResolvedValue(VIEW)

    const res = await callPost({ workspaceId: 'ws-1', name: 'Active', config: {} })

    expect(res.status).toBe(201)
    expect((await res.json()).data).toEqual({ view: API_VIEW })
    expect(mockCreateTableView).toHaveBeenCalledWith({
      tableId: 'table-1',
      workspaceId: 'ws-1',
      name: 'Active',
      config: {},
      userId: 'user-1',
      columns: COLUMNS,
    })
  })

  it('400s a blank view name without touching the service', async () => {
    const res = await callPost({ workspaceId: 'ws-1', name: '   ', config: {} })

    expect(res.status).toBe(400)
    expect(mockCreateTableView).not.toHaveBeenCalled()
  })

  it('403s a read-only member', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callPost({ workspaceId: 'ws-1', name: 'Active', config: {} })

    expect(res.status).toBe(403)
    expect(mockCreateTableView).not.toHaveBeenCalled()
  })

  it('404s with the gate off, before any work', async () => {
    mockGateError.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
        status: 404,
      })
    )

    const res = await callPost({ workspaceId: 'ws-1', name: 'Active', config: {} })

    expect(res.status).toBe(404)
    expect(mockCheckAccess).not.toHaveBeenCalled()
    expect(mockCreateTableView).not.toHaveBeenCalled()
  })

  it('surfaces a service-level view validation failure as 400', async () => {
    mockCreateTableView.mockRejectedValue(new TableViewValidationError('View name cannot be empty'))

    const res = await callPost({ workspaceId: 'ws-1', name: 'Active', config: {} })

    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toBe('View name cannot be empty')
  })
})
