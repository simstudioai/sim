/**
 * @vitest-environment node
 *
 * Public v2 background import. Two orderings are load-bearing: the
 * client-supplied `fileKey` is checked against the workspace's own storage
 * prefix, and the table's locks are asserted BEFORE the single write-job slot
 * is claimed so a locked table never holds the slot.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceScope,
  mockCheckAccess,
  mockMarkTableJobRunning,
  mockReleaseJobClaim,
  mockRunDetached,
  mockAssertRowInsert,
  mockAssertRowDelete,
  mockGateError,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockCheckAccess: vi.fn(),
  mockMarkTableJobRunning: vi.fn(),
  mockReleaseJobClaim: vi.fn(),
  mockRunDetached: vi.fn(),
  mockAssertRowInsert: vi.fn(),
  mockAssertRowDelete: vi.fn(),
  mockGateError: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceScope: mockResolveWorkspaceScope,
}))

vi.mock('@/app/api/table/utils', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  checkAccess: mockCheckAccess,
}))

vi.mock('@/lib/table/jobs/service', () => ({
  markTableJobRunning: mockMarkTableJobRunning,
  releaseJobClaim: mockReleaseJobClaim,
}))
// Only the assert helpers are stubbed — `TableLockedError` stays real so the
// route's `v2TableLockError` recognizes it by `instanceof` and reports the lock
// kind, exactly as it would in production.
vi.mock('@/lib/table/mutation-locks', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertRowInsert: mockAssertRowInsert,
  assertRowDelete: mockAssertRowDelete,
  assertSchemaMutable: vi.fn(),
}))
vi.mock('@/lib/table/import-runner', () => ({ runTableImport: vi.fn() }))
vi.mock('@/lib/core/utils/background', () => ({ runDetached: mockRunDetached }))
vi.mock('@/lib/core/config/env-flags', () => ({ isTriggerDevEnabled: false }))
vi.mock('@/lib/users/queries', () => ({
  getUserSettings: vi.fn().mockResolvedValue({ timezone: 'UTC' }),
}))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mockGateError }))

import { TableLockedError } from '@/lib/table/mutation-locks'
import { POST } from '@/app/api/v2/tables/[tableId]/import-async/route'

const TABLE = { id: 'table-1', workspaceId: 'ws-1', schema: { columns: [] }, archivedAt: null }

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  workspaceId: 'ws-1',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-01-01T01:00:00Z'),
}

const BODY = {
  workspaceId: 'ws-1',
  fileKey: 'workspace/ws-1/imports/contacts.csv',
  fileName: 'contacts.csv',
  mode: 'append',
}

function callPost(body: unknown) {
  const req = new NextRequest('http://localhost:3000/api/v2/tables/table-1/import-async', {
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
  mockMarkTableJobRunning.mockResolvedValue(true)
  // `clearAllMocks` drops recorded calls but keeps implementations, so the
  // throwing lock assertion below would leak into every later test.
  mockAssertRowInsert.mockImplementation(() => {})
  mockAssertRowDelete.mockImplementation(() => {})
  mockGateError.mockResolvedValue(null)
})

describe('POST /api/v2/tables/[tableId]/import-async', () => {
  it('claims the job slot and dispatches the import', async () => {
    const res = await callPost(BODY)

    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.tableId).toBe('table-1')
    expect(data.importId).toEqual(expect.any(String))
    expect(mockMarkTableJobRunning).toHaveBeenCalledWith('table-1', data.importId, 'import')
    expect(mockRunDetached).toHaveBeenCalledWith('table-import', expect.any(Function))
  })

  it('rejects a fileKey outside the workspace prefix', async () => {
    const res = await callPost({ ...BODY, fileKey: 'workspace/ws-other/imports/contacts.csv' })

    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toBe('Invalid file key for workspace')
    expect(mockMarkTableJobRunning).not.toHaveBeenCalled()
  })

  it('asserts the insert lock BEFORE claiming the slot, and names the lock in the 423', async () => {
    mockAssertRowInsert.mockImplementation(() => {
      throw new TableLockedError('insert')
    })

    const res = await callPost(BODY)

    expect(res.status).toBe(423)
    expect(mockMarkTableJobRunning).not.toHaveBeenCalled()
    // A table has four independent locks, so "LOCKED" alone doesn't tell the
    // caller which one to clear.
    const body = await res.json()
    expect(body.error.code).toBe('LOCKED')
    expect(body.error.details).toEqual({ lock: 'insert' })
  })

  it('asserts the delete lock too when the mode replaces rows', async () => {
    await callPost({ ...BODY, mode: 'replace' })

    expect(mockAssertRowDelete).toHaveBeenCalledWith(TABLE)
  })

  it('409s when another job already holds the slot', async () => {
    mockMarkTableJobRunning.mockResolvedValue(false)

    const res = await callPost(BODY)

    expect(res.status).toBe(409)
    expect(mockRunDetached).not.toHaveBeenCalled()
  })

  it('400s an unsupported file extension', async () => {
    const res = await callPost({ ...BODY, fileName: 'contacts.xlsx' })

    expect(res.status).toBe(400)
    expect(mockMarkTableJobRunning).not.toHaveBeenCalled()
  })

  it('400s a body missing fileKey', async () => {
    const res = await callPost({ workspaceId: 'ws-1', fileName: 'c.csv', mode: 'append' })

    expect(res.status).toBe(400)
    expect(mockCheckAccess).not.toHaveBeenCalled()
  })

  it('403s a read-only member', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callPost(BODY)

    expect(res.status).toBe(403)
    expect(mockMarkTableJobRunning).not.toHaveBeenCalled()
  })

  it('404s with the gate off, before any work', async () => {
    mockGateError.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
        status: 404,
      })
    )

    const res = await callPost(BODY)

    expect(res.status).toBe(404)
    expect(mockCheckAccess).not.toHaveBeenCalled()
    expect(mockMarkTableJobRunning).not.toHaveBeenCalled()
  })

  it('429s a throttled caller', async () => {
    mockCheckRateLimit.mockResolvedValue({
      ...RATE_LIMIT_OK,
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
    })

    const res = await callPost(BODY)

    expect(res.status).toBe(429)
    expect(mockMarkTableJobRunning).not.toHaveBeenCalled()
  })
})
