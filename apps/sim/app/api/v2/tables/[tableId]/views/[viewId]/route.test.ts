/**
 * @vitest-environment node
 *
 * Public v2 saved-view detail: read, patch, delete. A view that is not on this
 * table is a 404 rather than a silent no-op, so a caller can tell a wrong id
 * from a successful write.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceScope,
  mockCheckAccess,
  mockGetTableView,
  mockUpdateTableView,
  mockDeleteTableView,
  mockGateError,
  mockGetRequiredUserEmail,
  TableViewValidationError,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockCheckAccess: vi.fn(),
  mockGetTableView: vi.fn(),
  mockUpdateTableView: vi.fn(),
  mockDeleteTableView: vi.fn(),
  mockGateError: vi.fn(),
  mockGetRequiredUserEmail: vi.fn(),
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
  getTableView: mockGetTableView,
  updateTableView: mockUpdateTableView,
  deleteTableView: mockDeleteTableView,
  TableViewValidationError,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mockGateError }))

vi.mock('@/lib/users/queries', () => ({
  getRequiredUserEmail: mockGetRequiredUserEmail,
}))

import { DELETE, GET, PATCH } from '@/app/api/v2/tables/[tableId]/views/[viewId]/route'

const COLUMNS = [{ id: 'col-1', name: 'status', type: 'string' }]
const TABLE = { id: 'table-1', workspaceId: 'ws-1', schema: { columns: COLUMNS } }
const VIEW = {
  id: 'view-1',
  tableId: 'table-1',
  name: 'Active',
  config: {},
  isDefault: false,
  createdBy: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}
const API_VIEW = {
  id: VIEW.id,
  tableId: VIEW.tableId,
  name: VIEW.name,
  config: VIEW.config,
  isDefault: VIEW.isDefault,
  createdByEmail: 'ada@example.com',
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

const params = { params: Promise.resolve({ tableId: 'table-1', viewId: 'view-1' }) }

function callGet() {
  return GET(
    new NextRequest('http://localhost:3000/api/v2/tables/table-1/views/view-1?workspaceId=ws-1', {
      method: 'GET',
    }),
    params
  )
}

function callPatch(body: unknown) {
  return PATCH(
    new NextRequest('http://localhost:3000/api/v2/tables/table-1/views/view-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params
  )
}

function callDelete() {
  return DELETE(
    new NextRequest('http://localhost:3000/api/v2/tables/table-1/views/view-1?workspaceId=ws-1', {
      method: 'DELETE',
    }),
    params
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
  mockResolveWorkspaceScope.mockResolvedValue(null)
  mockCheckAccess.mockResolvedValue({ ok: true, table: TABLE })
  mockGateError.mockResolvedValue(null)
  mockGetRequiredUserEmail.mockResolvedValue('ada@example.com')
})

describe('GET /api/v2/tables/[tableId]/views/[viewId]', () => {
  it('returns the view scoped to its table', async () => {
    mockGetTableView.mockResolvedValue(VIEW)

    const res = await callGet()

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ view: API_VIEW })
    expect(mockGetTableView).toHaveBeenCalledWith('view-1', 'table-1', COLUMNS)
  })

  it('404s a view id that belongs to a different table', async () => {
    mockGetTableView.mockResolvedValue(null)

    const res = await callGet()

    expect(res.status).toBe(404)
    expect((await res.json()).error.message).toBe('View not found')
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
    expect(mockGetTableView).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/v2/tables/[tableId]/views/[viewId]', () => {
  it('forwards the patch fields to the service', async () => {
    mockUpdateTableView.mockResolvedValue({ ...VIEW, isDefault: true })

    const res = await callPatch({ workspaceId: 'ws-1', isDefault: true })

    expect(res.status).toBe(200)
    expect((await res.json()).data.view.isDefault).toBe(true)
    expect(mockUpdateTableView).toHaveBeenCalledWith({
      viewId: 'view-1',
      tableId: 'table-1',
      name: undefined,
      config: undefined,
      configPatch: undefined,
      isDefault: true,
      columns: COLUMNS,
    })
  })

  it('400s a body that changes nothing', async () => {
    const res = await callPatch({ workspaceId: 'ws-1' })

    expect(res.status).toBe(400)
    expect(mockUpdateTableView).not.toHaveBeenCalled()
  })

  it('400s config and configPatch together', async () => {
    const res = await callPatch({ workspaceId: 'ws-1', config: {}, configPatch: {} })

    expect(res.status).toBe(400)
    expect(mockUpdateTableView).not.toHaveBeenCalled()
  })

  it('403s a read-only member', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callPatch({ workspaceId: 'ws-1', isDefault: true })

    expect(res.status).toBe(403)
    expect(mockUpdateTableView).not.toHaveBeenCalled()
  })

  it('404s with the gate off, before any work', async () => {
    mockGateError.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
        status: 404,
      })
    )

    const res = await callPatch({ workspaceId: 'ws-1', isDefault: true })

    expect(res.status).toBe(404)
    expect(mockCheckAccess).not.toHaveBeenCalled()
    expect(mockUpdateTableView).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v2/tables/[tableId]/views/[viewId]', () => {
  it('returns the deleted view id', async () => {
    mockDeleteTableView.mockResolvedValue(true)

    const res = await callDelete()

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ id: 'view-1' })
    expect(mockDeleteTableView).toHaveBeenCalledWith('view-1', 'table-1')
  })

  it('404s when nothing was deleted rather than reporting a phantom success', async () => {
    mockDeleteTableView.mockResolvedValue(false)

    const res = await callDelete()

    expect(res.status).toBe(404)
  })

  it('403s a read-only member', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callDelete()

    expect(res.status).toBe(403)
    expect(mockDeleteTableView).not.toHaveBeenCalled()
  })
})
