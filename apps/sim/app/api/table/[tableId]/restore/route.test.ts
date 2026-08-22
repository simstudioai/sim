/**
 * @vitest-environment node
 */
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
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetTableById.mockResolvedValue(TABLE)
  })

  it('restores the table and returns it', async () => {
    mockPerformRestoreTable.mockResolvedValue({ success: true, table: TABLE })

    const response = await makeRequest()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data.table.id).toBe('tbl_1')
  })

  it('keeps an unclassified failure out of the response body', async () => {
    // `performRestoreTable` puts the raw fault text on `error` for the logs — for a driver
    // fault that is the failed SQL and its bound parameters. A caller can do nothing with it
    // and must never see it, so an unclassified failure renders the route's own wording.
    mockPerformRestoreTable.mockResolvedValue({
      success: false,
      errorCode: 'internal',
      error:
        'update "user_table_definitions" set "archived_at" = $1 where "id" = $2 -- params: [null, "tbl_1"]',
    })

    const response = await makeRequest()
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to restore table')
  })

  it('keeps the message of a classified failure the caller can act on', async () => {
    mockPerformRestoreTable.mockResolvedValue({
      success: false,
      errorCode: 'conflict',
      error: 'A table named "People" already exists',
    })

    const response = await makeRequest()
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('A table named "People" already exists')
  })

  it('maps a missing table to 404', async () => {
    mockPerformRestoreTable.mockResolvedValue({
      success: false,
      errorCode: 'not_found',
      error: 'Table not found',
    })

    const response = await makeRequest()

    expect(response.status).toBe(404)
  })

  it('returns 401 when unauthenticated', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({ success: false })

    expect((await makeRequest()).status).toBe(401)
    expect(mockPerformRestoreTable).not.toHaveBeenCalled()
  })

  it('returns 403 without write permission', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')

    expect((await makeRequest()).status).toBe(403)
    expect(mockPerformRestoreTable).not.toHaveBeenCalled()
  })
})
