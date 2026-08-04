/**
 * @vitest-environment node
 *
 * Public v2 column run. The public predicate is column-NAME keyed and the
 * dispatcher compiles a storage-keyed legacy filter, so the route translates
 * before dispatching — an unknown field must 400 here rather than becoming a
 * run that silently matches nothing.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceScope,
  mockCheckAccess,
  mockRunWorkflowColumn,
  mockPredicateToFilter,
  mockSignalRowsChanged,
  mockGateError,
  TableQueryValidationError,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockCheckAccess: vi.fn(),
  mockRunWorkflowColumn: vi.fn(),
  mockPredicateToFilter: vi.fn(),
  mockSignalRowsChanged: vi.fn(),
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

vi.mock('@/lib/table/workflow-columns', () => ({ runWorkflowColumn: mockRunWorkflowColumn }))
vi.mock('@/lib/table/events', () => ({ signalTableRowsChanged: mockSignalRowsChanged }))
vi.mock('@/lib/table/errors', () => ({ TableQueryValidationError }))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mockGateError }))

import { POST } from '@/app/api/v2/tables/[tableId]/columns/run/route'

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
  const req = new NextRequest('http://localhost:3000/api/v2/tables/table-1/columns/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ tableId: 'table-1' }) })
}

describe('POST /api/v2/tables/[tableId]/columns/run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceScope.mockResolvedValue(null)
    mockCheckAccess.mockResolvedValue({ ok: true, table: TABLE })
    mockRunWorkflowColumn.mockResolvedValue({ dispatchId: 'dispatch-1' })
    mockGateError.mockResolvedValue(null)
  })

  it('dispatches the run and returns the dispatch id', async () => {
    const res = await callPost({ workspaceId: 'ws-1', groupIds: ['group-1'], rowIds: ['row-1'] })

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ dispatchId: 'dispatch-1' })
    expect(mockRunWorkflowColumn).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: 'table-1',
        workspaceId: 'ws-1',
        groupIds: ['group-1'],
        rowIds: ['row-1'],
        mode: 'all',
        filter: undefined,
        triggeredByUserId: 'user-1',
      })
    )
    // The bulk clear is a row change even when the dispatch is a no-op.
    expect(mockSignalRowsChanged).toHaveBeenCalledWith('table-1')
  })

  it('translates a name-keyed predicate to the storage-keyed filter the dispatcher walks', async () => {
    mockPredicateToFilter.mockReturnValue({ 'col-1': { $eq: 'active' } })
    const predicate = { all: [{ field: 'status', op: 'eq', value: 'active' }] }

    const res = await callPost({ workspaceId: 'ws-1', groupIds: ['group-1'], filter: predicate })

    expect(res.status).toBe(200)
    expect(mockPredicateToFilter).toHaveBeenCalledWith(predicate, TABLE.schema)
    expect(mockRunWorkflowColumn).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { 'col-1': { $eq: 'active' } } })
    )
  })

  it('400s an unresolvable predicate field instead of dispatching a no-match run', async () => {
    mockPredicateToFilter.mockImplementation(() => {
      throw new TableQueryValidationError('Unknown column "nope"')
    })

    const res = await callPost({
      workspaceId: 'ws-1',
      groupIds: ['group-1'],
      filter: { all: [{ field: 'nope', op: 'eq', value: 1 }] },
    })

    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toBe('Unknown column "nope"')
    expect(mockRunWorkflowColumn).not.toHaveBeenCalled()
  })

  it('400s rowIds and filter together', async () => {
    const res = await callPost({
      workspaceId: 'ws-1',
      groupIds: ['group-1'],
      rowIds: ['row-1'],
      filter: { all: [{ field: 'status', op: 'eq', value: 'active' }] },
    })

    expect(res.status).toBe(400)
    expect(mockRunWorkflowColumn).not.toHaveBeenCalled()
  })

  it('400s an empty groupIds list', async () => {
    const res = await callPost({ workspaceId: 'ws-1', groupIds: [] })

    expect(res.status).toBe(400)
    expect(mockRunWorkflowColumn).not.toHaveBeenCalled()
  })

  it('403s a read-only member', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callPost({ workspaceId: 'ws-1', groupIds: ['group-1'] })

    expect(res.status).toBe(403)
    expect(mockRunWorkflowColumn).not.toHaveBeenCalled()
  })

  it('404s with the gate off, before any work', async () => {
    mockGateError.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
        status: 404,
      })
    )

    const res = await callPost({ workspaceId: 'ws-1', groupIds: ['group-1'] })

    expect(res.status).toBe(404)
    expect(mockCheckAccess).not.toHaveBeenCalled()
    expect(mockRunWorkflowColumn).not.toHaveBeenCalled()
  })

  it('429s a throttled caller', async () => {
    mockCheckRateLimit.mockResolvedValue({
      ...RATE_LIMIT_OK,
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
    })

    const res = await callPost({ workspaceId: 'ws-1', groupIds: ['group-1'] })

    expect(res.status).toBe(429)
    expect(mockRunWorkflowColumn).not.toHaveBeenCalled()
  })
})
