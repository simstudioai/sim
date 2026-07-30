/**
 * @vitest-environment node
 *
 * Public v2 query POST: typed predicate name→id translation, bounded-default vs
 * explicit-unbounded limit, cursor validation, workspace scoping, and
 * name-keyed row output in the `{ data, nextCursor }` envelope.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const {
  mockCheckAccess,
  mockQueryRows,
  mockCheckRateLimit,
  mockResolveWorkspaceScope,
  mockIsFeatureEnabled,
  mockGetWorkspaceOrganizationId,
} = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockQueryRows: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockGetWorkspaceOrganizationId: vi.fn(),
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

vi.mock('@/lib/table', async () => {
  const columnKeys = await import('@/lib/table/column-keys')
  return { ...columnKeys }
})

vi.mock('@/lib/table/rows/service', () => ({ queryRows: mockQueryRows }))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceOrganizationId: mockGetWorkspaceOrganizationId,
}))

import { encodeCursor } from '@/lib/table/rows/cursor'
import { POST } from '@/app/api/v2/tables/[tableId]/query/route'

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  workspaceId: 'workspace-1',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
}

function buildTable(): TableDefinition {
  return {
    id: 'tbl_1',
    name: 'People',
    description: null,
    schema: {
      columns: [
        { id: 'col_name', name: 'name', type: 'string' },
        { id: 'col_wins', name: 'wins', type: 'number' },
        { id: 'col_status', name: 'status', type: 'string' },
      ],
    },
    metadata: null,
    rowCount: 0,
    maxRows: 100,
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    archivedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  }
}

const EMPTY_RESULT = {
  rows: [],
  rowCount: 0,
  totalCount: 0,
  limit: 100,
  offset: 0,
  nextCursor: null,
}

function callQuery(body: Record<string, unknown>) {
  const req = new NextRequest('http://localhost:3000/api/v2/tables/tbl_1/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ tableId: 'tbl_1' }) })
}

describe('POST /api/v2/tables/[tableId]/query', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceScope.mockResolvedValue(null)
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable() })
    mockQueryRows.mockResolvedValue(EMPTY_RESULT)
    mockIsFeatureEnabled.mockResolvedValue(true)
    mockGetWorkspaceOrganizationId.mockResolvedValue('org-1')
  })

  it('returns 404 when the tables-v2-api flag is off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    const res = await callQuery({ workspaceId: 'workspace-1' })
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
    expect(mockQueryRows).not.toHaveBeenCalled()
  })

  it('runs the flag gate only after the access check, so it cannot leak a cohort oracle', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })
    const res = await callQuery({ workspaceId: 'workspace-1' })
    // Read path masks not-authorized as 404 so existence never leaks.
    expect(res.status).toBe(404)
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled()
  })

  it('translates a name-keyed predicate to storage ids', async () => {
    const res = await callQuery({
      workspaceId: 'workspace-1',
      predicate: {
        all: [
          { field: 'status', op: 'eq', value: 'active' },
          { field: 'wins', op: 'gte', value: 10 },
        ],
      },
    })
    expect(res.status).toBe(200)
    expect(mockQueryRows.mock.calls[0][1].predicate).toEqual({
      all: [
        { field: 'col_status', op: 'eq', value: 'active' },
        { field: 'col_wins', op: 'gte', value: 10 },
      ],
    })
  })

  it('applies the bounded default limit when omitted', async () => {
    await callQuery({ workspaceId: 'workspace-1' })
    expect(mockQueryRows.mock.calls[0][1].limit).toBe(100)
  })

  it('treats limit=0 as the explicit unbounded opt-in', async () => {
    await callQuery({ workspaceId: 'workspace-1', limit: 0 })
    expect(mockQueryRows.mock.calls[0][1].limit).toBeUndefined()
  })

  it('rejects a limit above the max', async () => {
    const res = await callQuery({ workspaceId: 'workspace-1', limit: 5000 })
    expect(res.status).toBe(400)
    expect(mockQueryRows).not.toHaveBeenCalled()
  })

  it('rejects the removed regex ops at the contract boundary', async () => {
    // `match`/`imatch` are no longer in FILTER_OPS — a catastrophic-backtracking
    // pattern can pin a shared-pool connection, and nothing shipped depends on them.
    const res = await callQuery({
      workspaceId: 'workspace-1',
      predicate: { all: [{ field: 'name', op: 'match', value: '^jo' }] },
    })
    expect(res.status).toBe(400)
    expect(mockQueryRows).not.toHaveBeenCalled()
  })

  it('rejects a predicate referencing an unknown column', async () => {
    const res = await callQuery({
      workspaceId: 'workspace-1',
      predicate: { all: [{ field: 'nope', op: 'eq', value: 1 }] },
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toMatch(/Unknown filter column/)
  })

  it('rejects a keyset cursor combined with a custom sort', async () => {
    const cursor = encodeCursor({
      lastRow: { id: 'r1', orderKey: 'a1' },
      keysetValid: true,
      nextOffset: 1,
    })
    const res = await callQuery({
      workspaceId: 'workspace-1',
      sort: [{ field: 'wins', direction: 'desc' }],
      cursor,
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error.details.code).toBe('CURSOR_SORT_CONFLICT')
  })

  it('returns 400 INVALID_CURSOR for a malformed cursor', async () => {
    const res = await callQuery({
      workspaceId: 'workspace-1',
      cursor: Buffer.from('42').toString('base64url'),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error.details.code).toBe('INVALID_CURSOR')
  })

  it('surfaces a workspace-scope 403 in the v2 error envelope', async () => {
    mockResolveWorkspaceScope.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'API key is not authorized for this workspace',
    })
    const res = await callQuery({ workspaceId: 'workspace-1' })
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('FORBIDDEN')
    expect(mockQueryRows).not.toHaveBeenCalled()
  })

  it('masks a workspace-id mismatch against the table as 404', async () => {
    const res = await callQuery({ workspaceId: 'other-ws' })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Table not found',
    })
  })

  it('returns name-keyed row data with no storage internals and a private cache header', async () => {
    mockQueryRows.mockResolvedValue({
      rows: [
        {
          id: 'r1',
          data: { col_status: 'active', col_wins: 12 },
          position: 3,
          orderKey: 'a5',
          executions: {},
          createdAt: new Date('2024-02-02'),
          updatedAt: new Date('2024-02-03'),
        },
      ],
      rowCount: 1,
      totalCount: 1,
      limit: 100,
      offset: 0,
      nextCursor: null,
    })
    const res = await callQuery({ workspaceId: 'workspace-1' })
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await res.json()
    expect(body.nextCursor).toBeNull()
    expect(body.data[0]).toEqual({
      id: 'r1',
      data: { status: 'active', wins: 12 },
      createdAt: '2024-02-02T00:00:00.000Z',
      updatedAt: '2024-02-03T00:00:00.000Z',
    })
  })

  it('returns the rate-limit response when the limiter denies the request', async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      limit: 100,
      remaining: 0,
      resetAt: new Date('2024-01-01T01:00:00Z'),
      retryAfterMs: 1000,
    })
    const res = await callQuery({ workspaceId: 'workspace-1' })
    expect(res.status).toBe(429)
    expect(mockCheckAccess).not.toHaveBeenCalled()
  })
})
