/**
 * @vitest-environment node
 */
import { hybridAuthMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'

const { mockCheckAccess, mockGetTableJob, mockGeneratePresignedDownloadUrl } = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockGetTableJob: vi.fn(),
  mockGeneratePresignedDownloadUrl: vi.fn(),
}))

vi.mock('@/lib/table/jobs/service', () => ({ getTableJob: mockGetTableJob }))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  generatePresignedDownloadUrl: mockGeneratePresignedDownloadUrl,
}))
vi.mock('@/app/api/table/utils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    checkAccess: mockCheckAccess,
    accessError: (result: { status: number }) =>
      NextResponse.json({ error: 'denied' }, { status: result.status }),
  }
})

import { GET } from '@/app/api/table/[tableId]/export/download/route'

function buildTable(overrides: Partial<TableDefinition> = {}): TableDefinition {
  return {
    id: 'tbl_1',
    name: 'People',
    description: null,
    schema: { columns: [] },
    metadata: null,
    rowCount: 0,
    maxRows: 1_000_000,
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeRequest(query: Record<string, string>, tableId = 'tbl_1') {
  const qs = new URLSearchParams(query).toString()
  const req = new NextRequest(`http://localhost:3000/api/table/${tableId}/export/download?${qs}`)
  return GET(req, { params: Promise.resolve({ tableId }) })
}

const validQuery = { workspaceId: 'workspace-1', jobId: 'job_1' }

describe('GET /api/table/[tableId]/export/download', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable() })
    mockGetTableJob.mockResolvedValue({
      id: 'job_1',
      type: 'export',
      status: 'ready',
      payload: { format: 'csv', resultKey: 'workspace/workspace-1/exports/tbl_1/job_1/people.csv' },
    })
    mockGeneratePresignedDownloadUrl.mockResolvedValue('https://storage.example/signed-url')
  })

  it('resolves a ready export to a presigned URL', async () => {
    const response = await makeRequest(validQuery)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual({ url: 'https://storage.example/signed-url', fileName: 'people.csv' })
    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledWith(
      'workspace/workspace-1/exports/tbl_1/job_1/people.csv',
      'workspace'
    )
  })

  it('404s when the job is missing or not an export', async () => {
    mockGetTableJob.mockResolvedValue({ id: 'job_1', type: 'delete', status: 'ready', payload: {} })
    const response = await makeRequest(validQuery)
    expect(response.status).toBe(404)
  })

  it('409s when the export is not ready yet', async () => {
    mockGetTableJob.mockResolvedValue({
      id: 'job_1',
      type: 'export',
      status: 'running',
      payload: { format: 'csv' },
    })
    const response = await makeRequest(validQuery)
    expect(response.status).toBe(409)
  })

  it('410s when the result file is gone from the payload', async () => {
    mockGetTableJob.mockResolvedValue({
      id: 'job_1',
      type: 'export',
      status: 'ready',
      payload: { format: 'csv' },
    })
    const response = await makeRequest(validQuery)
    expect(response.status).toBe(410)
  })

  it('returns 401 when unauthenticated', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({ success: false })
    const response = await makeRequest(validQuery)
    expect(response.status).toBe(401)
  })

  it('returns 400 on workspace mismatch', async () => {
    const response = await makeRequest({ ...validQuery, workspaceId: 'other-ws' })
    expect(response.status).toBe(400)
  })
})
