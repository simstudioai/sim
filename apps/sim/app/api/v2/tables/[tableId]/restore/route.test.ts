/**
 * @vitest-environment node
 *
 * Public v2 table restore. The target is archived by definition, so the route
 * resolves it with archived rows included and checks the permission against
 * that row's own workspace rather than going through `checkAccess`.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceScope,
  mockGetTableById,
  mockGetUserEntityPermissions,
  mockPerformRestoreTable,
  mockGateError,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockGetTableById: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockPerformRestoreTable: vi.fn(),
  mockGateError: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceScope: mockResolveWorkspaceScope,
}))

vi.mock('@/lib/table', () => ({ getTableById: mockGetTableById }))
vi.mock('@/lib/table/orchestration', () => ({ performRestoreTable: mockPerformRestoreTable }))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))
vi.mock('@/app/api/table/utils', () => ({
  normalizeColumn: (col: Record<string, unknown>) => col,
  rootErrorMessage: (error: unknown) => String(error),
  rowWriteErrorResponse: () => null,
}))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mockGateError }))

import { POST } from '@/app/api/v2/tables/[tableId]/restore/route'

const UNLOCKED = {
  schemaLocked: false,
  insertLocked: false,
  updateLocked: false,
  deleteLocked: false,
}
const ARCHIVED_TABLE = { id: 'table-1', workspaceId: 'ws-1', schema: { columns: [] } }
const RESTORED_TABLE = {
  id: 'table-1',
  name: 'Tasks',
  description: null,
  workspaceId: 'ws-1',
  schema: { columns: [] },
  rowCount: 7,
  maxRows: 1000,
  folderId: null,
  locks: UNLOCKED,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
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
  const req = new NextRequest('http://localhost:3000/api/v2/tables/table-1/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ tableId: 'table-1' }) })
}

describe('POST /api/v2/tables/[tableId]/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceScope.mockResolvedValue(null)
    mockGetTableById.mockResolvedValue(ARCHIVED_TABLE)
    mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGateError.mockResolvedValue(null)
  })

  it('restores through the orchestration function and returns the table', async () => {
    mockPerformRestoreTable.mockResolvedValue({ success: true, table: RESTORED_TABLE })

    const res = await callPost({ workspaceId: 'ws-1' })

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({
      table: {
        id: 'table-1',
        name: 'Tasks',
        description: null,
        schema: { columns: [] },
        rowCount: 7,
        maxRows: 1000,
        folderId: null,
        locks: UNLOCKED,
        job: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    })
    // Archived tables are invisible to `getTableById` by default; without the
    // opt-in the route would 404 every restore.
    expect(mockGetTableById).toHaveBeenCalledWith('table-1', { includeArchived: true })
    expect(mockPerformRestoreTable).toHaveBeenCalledWith(
      expect.objectContaining({ tableId: 'table-1', userId: 'user-1' })
    )
  })

  it('404s an archived table belonging to another workspace', async () => {
    mockGetTableById.mockResolvedValue({ ...ARCHIVED_TABLE, workspaceId: 'ws-other' })

    const res = await callPost({ workspaceId: 'ws-1' })

    expect(res.status).toBe(404)
    expect(mockPerformRestoreTable).not.toHaveBeenCalled()
  })

  it('403s a read-only member', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('read')

    const res = await callPost({ workspaceId: 'ws-1' })

    expect(res.status).toBe(403)
    expect(mockPerformRestoreTable).not.toHaveBeenCalled()
  })

  it('maps a name collision with a live table to 409 CONFLICT', async () => {
    mockPerformRestoreTable.mockResolvedValue({
      success: false,
      errorCode: 'conflict',
      error: 'A table named "Tasks" already exists',
    })

    const res = await callPost({ workspaceId: 'ws-1' })

    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONFLICT')
  })

  it('400s a body with no workspace', async () => {
    const res = await callPost({})

    expect(res.status).toBe(400)
    expect(mockPerformRestoreTable).not.toHaveBeenCalled()
  })

  it('404s with the gate off, before any work', async () => {
    mockGateError.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
        status: 404,
      })
    )

    const res = await callPost({ workspaceId: 'ws-1' })

    expect(res.status).toBe(404)
    expect(mockGetTableById).not.toHaveBeenCalled()
    expect(mockPerformRestoreTable).not.toHaveBeenCalled()
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
    expect(mockPerformRestoreTable).not.toHaveBeenCalled()
  })
})
