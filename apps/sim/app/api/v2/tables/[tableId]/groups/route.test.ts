/**
 * @vitest-environment node
 *
 * Public v2 workflow-group listing — a read-only projection of the table's
 * schema, exposed so a caller can discover the group ids the run endpoints
 * take.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimit, mockResolveWorkspaceScope, mockCheckAccess, mockGateError } =
  vi.hoisted(() => ({
    mockCheckRateLimit: vi.fn(),
    mockResolveWorkspaceScope: vi.fn(),
    mockCheckAccess: vi.fn(),
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

vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mockGateError }))

import { GET } from '@/app/api/v2/tables/[tableId]/groups/route'

const GROUP = {
  id: 'group-1',
  workflowId: 'wf-1',
  name: 'Enrich',
  outputs: [{ blockId: 'blk-1', path: 'content', columnName: 'summary' }],
}
const TABLE = {
  id: 'table-1',
  workspaceId: 'ws-1',
  schema: { columns: [], workflowGroups: [GROUP] },
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
    'http://localhost:3000/api/v2/tables/table-1/groups?workspaceId=ws-1',
    { method: 'GET' }
  )
  return GET(req, { params: Promise.resolve({ tableId: 'table-1' }) })
}

describe('GET /api/v2/tables/[tableId]/groups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceScope.mockResolvedValue(null)
    mockCheckAccess.mockResolvedValue({ ok: true, table: TABLE })
    mockGateError.mockResolvedValue(null)
  })

  it('returns the schema groups as one full page', async () => {
    const res = await callGet()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: [GROUP], nextCursor: null })
  })

  it('returns an empty page for a table with no groups', async () => {
    mockCheckAccess.mockResolvedValue({ ok: true, table: { ...TABLE, schema: { columns: [] } } })

    const res = await callGet()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: [], nextCursor: null })
  })

  it('masks a permission failure as 404 so table existence never leaks', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callGet()

    expect(res.status).toBe(404)
  })

  it('400s a request with no workspaceId', async () => {
    const req = new NextRequest('http://localhost:3000/api/v2/tables/table-1/groups', {
      method: 'GET',
    })
    const res = await GET(req, { params: Promise.resolve({ tableId: 'table-1' }) })

    expect(res.status).toBe(400)
    expect(mockCheckAccess).not.toHaveBeenCalled()
  })

  it('404s with the gate off, before any work', async () => {
    mockGateError.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
        status: 404,
      })
    )

    const res = await callGet()

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

    const res = await callGet()

    expect(res.status).toBe(429)
    expect(mockCheckAccess).not.toHaveBeenCalled()
  })
})
