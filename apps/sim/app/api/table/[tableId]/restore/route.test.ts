import { hybridAuthMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'

const { mockGetTableById, mockPerformRestoreTable } = vi.hoisted(() => ({
  mockGetTableById: vi.fn(),
  mockPerformRestoreTable: vi.fn(),
}))

vi.mock('@/lib/table', () => ({ getTableById: mockGetTableById }))
vi.mock('@/lib/table/orchestration', () => ({ performRestoreTable: mockPerformRestoreTable }))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { POST } from '@/app/api/table/[tableId]/restore/route'

const TABLE = {
  id: 'tbl_1',
  name: 'People',
  workspaceId: 'workspace-1',
} as unknown as TableDefinition

function makeRequest(tableId = 'tbl_1') {
  const request = new NextRequest(`http://localhost:3000/api/table/${tableId}/restore`, {
    method: 'POST',
  })
  return POST(request, { params: Promise.resolve({ tableId }) })
}

describe('POST /api/table/[tableId]/restore', () => {
  beforeEach(() => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetTableById.mockResolvedValue(TABLE)
  })

  it('returns 403 without write permission', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')

    expect((await makeRequest()).status).toBe(403)
    expect(mockPerformRestoreTable).not.toHaveBeenCalled()
  })
})
