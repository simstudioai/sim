/**
 * @vitest-environment node
 *
 * Public v2 table delete: the actor is handed to the service so the audit is
 * emitted there — and only for a delete that actually archived a row.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceScope,
  mockCheckAccess,
  mockPerformDeleteTable,
  mockRecordAudit,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockCheckAccess: vi.fn(),
  mockPerformDeleteTable: vi.fn(),
  mockRecordAudit: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { TABLE_DELETED: 'table.deleted', TABLE_UPDATED: 'table.updated' },
  AuditResourceType: { TABLE: 'table' },
  recordAudit: mockRecordAudit,
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

vi.mock('@/lib/table/orchestration', () => ({ performDeleteTable: mockPerformDeleteTable }))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { DELETE } from '@/app/api/v2/tables/[tableId]/route'

const TABLE = { id: 'table-1', name: 'Tasks', workspaceId: 'ws-1', schema: { columns: [] } }

function callDelete() {
  const req = new NextRequest('http://localhost:3000/api/v2/tables/table-1?workspaceId=ws-1', {
    method: 'DELETE',
  })
  return DELETE(req, { params: Promise.resolve({ tableId: 'table-1' }) })
}

describe('DELETE /api/v2/tables/[tableId]', () => {
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

  it('delegates to the orchestration function with the resolved table and actor', async () => {
    mockPerformDeleteTable.mockResolvedValue({ success: true })

    const res = await callDelete()

    expect(res.status).toBe(200)
    expect(mockPerformDeleteTable).toHaveBeenCalledWith(
      expect.objectContaining({ table: TABLE, userId: 'user-1' })
    )
    // The route no longer audits: doing so out here fired TABLE_DELETED even
    // when the delete was a no-op on an already-archived table.
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('returns 423 LOCKED for a delete-locked table instead of a 500', async () => {
    mockPerformDeleteTable.mockResolvedValue({
      success: false,
      errorCode: 'locked',
      error: 'Table is locked',
    })

    const res = await callDelete()

    expect(res.status).toBe(423)
    expect((await res.json()).error.code).toBe('LOCKED')
  })
})
