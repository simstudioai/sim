/**
 * @vitest-environment node
 *
 * v2 column update wiring: the route authenticates, scopes, delegates to the
 * orchestration function, and maps its failure classes onto the v2 envelope.
 * The guards themselves are covered in lib/table/orchestration/columns.test.ts.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimit, mockResolveWorkspaceScope, mockCheckAccess, mockPerformUpdate } =
  vi.hoisted(() => ({
    mockCheckRateLimit: vi.fn(),
    mockResolveWorkspaceScope: vi.fn(),
    mockCheckAccess: vi.fn(),
    mockPerformUpdate: vi.fn(),
  }))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceScope: mockResolveWorkspaceScope,
}))

vi.mock('@/app/api/table/utils', () => ({
  checkAccess: mockCheckAccess,
  normalizeColumn: (col: Record<string, unknown>) => col,
}))

vi.mock('@/lib/table', () => ({ addTableColumn: vi.fn(), deleteColumn: vi.fn() }))

vi.mock('@/lib/table/orchestration', () => ({
  performUpdateTableColumn: mockPerformUpdate,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { PATCH } from '@/app/api/v2/tables/[tableId]/columns/route'

const COLUMN = { id: 'col-1', name: 'Status', type: 'text' }
const TABLE = { id: 'table-1', name: 'Tasks', workspaceId: 'ws-1', schema: { columns: [COLUMN] } }

function patch(updates: Record<string, unknown> = { name: 'State' }) {
  const req = new NextRequest('http://localhost:3000/api/v2/tables/table-1/columns', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId: 'ws-1', columnName: 'Status', updates }),
  })
  return PATCH(req, { params: Promise.resolve({ tableId: 'table-1' }) })
}

describe('PATCH /api/v2/tables/[tableId]/columns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      userId: 'user-1',
      keyType: 'workspace',
      workspaceId: 'ws-1',
      limit: 100,
      remaining: 99,
      resetAt: new Date('2026-01-01T01:00:00Z'),
    })
    mockResolveWorkspaceScope.mockResolvedValue(null)
    mockCheckAccess.mockResolvedValue({ ok: true, table: TABLE })
    mockPerformUpdate.mockResolvedValue({ success: true, table: TABLE })
  })

  it('delegates to the orchestration function with the resolved table and actor', async () => {
    const res = await patch()

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ columns: [COLUMN] })
    expect(mockPerformUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ table: TABLE, columnName: 'Status', userId: 'user-1' })
    )
  })

  it.each([
    ['validation', 400, 'BAD_REQUEST'],
    ['not_found', 404, 'NOT_FOUND'],
    ['locked', 423, 'LOCKED'],
  ])('maps a %s failure to %i', async (errorCode, status, code) => {
    mockPerformUpdate.mockResolvedValue({ success: false, errorCode, error: 'nope' })

    const res = await patch()

    expect(res.status).toBe(status)
    expect((await res.json()).error.code).toBe(code)
  })

  it('does not leak an internal failure message', async () => {
    mockPerformUpdate.mockResolvedValue({
      success: false,
      errorCode: 'internal',
      error: 'connection string leaked',
    })

    const res = await patch()

    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('connection string')
  })
})
