/**
 * @vitest-environment node
 *
 * Public v2 row lookup. The wire is column-NAME keyed both ways: the predicate
 * and sort translate down to storage ids on the way in, and the matched column
 * id translates back to its name on the way out.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceScope,
  mockCheckAccess,
  mockFindRowMatches,
  mockPredicateToFilter,
  mockValidateSortSpec,
  mockSortSpecNamesToIds,
  mockGateError,
  TableQueryValidationError,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockCheckAccess: vi.fn(),
  mockFindRowMatches: vi.fn(),
  mockPredicateToFilter: vi.fn(),
  mockValidateSortSpec: vi.fn(),
  mockSortSpecNamesToIds: vi.fn(),
  mockGateError: vi.fn(),
  TableQueryValidationError: class TableQueryValidationError extends Error {},
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

vi.mock('@/app/api/v2/tables/utils', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  v2BulkPredicateToFilter: mockPredicateToFilter,
}))

vi.mock('@/lib/table', () => ({
  buildIdByName: vi.fn().mockReturnValue({ status: 'col-1', name: 'col-2' }),
  sortSpecNamesToIds: mockSortSpecNamesToIds,
}))
vi.mock('@/lib/table/rows/service', () => ({ findRowMatches: mockFindRowMatches }))
vi.mock('@/lib/table/query-builder/validate', () => ({ validateSortSpec: mockValidateSortSpec }))
vi.mock('@/lib/table/errors', () => ({ TableQueryValidationError }))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mockGateError }))

import { POST } from '@/app/api/v2/tables/[tableId]/rows/find/route'

const COLUMNS = [
  { id: 'col-1', name: 'status', type: 'string' },
  { id: 'col-2', name: 'name', type: 'string' },
]
const TABLE = { id: 'table-1', workspaceId: 'ws-1', schema: { columns: COLUMNS } }

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  workspaceId: 'ws-1',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-01-01T01:00:00Z'),
}

function callPost(body: unknown) {
  const req = new NextRequest('http://localhost:3000/api/v2/tables/table-1/rows/find', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ tableId: 'table-1' }) })
}

describe('POST /api/v2/tables/[tableId]/rows/find', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceScope.mockResolvedValue(null)
    mockCheckAccess.mockResolvedValue({ ok: true, table: TABLE })
    mockFindRowMatches.mockResolvedValue({
      matches: [{ ordinal: 3, rowId: 'row-1', column: 'col-2' }],
      truncated: false,
    })
    mockSortSpecNamesToIds.mockImplementation((spec: { field: string }[]) =>
      spec.map((s) => ({ ...s, field: s.field === 'name' ? 'col-2' : s.field }))
    )
    mockGateError.mockResolvedValue(null)
  })

  it('reports the matched column by NAME, not its storage id', async () => {
    const res = await callPost({ workspaceId: 'ws-1', q: 'acme' })

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({
      matches: [{ ordinal: 3, rowId: 'row-1', column: 'name' }],
      truncated: false,
    })
    expect(mockFindRowMatches).toHaveBeenCalledWith(
      TABLE,
      { q: 'acme', filter: undefined, sort: undefined },
      expect.any(String)
    )
  })

  it('translates the predicate and sort to storage keys before searching', async () => {
    mockPredicateToFilter.mockReturnValue({ 'col-1': { $eq: 'active' } })
    const predicate = { all: [{ field: 'status', op: 'eq', value: 'active' }] }

    const res = await callPost({
      workspaceId: 'ws-1',
      q: 'acme',
      predicate,
      sort: [{ field: 'name', direction: 'asc' }],
    })

    expect(res.status).toBe(200)
    expect(mockPredicateToFilter).toHaveBeenCalledWith(predicate, TABLE.schema)
    expect(mockValidateSortSpec).toHaveBeenCalledWith(
      [{ field: 'name', direction: 'asc' }],
      COLUMNS
    )
    expect(mockFindRowMatches).toHaveBeenCalledWith(
      TABLE,
      { q: 'acme', filter: { 'col-1': { $eq: 'active' } }, sort: { 'col-2': 'asc' } },
      expect.any(String)
    )
  })

  it('surfaces truncation so a caller narrows instead of paging', async () => {
    mockFindRowMatches.mockResolvedValue({ matches: [], truncated: true })

    const res = await callPost({ workspaceId: 'ws-1', q: 'a' })

    expect((await res.json()).data).toEqual({ matches: [], truncated: true })
  })

  it('400s an unresolvable predicate field instead of returning zero matches', async () => {
    mockPredicateToFilter.mockImplementation(() => {
      throw new TableQueryValidationError('Unknown column "nope"')
    })

    const res = await callPost({
      workspaceId: 'ws-1',
      q: 'acme',
      predicate: { all: [{ field: 'nope', op: 'eq', value: 1 }] },
    })

    expect(res.status).toBe(400)
    expect(mockFindRowMatches).not.toHaveBeenCalled()
  })

  it('400s an empty search string', async () => {
    const res = await callPost({ workspaceId: 'ws-1', q: '' })

    expect(res.status).toBe(400)
    expect(mockFindRowMatches).not.toHaveBeenCalled()
  })

  it('masks a permission failure as 404 so table existence never leaks', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callPost({ workspaceId: 'ws-1', q: 'acme' })

    expect(res.status).toBe(404)
    expect(mockFindRowMatches).not.toHaveBeenCalled()
  })

  it('404s with the gate off, before any work', async () => {
    mockGateError.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
        status: 404,
      })
    )

    const res = await callPost({ workspaceId: 'ws-1', q: 'acme' })

    expect(res.status).toBe(404)
    expect(mockCheckAccess).not.toHaveBeenCalled()
    expect(mockFindRowMatches).not.toHaveBeenCalled()
  })

  it('429s a throttled caller', async () => {
    mockCheckRateLimit.mockResolvedValue({
      ...RATE_LIMIT_OK,
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
    })

    const res = await callPost({ workspaceId: 'ws-1', q: 'acme' })

    expect(res.status).toBe(429)
    expect(mockFindRowMatches).not.toHaveBeenCalled()
  })
})
