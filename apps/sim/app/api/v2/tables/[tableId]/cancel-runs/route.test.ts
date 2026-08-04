/**
 * @vitest-environment node
 *
 * Public v2 cancel-runs — stops workflow/enrichment cell runs, as opposed to
 * `job/cancel`, which stops an import or delete. The predicate translates to
 * storage keys before the cancel so an unknown field 400s rather than becoming
 * a cancel that silently matches nothing.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceScope,
  mockCheckAccess,
  mockCancelRuns,
  mockPredicateToFilter,
  mockSignalRowsChanged,
  mockGateError,
  TableQueryValidationError,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockCheckAccess: vi.fn(),
  mockCancelRuns: vi.fn(),
  mockPredicateToFilter: vi.fn(),
  mockSignalRowsChanged: vi.fn(),
  mockGateError: vi.fn(),
  TableQueryValidationError: class TableQueryValidationError extends Error {},
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceScope: mockResolveWorkspaceScope,
}))

vi.mock('@/app/api/table/utils', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  checkAccess: mockCheckAccess,
}))

vi.mock('@/app/api/v2/tables/utils', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  v2BulkPredicateToFilter: mockPredicateToFilter,
}))

vi.mock('@/lib/table/workflow-columns', () => ({ cancelWorkflowGroupRuns: mockCancelRuns }))
vi.mock('@/lib/table/events', () => ({ signalTableRowsChanged: mockSignalRowsChanged }))
vi.mock('@/lib/table/errors', () => ({ TableQueryValidationError }))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mockGateError }))

import { POST } from '@/app/api/v2/tables/[tableId]/cancel-runs/route'

const TABLE = {
  id: 'table-1',
  workspaceId: 'ws-1',
  schema: { columns: [{ id: 'col-1', name: 'status', type: 'string' }] },
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

function callPost(body: unknown) {
  const req = new NextRequest('http://localhost:3000/api/v2/tables/table-1/cancel-runs', {
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
  mockCancelRuns.mockResolvedValue(4)
  mockGateError.mockResolvedValue(null)
})

describe('POST /api/v2/tables/[tableId]/cancel-runs', () => {
  it('cancels every run under scope "all" and reports the count', async () => {
    const res = await callPost({ workspaceId: 'ws-1', scope: 'all' })

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ cancelled: 4 })
    expect(mockCancelRuns).toHaveBeenCalledWith('table-1', undefined, {
      filter: undefined,
      excludeRowIds: undefined,
    })
    // Cancelling clears the affected cells, so open readers must refetch.
    expect(mockSignalRowsChanged).toHaveBeenCalledWith('table-1')
  })

  it('scopes to a single row when asked', async () => {
    const res = await callPost({ workspaceId: 'ws-1', scope: 'row', rowId: 'row-1' })

    expect(res.status).toBe(200)
    expect(mockCancelRuns).toHaveBeenCalledWith('table-1', 'row-1', expect.anything())
  })

  it('translates a name-keyed predicate to the storage-keyed filter', async () => {
    mockPredicateToFilter.mockReturnValue({ 'col-1': { $eq: 'active' } })
    const predicate = { all: [{ field: 'status', op: 'eq', value: 'active' }] }

    await callPost({ workspaceId: 'ws-1', scope: 'all', filter: predicate })

    expect(mockPredicateToFilter).toHaveBeenCalledWith(predicate, TABLE.schema)
    expect(mockCancelRuns).toHaveBeenCalledWith(
      'table-1',
      undefined,
      expect.objectContaining({ filter: { 'col-1': { $eq: 'active' } } })
    )
  })

  it('400s an unresolvable predicate field instead of cancelling nothing', async () => {
    mockPredicateToFilter.mockImplementation(() => {
      throw new TableQueryValidationError('Unknown column "nope"')
    })

    const res = await callPost({
      workspaceId: 'ws-1',
      scope: 'all',
      filter: { all: [{ field: 'nope', op: 'eq', value: 1 }] },
    })

    expect(res.status).toBe(400)
    expect(mockCancelRuns).not.toHaveBeenCalled()
  })

  it('400s scope "row" with no rowId', async () => {
    const res = await callPost({ workspaceId: 'ws-1', scope: 'row' })

    expect(res.status).toBe(400)
    expect(mockCancelRuns).not.toHaveBeenCalled()
  })

  it('400s scope "row" combined with a filter', async () => {
    const res = await callPost({
      workspaceId: 'ws-1',
      scope: 'row',
      rowId: 'row-1',
      filter: { all: [{ field: 'status', op: 'eq', value: 'active' }] },
    })

    expect(res.status).toBe(400)
    expect(mockCancelRuns).not.toHaveBeenCalled()
  })

  it('403s a read-only member', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callPost({ workspaceId: 'ws-1', scope: 'all' })

    expect(res.status).toBe(403)
    expect(mockCancelRuns).not.toHaveBeenCalled()
  })

  it('404s with the gate off, before any work', async () => {
    mockGateError.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
        status: 404,
      })
    )

    const res = await callPost({ workspaceId: 'ws-1', scope: 'all' })

    expect(res.status).toBe(404)
    expect(mockCheckAccess).not.toHaveBeenCalled()
  })

  it('429s a throttled caller', async () => {
    mockCheckRateLimit.mockResolvedValue({
      ...RATE_LIMIT_OK,
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
    })

    const res = await callPost({ workspaceId: 'ws-1', scope: 'all' })

    expect(res.status).toBe(429)
    expect(mockCancelRuns).not.toHaveBeenCalled()
  })
})
