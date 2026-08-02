/**
 * @vitest-environment node
 *
 * Public v2 job cancel — the "stop it" half of the async import/export story.
 * Idempotent by design: cancelling a job that already finished reports
 * `canceled: false` rather than failing.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceScope,
  mockCheckAccess,
  mockGetTableJob,
  mockMarkJobCanceled,
  mockAppendTableEvent,
  mockGateError,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockCheckAccess: vi.fn(),
  mockGetTableJob: vi.fn(),
  mockMarkJobCanceled: vi.fn(),
  mockAppendTableEvent: vi.fn(),
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
  getTableJob: mockGetTableJob,
  markJobCanceled: mockMarkJobCanceled,
}))
vi.mock('@/lib/table/events', () => ({ appendTableEvent: mockAppendTableEvent }))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mockGateError }))

import { POST } from '@/app/api/v2/tables/[tableId]/job/cancel/route'

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
  const req = new NextRequest('http://localhost:3000/api/v2/tables/table-1/job/cancel', {
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
  mockGetTableJob.mockResolvedValue({ type: 'import' })
  mockMarkJobCanceled.mockResolvedValue(true)
  mockGateError.mockResolvedValue(null)
})

describe('POST /api/v2/tables/[tableId]/job/cancel', () => {
  it('cancels the job and emits the event with the job’s real type', async () => {
    const res = await callPost({ workspaceId: 'ws-1', jobId: 'job-1' })

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ jobId: 'job-1', canceled: true })
    expect(mockMarkJobCanceled).toHaveBeenCalledWith('table-1', 'job-1')
    // The table-level derivation excludes exports, so the type has to come from
    // the job's own row or an export cancel would announce itself as an import.
    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'job', type: 'import', jobId: 'job-1', status: 'canceled' })
    )
  })

  it('reads the type from an export job rather than defaulting', async () => {
    mockGetTableJob.mockResolvedValue({ type: 'export' })

    await callPost({ workspaceId: 'ws-1', jobId: 'job-1' })

    expect(mockAppendTableEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'export' }))
  })

  it('reports canceled: false for a job that already finished, and emits nothing', async () => {
    mockMarkJobCanceled.mockResolvedValue(false)

    const res = await callPost({ workspaceId: 'ws-1', jobId: 'job-1' })

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ jobId: 'job-1', canceled: false })
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it('400s a body with no jobId', async () => {
    const res = await callPost({ workspaceId: 'ws-1' })

    expect(res.status).toBe(400)
    expect(mockMarkJobCanceled).not.toHaveBeenCalled()
  })

  it('404s a table in another workspace without cancelling', async () => {
    mockCheckAccess.mockResolvedValue({ ok: true, table: { ...TABLE, workspaceId: 'ws-other' } })

    const res = await callPost({ workspaceId: 'ws-1', jobId: 'job-1' })

    expect(res.status).toBe(404)
    expect(mockMarkJobCanceled).not.toHaveBeenCalled()
  })

  it('403s a read-only member', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callPost({ workspaceId: 'ws-1', jobId: 'job-1' })

    expect(res.status).toBe(403)
    expect(mockMarkJobCanceled).not.toHaveBeenCalled()
  })

  it('404s with the gate off, before any work', async () => {
    mockGateError.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
        status: 404,
      })
    )

    const res = await callPost({ workspaceId: 'ws-1', jobId: 'job-1' })

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

    const res = await callPost({ workspaceId: 'ws-1', jobId: 'job-1' })

    expect(res.status).toBe(429)
    expect(mockMarkJobCanceled).not.toHaveBeenCalled()
  })
})
