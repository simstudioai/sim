/**
 * @vitest-environment node
 */
import { hybridAuthMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'

const { mockCheckAccess, mockMarkJobCanceled, mockGetTableJob, mockAppendTableEvent } = vi.hoisted(
  () => ({
    mockCheckAccess: vi.fn(),
    mockMarkJobCanceled: vi.fn(),
    mockGetTableJob: vi.fn(),
    mockAppendTableEvent: vi.fn(),
  })
)

vi.mock('@/lib/table/jobs/service', () => ({
  markJobCanceled: mockMarkJobCanceled,
  getTableJob: mockGetTableJob,
}))
vi.mock('@/lib/table/events', () => ({ appendTableEvent: mockAppendTableEvent }))
vi.mock('@/app/api/table/utils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    checkAccess: mockCheckAccess,
    accessError: (result: { status: number }) =>
      NextResponse.json({ error: 'denied' }, { status: result.status }),
  }
})

import { POST } from '@/app/api/table/[tableId]/job/cancel/route'

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

function makeRequest(body: unknown, tableId = 'tbl_1') {
  const req = new NextRequest(`http://localhost:3000/api/table/${tableId}/job/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ tableId }) })
}

const validBody = { workspaceId: 'workspace-1', jobId: 'job_1' }

describe('POST /api/table/[tableId]/job/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable() })
    mockMarkJobCanceled.mockResolvedValue(true)
    mockGetTableJob.mockResolvedValue({
      id: 'job_1',
      type: 'delete',
      status: 'running',
      payload: null,
    })
  })

  it('cancels the job and emits a typed cancel event', async () => {
    const response = await makeRequest(validBody)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual({ canceled: true })
    expect(mockMarkJobCanceled).toHaveBeenCalledWith('tbl_1', 'job_1')
    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'job', type: 'delete', status: 'canceled', jobId: 'job_1' })
    )
  })

  it('does not emit an event when nothing was running', async () => {
    mockMarkJobCanceled.mockResolvedValue(false)
    const response = await makeRequest(validBody)
    const data = await response.json()
    expect(data.data).toEqual({ canceled: false })
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({ success: false })
    const response = await makeRequest(validBody)
    expect(response.status).toBe(401)
    expect(mockMarkJobCanceled).not.toHaveBeenCalled()
  })

  it('returns 400 on workspace mismatch', async () => {
    const response = await makeRequest({ ...validBody, workspaceId: 'other' })
    expect(response.status).toBe(400)
    expect(mockMarkJobCanceled).not.toHaveBeenCalled()
  })
})
