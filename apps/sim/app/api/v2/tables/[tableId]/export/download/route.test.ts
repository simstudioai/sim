/**
 * @vitest-environment node
 *
 * Public v2 export download. The three failure modes are deliberately
 * distinct — a caller polling to completion has to tell "not yet" (409) from
 * "never again" (410) from "wrong id" (404).
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceScope,
  mockCheckAccess,
  mockGetTableJob,
  mockPresignedUrl,
  mockGateError,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockCheckAccess: vi.fn(),
  mockGetTableJob: vi.fn(),
  mockPresignedUrl: vi.fn(),
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

vi.mock('@/lib/table/jobs/service', () => ({ getTableJob: mockGetTableJob }))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  generatePresignedDownloadUrl: mockPresignedUrl,
}))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mockGateError }))

import { GET } from '@/app/api/v2/tables/[tableId]/export/download/route'

const TABLE = { id: 'table-1', workspaceId: 'ws-1', schema: { columns: [] } }
const READY_JOB = {
  type: 'export',
  status: 'ready',
  payload: { format: 'csv', resultKey: 'workspace/ws-1/exports/customers.csv' },
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
    'http://localhost:3000/api/v2/tables/table-1/export/download?workspaceId=ws-1&jobId=job-1',
    { method: 'GET' }
  )
  return GET(req, { params: Promise.resolve({ tableId: 'table-1' }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
  mockResolveWorkspaceScope.mockResolvedValue(null)
  mockCheckAccess.mockResolvedValue({ ok: true, table: TABLE })
  mockGetTableJob.mockResolvedValue(READY_JOB)
  mockPresignedUrl.mockResolvedValue('https://storage.example/signed')
  mockGateError.mockResolvedValue(null)
})

describe('GET /api/v2/tables/[tableId]/export/download', () => {
  it('issues a presigned URL for a ready job', async () => {
    const res = await callGet()

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({
      url: 'https://storage.example/signed',
      fileName: 'customers.csv',
    })
    expect(mockGetTableJob).toHaveBeenCalledWith('table-1', 'job-1')
    expect(mockPresignedUrl).toHaveBeenCalledWith(
      'workspace/ws-1/exports/customers.csv',
      'workspace'
    )
  })

  it('404s a job id that is not an export of this table', async () => {
    mockGetTableJob.mockResolvedValue({ type: 'import', status: 'ready' })

    const res = await callGet()

    expect(res.status).toBe(404)
    expect(mockPresignedUrl).not.toHaveBeenCalled()
  })

  it('409s a job that is still running — retry later, not a dead end', async () => {
    mockGetTableJob.mockResolvedValue({ ...READY_JOB, status: 'running' })

    const res = await callGet()

    expect(res.status).toBe(409)
    expect((await res.json()).error.message).toBe('Export is not ready')
  })

  it('410s once the generated file has aged out of storage', async () => {
    mockGetTableJob.mockResolvedValue({ ...READY_JOB, payload: { format: 'csv' } })

    const res = await callGet()

    expect(res.status).toBe(410)
    expect(mockPresignedUrl).not.toHaveBeenCalled()
  })

  it('400s a request with no jobId', async () => {
    const req = new NextRequest(
      'http://localhost:3000/api/v2/tables/table-1/export/download?workspaceId=ws-1',
      { method: 'GET' }
    )
    const res = await GET(req, { params: Promise.resolve({ tableId: 'table-1' }) })

    expect(res.status).toBe(400)
    expect(mockGetTableJob).not.toHaveBeenCalled()
  })

  it('masks a permission failure as 404 so table existence never leaks', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callGet()

    expect(res.status).toBe(404)
    expect(mockGetTableJob).not.toHaveBeenCalled()
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
    expect(mockGetTableJob).not.toHaveBeenCalled()
  })
})
