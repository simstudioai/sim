/**
 * @vitest-environment node
 *
 * Public v2 per-row enrichment run — the single-cell case of the column run.
 * Naming a specific cell is an explicit re-run, so it dispatches in `all` mode
 * and recomputes an already-populated cell.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceScope,
  mockCheckAccess,
  mockRunWorkflowColumn,
  mockSignalRowsChanged,
  mockGateError,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockCheckAccess: vi.fn(),
  mockRunWorkflowColumn: vi.fn(),
  mockSignalRowsChanged: vi.fn(),
  mockGateError: vi.fn(),
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

vi.mock('@/lib/table/workflow-columns', () => ({ runWorkflowColumn: mockRunWorkflowColumn }))
vi.mock('@/lib/table/events', () => ({ signalTableRowsChanged: mockSignalRowsChanged }))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mockGateError }))

import { POST } from '@/app/api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]/route'

const TABLE = { id: 'table-1', workspaceId: 'ws-1', schema: { columns: [] } }

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
  const req = new NextRequest(
    'http://localhost:3000/api/v2/tables/table-1/rows/row-1/enrichment/group-1',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  return POST(req, {
    params: Promise.resolve({ tableId: 'table-1', rowId: 'row-1', groupId: 'group-1' }),
  })
}

describe('POST /api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceScope.mockResolvedValue(null)
    mockCheckAccess.mockResolvedValue({ ok: true, table: TABLE })
    mockRunWorkflowColumn.mockResolvedValue({ dispatchId: 'dispatch-1' })
    mockGateError.mockResolvedValue(null)
  })

  it('scopes the dispatch to the one row and group in the path', async () => {
    const res = await callPost({ workspaceId: 'ws-1' })

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ dispatchId: 'dispatch-1' })
    expect(mockRunWorkflowColumn).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: 'table-1',
        workspaceId: 'ws-1',
        groupIds: ['group-1'],
        rowIds: ['row-1'],
        mode: 'all',
        triggeredByUserId: 'user-1',
      })
    )
    expect(mockSignalRowsChanged).toHaveBeenCalledWith('table-1')
  })

  it('reports a null dispatch id verbatim rather than inventing one', async () => {
    mockRunWorkflowColumn.mockResolvedValue({ dispatchId: null })

    const res = await callPost({ workspaceId: 'ws-1' })

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ dispatchId: null })
  })

  it('404s a table in another workspace without dispatching', async () => {
    mockCheckAccess.mockResolvedValue({ ok: true, table: { ...TABLE, workspaceId: 'ws-other' } })

    const res = await callPost({ workspaceId: 'ws-1' })

    expect(res.status).toBe(404)
    expect(mockRunWorkflowColumn).not.toHaveBeenCalled()
  })

  it('400s a body with no workspace', async () => {
    const res = await callPost({})

    expect(res.status).toBe(400)
    expect(mockRunWorkflowColumn).not.toHaveBeenCalled()
  })

  it('403s a read-only member', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callPost({ workspaceId: 'ws-1' })

    expect(res.status).toBe(403)
    expect(mockRunWorkflowColumn).not.toHaveBeenCalled()
  })

  it('404s with the gate off, before any work', async () => {
    mockGateError.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
        status: 404,
      })
    )

    const res = await callPost({ workspaceId: 'ws-1' })

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

    const res = await callPost({ workspaceId: 'ws-1' })

    expect(res.status).toBe(429)
    expect(mockRunWorkflowColumn).not.toHaveBeenCalled()
  })
})
