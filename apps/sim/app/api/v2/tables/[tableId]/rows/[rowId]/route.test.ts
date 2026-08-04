/**
 * @vitest-environment node
 *
 * Public v2 single-row delete: goes through the row service so the delete lock
 * and row-count bookkeeping are enforced, and renders lock/not-found in the v2
 * error envelope.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimit, mockResolveWorkspaceScope, mockCheckAccess, mockPerformDeleteRow } =
  vi.hoisted(() => ({
    mockCheckRateLimit: vi.fn(),
    mockResolveWorkspaceScope: vi.fn(),
    mockCheckAccess: vi.fn(),
    mockPerformDeleteRow: vi.fn(),
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
  updateTable: vi.fn(),
  getTableById: vi.fn(),
  updateRow: vi.fn(),
  rowDataNameToId: vi.fn(),
  buildIdByName: vi.fn(),
}))

vi.mock('@/lib/table/orchestration', () => ({ performDeleteTableRow: mockPerformDeleteRow }))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { DELETE } from '@/app/api/v2/tables/[tableId]/rows/[rowId]/route'

const TABLE = { id: 'table-1', workspaceId: 'ws-1', schema: { columns: [] } }

function callDelete() {
  const req = new NextRequest(
    'http://localhost:3000/api/v2/tables/table-1/rows/row-1?workspaceId=ws-1',
    { method: 'DELETE' }
  )
  return DELETE(req, { params: Promise.resolve({ tableId: 'table-1', rowId: 'row-1' }) })
}

describe('DELETE /api/v2/tables/[tableId]/rows/[rowId]', () => {
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
  })

  it('delegates to the orchestration function rather than deleting inline', async () => {
    mockPerformDeleteRow.mockResolvedValue({ success: true })

    const res = await callDelete()

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ deletedCount: 1, deletedRowIds: ['row-1'] })
    // The orchestration function routes through the row service, which applies
    // the delete lock and the row-count decrement; the raw delete this replaced
    // skipped both.
    expect(mockPerformDeleteRow).toHaveBeenCalledWith(
      expect.objectContaining({ table: TABLE, rowId: 'row-1' })
    )
  })

  it.each([
    ['locked', 423, 'LOCKED'],
    ['not_found', 404, 'NOT_FOUND'],
  ])('maps a %s failure to %i', async (errorCode, status, code) => {
    mockPerformDeleteRow.mockResolvedValue({ success: false, errorCode, error: 'nope' })

    const res = await callDelete()

    expect(res.status).toBe(status)
    expect((await res.json()).error.code).toBe(code)
  })

  it('names the lock on a 423 that arrived as a classified outcome, not a throw', async () => {
    mockPerformDeleteRow.mockResolvedValue({
      success: false,
      errorCode: 'locked',
      error: 'Row deletes are locked for this table',
      lock: 'delete',
    })

    const res = await callDelete()

    expect(res.status).toBe(423)
    expect((await res.json()).error.details).toEqual({ lock: 'delete' })
  })

  it('omits details entirely when the lock kind is unknown', async () => {
    // A caller branching on `details.lock` should see absence, not a null.
    mockPerformDeleteRow.mockResolvedValue({ success: false, errorCode: 'locked', error: 'nope' })

    const res = await callDelete()

    expect((await res.json()).error.details).toBeUndefined()
  })
})
