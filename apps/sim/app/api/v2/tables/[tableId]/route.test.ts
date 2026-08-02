/**
 * @vitest-environment node
 *
 * Public v2 table delete and update. Delete hands the actor to the service so
 * the audit is emitted there — and only for a delete that actually archived a
 * row. Update routes each field to its own orchestration call, and carries the
 * first-party permission split: renaming needs `write`, locking needs `admin`.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceScope,
  mockCheckAccess,
  mockPerformDeleteTable,
  mockPerformRenameTable,
  mockPerformMoveTableToFolder,
  mockPerformUpdateTableLocks,
  mockRecordAudit,
  mockGetTableById,
  mockFindActiveFolder,
  mockIsFeatureEnabled,
  mockGateError,
  mockSignalSchemaChanged,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockCheckAccess: vi.fn(),
  mockPerformDeleteTable: vi.fn(),
  mockPerformRenameTable: vi.fn(),
  mockPerformMoveTableToFolder: vi.fn(),
  mockPerformUpdateTableLocks: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockGetTableById: vi.fn(),
  mockFindActiveFolder: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockGateError: vi.fn(),
  mockSignalSchemaChanged: vi.fn(),
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
  getTableById: mockGetTableById,
  updateRow: vi.fn(),
  rowDataNameToId: vi.fn(),
  buildIdByName: vi.fn(),
}))

vi.mock('@/lib/table/events', () => ({
  signalTableSchemaChanged: mockSignalSchemaChanged,
}))
vi.mock('@/lib/folders/queries', () => ({ findActiveFolder: mockFindActiveFolder }))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: mockIsFeatureEnabled }))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: vi.fn().mockResolvedValue({ organizationId: 'org-1' }),
}))

vi.mock('@/lib/table/orchestration', () => ({
  performDeleteTable: mockPerformDeleteTable,
  performRenameTable: mockPerformRenameTable,
  performMoveTableToFolder: mockPerformMoveTableToFolder,
  performUpdateTableLocks: mockPerformUpdateTableLocks,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mockGateError }))

import { DELETE, PATCH } from '@/app/api/v2/tables/[tableId]/route'

const UNLOCKED = {
  schemaLocked: false,
  insertLocked: false,
  updateLocked: false,
  deleteLocked: false,
}
const TABLE = {
  id: 'table-1',
  name: 'Tasks',
  workspaceId: 'ws-1',
  schema: { columns: [] },
  locks: UNLOCKED,
}
const UPDATED_TABLE = {
  ...TABLE,
  name: 'Renamed',
  description: null,
  rowCount: 0,
  maxRows: 1000,
  folderId: null,
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

function callDelete() {
  const req = new NextRequest('http://localhost:3000/api/v2/tables/table-1?workspaceId=ws-1', {
    method: 'DELETE',
  })
  return DELETE(req, { params: Promise.resolve({ tableId: 'table-1' }) })
}

function callPatch(body: unknown) {
  const req = new NextRequest('http://localhost:3000/api/v2/tables/table-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return PATCH(req, { params: Promise.resolve({ tableId: 'table-1' }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
  mockResolveWorkspaceScope.mockResolvedValue(null)
  mockCheckAccess.mockResolvedValue({ ok: true, table: TABLE })
  mockGetTableById.mockResolvedValue(UPDATED_TABLE)
  mockFindActiveFolder.mockResolvedValue({ id: 'folder-1' })
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockGateError.mockResolvedValue(null)
})

describe('DELETE /api/v2/tables/[tableId]', () => {
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

describe('PATCH /api/v2/tables/[tableId]', () => {
  it('renames through the orchestration function and returns the re-read table', async () => {
    mockPerformRenameTable.mockResolvedValue({ success: true })

    const res = await callPatch({ workspaceId: 'ws-1', name: 'Renamed' })

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({
      table: {
        id: 'table-1',
        name: 'Renamed',
        description: null,
        schema: { columns: [] },
        rowCount: 0,
        maxRows: 1000,
        folderId: null,
        locks: UNLOCKED,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    })
    expect(mockPerformRenameTable).toHaveBeenCalledWith(
      expect.objectContaining({ table: TABLE, newName: 'Renamed', userId: 'user-1' })
    )
    expect(mockPerformMoveTableToFolder).not.toHaveBeenCalled()
    expect(mockPerformUpdateTableLocks).not.toHaveBeenCalled()
  })

  it('moves the table only after confirming the folder belongs to the workspace', async () => {
    mockPerformMoveTableToFolder.mockResolvedValue({ success: true })

    const res = await callPatch({ workspaceId: 'ws-1', folderId: 'folder-1' })

    expect(res.status).toBe(200)
    expect(mockFindActiveFolder).toHaveBeenCalledWith('folder-1', 'ws-1', 'table')
    expect(mockPerformMoveTableToFolder).toHaveBeenCalledWith(
      expect.objectContaining({ table: TABLE, folderId: 'folder-1', userId: 'user-1' })
    )
  })

  it('404s a folder from outside the workspace without attempting the move', async () => {
    mockFindActiveFolder.mockResolvedValue(null)

    const res = await callPatch({ workspaceId: 'ws-1', folderId: 'folder-elsewhere' })

    expect(res.status).toBe(404)
    expect(mockPerformMoveTableToFolder).not.toHaveBeenCalled()
  })

  it('rejects a bad folder without applying the rename that came with it', async () => {
    // The three operations are separate transactions, so validation has to run
    // before the first write — otherwise a rejected PATCH still renames.
    mockFindActiveFolder.mockResolvedValue(null)

    const res = await callPatch({
      workspaceId: 'ws-1',
      name: 'Renamed',
      folderId: 'folder-elsewhere',
    })

    expect(res.status).toBe(404)
    expect(mockPerformRenameTable).not.toHaveBeenCalled()
    expect(mockPerformUpdateTableLocks).not.toHaveBeenCalled()
    expect(mockSignalSchemaChanged).not.toHaveBeenCalled()
  })

  it('rejects a lock change from a non-admin without applying the rename beside it', async () => {
    mockCheckAccess.mockImplementation(async (_tableId, _userId, level) =>
      level === 'admin' ? { ok: false, status: 403 } : { ok: true, table: TABLE }
    )

    const res = await callPatch({
      workspaceId: 'ws-1',
      name: 'Renamed',
      locks: { deleteLocked: true },
    })

    expect(res.status).toBe(403)
    expect(mockPerformRenameTable).not.toHaveBeenCalled()
  })

  it('still signals collaborators when a later operation fails after an earlier one landed', async () => {
    // A mid-write fault can't be rolled back across three transactions, so the
    // clients must at least be told to refetch what did apply.
    mockPerformRenameTable.mockResolvedValue({ success: true })
    mockPerformMoveTableToFolder.mockResolvedValue({
      success: false,
      errorCode: 'not_found',
      error: 'gone',
    })

    const res = await callPatch({ workspaceId: 'ws-1', name: 'Renamed', folderId: 'folder-1' })

    expect(res.status).toBe(404)
    expect(mockPerformRenameTable).toHaveBeenCalled()
    expect(mockSignalSchemaChanged).toHaveBeenCalledWith('table-1')
  })

  it('rejects a lock change from a write-level caller', async () => {
    mockCheckAccess.mockImplementation(async (_tableId, _userId, level) =>
      level === 'admin' ? { ok: false, status: 403 } : { ok: true, table: TABLE }
    )

    const res = await callPatch({ workspaceId: 'ws-1', locks: { deleteLocked: true } })

    expect(res.status).toBe(403)
    expect(mockPerformUpdateTableLocks).not.toHaveBeenCalled()
  })

  it('rejects enabling a lock while the feature is off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)

    const res = await callPatch({ workspaceId: 'ws-1', locks: { deleteLocked: true } })

    expect(res.status).toBe(403)
    expect((await res.json()).error.message).toBe('Table locks are not enabled')
    expect(mockPerformUpdateTableLocks).not.toHaveBeenCalled()
  })

  it('still clears a lock while the feature is off, so a locked table is never stranded', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    mockCheckAccess.mockResolvedValue({
      ok: true,
      table: { ...TABLE, locks: { ...UNLOCKED, deleteLocked: true } },
    })
    mockPerformUpdateTableLocks.mockResolvedValue({ success: true })

    const res = await callPatch({ workspaceId: 'ws-1', locks: { deleteLocked: false } })

    expect(res.status).toBe(200)
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled()
    expect(mockPerformUpdateTableLocks).toHaveBeenCalledWith(
      expect.objectContaining({ tableId: 'table-1', partial: { deleteLocked: false } })
    )
  })

  it('maps a duplicate-name rename to 409 CONFLICT', async () => {
    mockPerformRenameTable.mockResolvedValue({
      success: false,
      errorCode: 'conflict',
      error: 'A table named "Renamed" already exists',
    })

    const res = await callPatch({ workspaceId: 'ws-1', name: 'Renamed' })

    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONFLICT')
  })

  it('rejects a body with nothing to change', async () => {
    const res = await callPatch({ workspaceId: 'ws-1' })

    expect(res.status).toBe(400)
    expect(mockPerformRenameTable).not.toHaveBeenCalled()
  })

  it('404s a table in another workspace without writing', async () => {
    mockCheckAccess.mockResolvedValue({ ok: true, table: { ...TABLE, workspaceId: 'ws-other' } })

    const res = await callPatch({ workspaceId: 'ws-1', name: 'Renamed' })

    expect(res.status).toBe(404)
    expect(mockPerformRenameTable).not.toHaveBeenCalled()
  })

  it('404s with the gate off, before any work', async () => {
    mockGateError.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
        status: 404,
      })
    )

    const res = await callPatch({ workspaceId: 'ws-1', name: 'Renamed' })

    expect(res.status).toBe(404)
    expect(mockCheckAccess).not.toHaveBeenCalled()
    expect(mockPerformRenameTable).not.toHaveBeenCalled()
  })

  it('429s a throttled caller', async () => {
    mockCheckRateLimit.mockResolvedValue({
      ...RATE_LIMIT_OK,
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
    })

    const res = await callPatch({ workspaceId: 'ws-1', name: 'Renamed' })

    expect(res.status).toBe(429)
    expect(mockPerformRenameTable).not.toHaveBeenCalled()
  })
})
