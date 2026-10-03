import { createTableDefinition, hybridAuthMockFns } from '@sim/testing'
import {
  tableRouteUtilsMock,
  tableRouteUtilsMockFns,
} from '@sim/testing/mocks/table-route-utils.mock'
import {
  tableRowsServiceMock,
  tableRowsServiceMockFns,
} from '@sim/testing/mocks/table-rows-service.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/table/utils', () => tableRouteUtilsMock)
vi.mock('@/lib/table/rows/service', () => tableRowsServiceMock)

import { GET } from '@/app/api/table/[tableId]/rows/find/route'

const mockCheckAccess = tableRouteUtilsMockFns.mockCheckAccess
const mockTableFilterError = tableRouteUtilsMockFns.mockTableFilterError
const mockFindRowMatches = tableRowsServiceMockFns.mockFindRowMatches

function callGet(
  query: Record<string, string>,
  { tableId }: { tableId: string } = { tableId: 'tbl_1' }
) {
  const params = new URLSearchParams(query)
  const req = new NextRequest(`http://localhost:3000/api/table/${tableId}/rows/find?${params}`, {
    method: 'GET',
  })
  return GET(req, { params: Promise.resolve({ tableId }) })
}

describe('GET /api/table/[tableId]/rows/find', () => {
  beforeEach(() => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckAccess.mockResolvedValue({
      ok: true,
      table: createTableDefinition({
        columns: [{ name: 'name', type: 'string' }],
        maxRows: 100,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      }),
    })
    mockTableFilterError.mockReturnValue(null)
    mockFindRowMatches.mockResolvedValue({
      matches: [{ ordinal: 4, rowId: 'row_4', column: 'name' }],
      truncated: false,
    })
  })

  it('returns 400 on a workspace mismatch', async () => {
    const res = await callGet({ workspaceId: 'other-ws', q: 'foo' })
    expect(res.status).toBe(400)
    expect(mockFindRowMatches).not.toHaveBeenCalled()
  })
})
