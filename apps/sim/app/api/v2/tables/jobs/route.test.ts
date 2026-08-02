/**
 * @vitest-environment node
 *
 * Public v2 export-job listing — the observability half of the async
 * import/export story. Workspace-scoped, so the permission check is the
 * workspace one rather than a table's.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimit, mockResolveWorkspaceAccess, mockListJobs, mockGateError } = vi.hoisted(
  () => ({
    mockCheckRateLimit: vi.fn(),
    mockResolveWorkspaceAccess: vi.fn(),
    mockListJobs: vi.fn(),
    mockGateError: vi.fn(),
  })
)

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/table/jobs/service', () => ({ listWorkspaceExportJobs: mockListJobs }))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mockGateError }))

import { GET } from '@/app/api/v2/tables/jobs/route'

const JOB = {
  jobId: 'job-1',
  tableId: 'table-1',
  tableName: 'customers',
  status: 'ready',
  rowsProcessed: 12,
  format: 'csv',
  hasResult: true,
  error: null,
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

function callGet(query = 'workspaceId=ws-1&type=export') {
  return GET(
    new NextRequest(`http://localhost:3000/api/v2/tables/jobs?${query}`, { method: 'GET' })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
  mockResolveWorkspaceAccess.mockResolvedValue(null)
  mockListJobs.mockResolvedValue([JOB])
  mockGateError.mockResolvedValue(null)
})

describe('GET /api/v2/tables/jobs', () => {
  it('returns the workspace export jobs as one full page', async () => {
    const res = await callGet()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: [JOB], nextCursor: null })
    expect(mockListJobs).toHaveBeenCalledWith('ws-1')
  })

  it('400s a request with no type, so widening the parameter can never surprise a caller', async () => {
    const res = await callGet('workspaceId=ws-1')

    expect(res.status).toBe(400)
    expect(mockListJobs).not.toHaveBeenCalled()
  })

  it('400s an unsupported job type', async () => {
    const res = await callGet('workspaceId=ws-1&type=import')

    expect(res.status).toBe(400)
    expect(mockListJobs).not.toHaveBeenCalled()
  })

  it('403s a caller without workspace access', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })

    const res = await callGet()

    expect(res.status).toBe(403)
    expect(mockListJobs).not.toHaveBeenCalled()
  })

  it('404s with the gate off, before any work', async () => {
    mockGateError.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
        status: 404,
      })
    )

    const res = await callGet()

    expect(res.status).toBe(404)
    expect(mockListJobs).not.toHaveBeenCalled()
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
    expect(mockListJobs).not.toHaveBeenCalled()
  })
})
