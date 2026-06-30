/**
 * @vitest-environment node
 */
import { hybridAuthMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'

const { mockCheckAccess, mockFindRowMatches } = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockFindRowMatches: vi.fn(),
}))

vi.mock('@/app/api/table/utils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    checkAccess: mockCheckAccess,
    accessError: (result: { status: number }) =>
      NextResponse.json(
        { error: result.status === 404 ? 'Table not found' : 'Access denied' },
        { status: result.status }
      ),
  }
})

vi.mock('@/lib/table/rows/service', () => ({
  findRowMatches: mockFindRowMatches,
}))

import { GET } from '@/app/api/table/[tableId]/rows/find/route'

function buildTable(overrides: Partial<TableDefinition> = {}): TableDefinition {
  return {
    id: 'tbl_1',
    name: 'People',
    description: null,
    schema: { columns: [{ name: 'name', type: 'string' }] },
    metadata: null,
    rowCount: 0,
    maxRows: 100,
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    archivedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

function callGet(
  query: Record<string, string>,
  { tableId }: { tableId: string } = { tableId: 'tbl_1' }
) {
  const params = new URLSearchParams(query)
  const req = new NextRequest(`http://localhost:3000/api/table/${tableId}/rows/find?${params}`, {
    method: 'GET',
  })
  return GET(req, { params: Promise.resolve({ tableId }) })
}

describe('GET /api/table/[tableId]/rows/find', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable() })
    mockFindRowMatches.mockResolvedValue({
      matches: [{ ordinal: 4, rowId: 'row_4', column: 'name' }],
      truncated: false,
    })
  })

  it('returns 401 when unauthenticated', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Authentication required',
    })
    const res = await callGet({ workspaceId: 'workspace-1', q: 'foo' })
    expect(res.status).toBe(401)
    expect(mockFindRowMatches).not.toHaveBeenCalled()
  })

  it('returns 400 when q is missing', async () => {
    const res = await callGet({ workspaceId: 'workspace-1' })
    expect(res.status).toBe(400)
    expect(mockFindRowMatches).not.toHaveBeenCalled()
  })

  it('returns 400 on a workspace mismatch', async () => {
    const res = await callGet({ workspaceId: 'other-ws', q: 'foo' })
    expect(res.status).toBe(400)
    expect(mockFindRowMatches).not.toHaveBeenCalled()
  })

  it('returns 400 on invalid filter JSON', async () => {
    const res = await callGet({ workspaceId: 'workspace-1', q: 'foo', filter: '{not json' })
    expect(res.status).toBe(400)
  })

  it('returns matches and forwards q/filter/sort to the service', async () => {
    const res = await callGet({
      workspaceId: 'workspace-1',
      q: 'alice',
      filter: JSON.stringify({ name: { $contains: 'a' } }),
      sort: JSON.stringify({ name: 'asc' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      success: true,
      data: { matches: [{ ordinal: 4, rowId: 'row_4', column: 'name' }], truncated: false },
    })
    expect(mockFindRowMatches).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tbl_1' }),
      { q: 'alice', filter: { name: { $contains: 'a' } }, sort: { name: 'asc' } },
      expect.any(String)
    )
  })

  it('maps a TableQueryValidationError to 400', async () => {
    const { TableQueryValidationError } = await import('@/lib/table/sql')
    mockFindRowMatches.mockRejectedValueOnce(new TableQueryValidationError('Invalid field name'))
    const res = await callGet({ workspaceId: 'workspace-1', q: 'foo' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid field name')
  })

  it('returns 404 when the table is not accessible', async () => {
    mockCheckAccess.mockResolvedValueOnce({ ok: false, status: 404 })
    const res = await callGet({ workspaceId: 'workspace-1', q: 'foo' })
    expect(res.status).toBe(404)
  })
})
