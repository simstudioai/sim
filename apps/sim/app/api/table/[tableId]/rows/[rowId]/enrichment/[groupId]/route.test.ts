/**
 * The enrichment-detail surface after moving onto the shared internal route
 * builder. It previously queried the database from the adapter; the assertions
 * below are the same wire outcomes, now with the use case as the seam.
 */

import { tableApiMock, tableApiMockFns } from '@sim/testing/mocks/table-api.mock'
import {
  tableApplicationRowsMock,
  tableApplicationRowsMockFns,
} from '@sim/testing/mocks/table-application-rows.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: { readDetail: vi.fn(), authenticate: vi.fn() },
}))

vi.mock('@/lib/table/application/rows', () => tableApplicationRowsMock)

vi.mock('@/lib/table/api', () => tableApiMock)

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { GET } from '@/app/api/table/[tableId]/rows/[rowId]/enrichment/[groupId]/route'

const { mockReadTableRowEnrichmentDetail } = tableApplicationRowsMockFns
const { mockAuthenticate } = tableApiMockFns

const TABLE = { id: 'tbl_1', workspaceId: 'workspace-1', schema: { columns: [] } }
const DETAIL = { providers: [{ id: 'clearbit', status: 'hit' }], costUsd: 0.01 }

function routeContext() {
  return {
    params: Promise.resolve({ tableId: 'tbl_1', rowId: 'row_1', groupId: 'grp_1' }),
  }
}

function request() {
  return new NextRequest('http://localhost/api/table/tbl_1/rows/row_1/enrichment/grp_1', {
    method: 'GET',
  })
}

beforeEach(() => {
  mockAuthenticate.mockResolvedValue({
    kind: 'session',
    userId: 'user-1',
    sessionId: 'session-1',
  })
  mockReadTableRowEnrichmentDetail.mockResolvedValue({ table: TABLE, detail: DETAIL })
})

describe('GET /api/table/[tableId]/rows/[rowId]/enrichment/[groupId]', () => {
  it('conceals a cross-tenant table rather than confirming it exists', async () => {
    mockReadTableRowEnrichmentDetail.mockRejectedValue(new NoWorkspaceAccessError())

    const response = await GET(request(), routeContext())

    expect(response.status).toBe(404)
  })
})
