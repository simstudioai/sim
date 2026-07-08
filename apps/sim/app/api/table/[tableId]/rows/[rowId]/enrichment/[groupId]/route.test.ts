/**
 * @vitest-environment node
 */
import { hybridAuthMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnrichmentRunDetail, TableDefinition } from '@/lib/table'

const { mockCheckAccess, mockLoadEnrichmentDetail } = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockLoadEnrichmentDetail: vi.fn(),
}))

vi.mock('@/lib/table/rows/executions', () => ({
  loadEnrichmentDetail: mockLoadEnrichmentDetail,
}))
vi.mock('@/app/api/table/utils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    checkAccess: mockCheckAccess,
    accessError: (result: { status: number }) =>
      NextResponse.json({ error: 'denied' }, { status: result.status }),
  }
})

import { GET } from '@/app/api/table/[tableId]/rows/[rowId]/enrichment/[groupId]/route'

function buildTable(): TableDefinition {
  return {
    id: 'tbl_1',
    name: 'People',
    description: null,
    schema: { columns: [] },
    metadata: null,
    rowCount: 1,
    maxRows: 1_000_000,
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function makeRequest(tableId = 'tbl_1', rowId = 'row_1', groupId = 'grp_1') {
  const req = new NextRequest(
    `http://localhost:3000/api/table/${tableId}/rows/${rowId}/enrichment/${groupId}`
  )
  return GET(req, { params: Promise.resolve({ tableId, rowId, groupId }) })
}

const detail: EnrichmentRunDetail = {
  startedAt: '2026-06-18T00:00:00.000Z',
  completedAt: '2026-06-18T00:00:01.000Z',
  durationMs: 1000,
  totalCost: 0.05,
  matchedProvider: 'hunter',
  aborted: false,
  providers: [
    {
      id: 'hunter',
      label: 'Hunter',
      toolId: 'hunter_find_email',
      status: 'matched',
      cost: 0.05,
      durationMs: 1000,
      error: null,
    },
  ],
}

describe('GET /api/table/[tableId]/rows/[rowId]/enrichment/[groupId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable() })
  })

  it('returns the enrichment detail', async () => {
    mockLoadEnrichmentDetail.mockResolvedValue(detail)
    const res = await makeRequest()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true, data: { detail } })
    expect(mockLoadEnrichmentDetail).toHaveBeenCalledWith(
      expect.anything(),
      'tbl_1',
      'row_1',
      'grp_1'
    )
  })

  it('returns null when there is no recorded run', async () => {
    mockLoadEnrichmentDetail.mockResolvedValue(null)
    const res = await makeRequest()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true, data: { detail: null } })
  })

  it('401s when unauthenticated', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({ success: false })
    const res = await makeRequest()
    expect(res.status).toBe(401)
    expect(mockLoadEnrichmentDetail).not.toHaveBeenCalled()
  })

  it('denies when access check fails', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })
    const res = await makeRequest()
    expect(res.status).toBe(403)
    expect(mockLoadEnrichmentDetail).not.toHaveBeenCalled()
  })
})
