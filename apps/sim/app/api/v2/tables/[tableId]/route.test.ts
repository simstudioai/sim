/**
 * @vitest-environment node
 *
 * Public v2 table delete and update. Delete hands the actor to the service so
 * the audit is emitted there — and only for a delete that actually archived a
 * row. Update routes each field to its own orchestration call; lock flags are
 * read-only on this surface and a request carrying them is refused outright.
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
        job: null,
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

  it('surfaces a running import so an async job is observable, not just startable', async () => {
    // `POST /import-async` and `POST /job/cancel` let a caller start and stop an
    // import; without this the table never reports that it is running, so there
    // is nothing to poll between the two.
    mockGetTableById.mockResolvedValue({
      ...UPDATED_TABLE,
      jobStatus: 'running',
      jobId: 'job-1',
      jobType: 'import',
      jobRowsProcessed: 250,
      jobError: null,
    })
    mockPerformRenameTable.mockResolvedValue({ success: true })

    const res = await callPatch({ workspaceId: 'ws-1', name: 'Renamed' })

    expect((await res.json()).data.table.job).toEqual({
      id: 'job-1',
      type: 'import',
      status: 'running',
      rowsProcessed: 250,
      error: null,
    })
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

  it('reports which operations landed when a later one fails', async () => {
    // The three writes commit independently, so rather than pretending
    // atomicity the error states what is already live — a caller can reconcile
    // instead of re-reading and diffing.
    mockPerformRenameTable.mockResolvedValue({ success: true })
    mockPerformMoveTableToFolder.mockResolvedValue({
      success: false,
      errorCode: 'not_found',
      error: 'gone',
    })

    const res = await callPatch({ workspaceId: 'ws-1', name: 'Renamed', folderId: 'folder-1' })

    expect(res.status).toBe(404)
    expect((await res.json()).error.details).toEqual({ applied: ['name'] })
  })

  it('omits the applied list when the very first operation fails', async () => {
    // `details.applied` present must always mean "these changes are live".
    mockPerformRenameTable.mockResolvedValue({
      success: false,
      errorCode: 'conflict',
      error: 'taken',
    })

    const res = await callPatch({ workspaceId: 'ws-1', name: 'Renamed', folderId: 'folder-1' })

    expect(res.status).toBe(409)
    expect((await res.json()).error.details).toBeUndefined()
    expect(mockPerformMoveTableToFolder).not.toHaveBeenCalled()
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

  /**
   * Locks are read-only on the public API. A `write`-level API key can already
   * mutate the table, so letting it clear a lock would let it undo the guard
   * placed there to stop it. The strict body rejects the field outright rather
   * than dropping it silently, which would report success for a change that
   * never happened.
   */
  it('rejects a lock change instead of applying or silently ignoring it', async () => {
    const res = await callPatch({ workspaceId: 'ws-1', locks: { deleteLocked: true } })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(JSON.stringify(body.error)).toContain('locks')
    expect(mockPerformUpdateTableLocks).not.toHaveBeenCalled()
  })

  it('rejects a lock change even when paired with an otherwise valid rename', async () => {
    const res = await callPatch({
      workspaceId: 'ws-1',
      name: 'Renamed',
      locks: { deleteLocked: false },
    })

    expect(res.status).toBe(400)
    // The whole request is refused — the rename must not land either.
    expect(mockPerformRenameTable).not.toHaveBeenCalled()
  })

  /**
   * The re-read runs after the writes have committed, so a failure there must
   * still name what landed. Reporting a bare 500 tells the caller nothing took
   * effect and it retries into a duplicate-name conflict.
   */
  it('reports the applied operations when the final re-read throws', async () => {
    mockPerformRenameTable.mockResolvedValue({ success: true })
    mockGetTableById.mockRejectedValue(new Error('connection reset'))

    const res = await callPatch({ workspaceId: 'ws-1', name: 'Renamed' })

    expect(res.status).toBe(500)
    expect((await res.json()).error.details).toEqual({ applied: ['name'] })
  })

  it('reports the applied operations when the re-read finds the table archived', async () => {
    mockPerformRenameTable.mockResolvedValue({ success: true })
    mockGetTableById.mockResolvedValue(null)

    const res = await callPatch({ workspaceId: 'ws-1', name: 'Renamed' })

    expect(res.status).toBe(404)
    expect((await res.json()).error.details).toEqual({ applied: ['name'] })
  })

  it('omits applied details when the failure happened before any write', async () => {
    mockGetTableById.mockRejectedValue(new Error('connection reset'))

    const res = await callPatch({ workspaceId: 'ws-1', folderId: 'nope' })

    // Absence is meaningful: nothing is live, so a retry is safe.
    expect((await res.json()).error.details).toBeUndefined()
  })

  it('still reports the stored lock flags on the table it returns', async () => {
    // The response is a re-read, so the locked state has to come from there.
    mockGetTableById.mockResolvedValue({
      ...UPDATED_TABLE,
      locks: { ...UNLOCKED, deleteLocked: true },
    })

    const res = await callPatch({ workspaceId: 'ws-1', name: 'Renamed' })

    expect(res.status).toBe(200)
    expect((await res.json()).data.table.locks).toMatchObject({ deleteLocked: true })
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
