/**
 * @vitest-environment node
 */
import { createTableDefinition, hybridAuthMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckAccess, mockGetTableJob, mockGetUserPermissionConfig, mockPresign } = vi.hoisted(
  () => ({
    mockCheckAccess: vi.fn(),
    mockGetTableJob: vi.fn(),
    mockGetUserPermissionConfig: vi.fn(),
    mockPresign: vi.fn(),
  })
)

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: mockGetUserPermissionConfig,
}))
vi.mock('@/lib/table/jobs/service', () => ({ getTableJob: mockGetTableJob }))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  generatePresignedDownloadUrl: mockPresign,
}))
vi.mock('@/app/api/table/utils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    checkAccess: mockCheckAccess,
    accessError: (result: { status: number }) =>
      NextResponse.json({ error: 'denied' }, { status: result.status }),
  }
})

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { GET } from '@/app/api/table/[tableId]/export/download/route'

const table = createTableDefinition({ id: 'tbl_1', workspaceId: 'workspace-1' })

function makeRequest(tableId = 'tbl_1') {
  const req = new NextRequest(
    `http://localhost:3000/api/table/${tableId}/export/download?workspaceId=workspace-1&jobId=job-1`
  )
  return GET(req, { params: Promise.resolve({ tableId }) })
}

describe('GET /api/table/[tableId]/export/download', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
    })
    mockCheckAccess.mockResolvedValue({ ok: true, table })
    mockGetUserPermissionConfig.mockResolvedValue(DEFAULT_PERMISSION_GROUP_CONFIG)
    mockGetTableJob.mockResolvedValue({
      type: 'export',
      status: 'ready',
      payload: { resultKey: 'exports/tbl_1.csv', fileName: 'tbl_1.csv' },
    })
    mockPresign.mockResolvedValue('https://example.com/signed')
  })

  it('presigns a ready export', async () => {
    const response = await makeRequest()
    expect(response.status).toBe(200)
  })

  it('refuses with the structured capability detail when the group withholds tables.export', async () => {
    mockGetUserPermissionConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disableTableExport: true,
    })

    const response = await makeRequest()

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: "Exporting a table is not available under your organization's permission group",
      details: { code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' },
    })
    expect(mockGetTableJob).not.toHaveBeenCalled()
    expect(mockPresign).not.toHaveBeenCalled()
  })
})
