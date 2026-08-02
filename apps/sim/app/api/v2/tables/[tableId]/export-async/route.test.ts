/**
 * @vitest-environment node
 *
 * Public v2 background export. Export jobs are read-only, so `read` access is
 * enough and the job bypasses the one-write-job-per-table gate.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceScope,
  mockCheckAccess,
  mockMarkTableJobRunning,
  mockRunDetached,
  mockRecordAudit,
  mockGateError,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockCheckAccess: vi.fn(),
  mockMarkTableJobRunning: vi.fn(),
  mockRunDetached: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockGateError: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { TABLE_EXPORTED: 'table.exported' },
  AuditResourceType: { TABLE: 'table' },
  recordAudit: mockRecordAudit,
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
  releaseJobClaim: vi.fn(),
}))
vi.mock('@/lib/table/export-runner', () => ({ runTableExport: vi.fn() }))
vi.mock('@/lib/core/utils/background', () => ({ runDetached: mockRunDetached }))
vi.mock('@/lib/core/config/env-flags', () => ({ isTriggerDevEnabled: false }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mockGateError }))

import { POST } from '@/app/api/v2/tables/[tableId]/export-async/route'

const TABLE = {
  id: 'table-1',
  name: 'customers',
  workspaceId: 'ws-1',
  rowCount: 3,
  schema: { columns: [] },
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
  const req = new NextRequest('http://localhost:3000/api/v2/tables/table-1/export-async', {
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
  mockGateError.mockResolvedValue(null)
})

describe('POST /api/v2/tables/[tableId]/export-async', () => {
  it('queues the export and returns its job id', async () => {
    const res = await callPost({ workspaceId: 'ws-1', format: 'csv' })

    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.tableId).toBe('table-1')
    expect(data.jobId).toEqual(expect.any(String))
    // Typed `export` so the partial-unique index lets it run alongside a write job.
    expect(mockMarkTableJobRunning).toHaveBeenCalledWith('table-1', data.jobId, 'export', {
      format: 'csv',
    })
    expect(mockRunDetached).toHaveBeenCalledWith('table-export', expect.any(Function))
  })

  it('defaults the format to csv', async () => {
    await callPost({ workspaceId: 'ws-1' })

    expect(mockMarkTableJobRunning).toHaveBeenCalledWith('table-1', expect.any(String), 'export', {
      format: 'csv',
    })
  })

  it('audits at authorization so an abandoned job still records the request', async () => {
    await callPost({ workspaceId: 'ws-1' })

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'table-1',
        metadata: expect.objectContaining({ async: true }),
      })
    )
  })

  it('409s when the claim is lost', async () => {
    mockMarkTableJobRunning.mockResolvedValue(false)

    const res = await callPost({ workspaceId: 'ws-1' })

    expect(res.status).toBe(409)
    expect(mockRunDetached).not.toHaveBeenCalled()
  })

  it('400s an unsupported format', async () => {
    const res = await callPost({ workspaceId: 'ws-1', format: 'xml' })

    expect(res.status).toBe(400)
    expect(mockMarkTableJobRunning).not.toHaveBeenCalled()
  })

  it('masks a permission failure as 404 so table existence never leaks', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callPost({ workspaceId: 'ws-1' })

    expect(res.status).toBe(404)
    expect(mockMarkTableJobRunning).not.toHaveBeenCalled()
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
    expect(mockMarkTableJobRunning).not.toHaveBeenCalled()
  })
})
