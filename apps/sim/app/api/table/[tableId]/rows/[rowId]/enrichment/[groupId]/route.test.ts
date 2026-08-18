/**
 * @vitest-environment node
 *
 * The enrichment-detail surface after moving onto the shared internal route
 * builder. It previously queried the database from the adapter; the assertions
 * below are the same wire outcomes, now with the use case as the seam.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: { readDetail: vi.fn(), authenticate: vi.fn() },
}))

vi.mock('@/lib/table/application/rows', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/table/application/rows')>()
  return {
    ...actual,
    readTableRowEnrichmentDetail: {
      operation: { id: 'tables.rows.read' },
      execute: mocks.readDetail,
    },
  }
})

vi.mock('@/lib/table/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/table/api')>()
  return { ...actual, internalTableSessionOrExecutorAuth: { authenticate: mocks.authenticate } }
})

import { InternalUnauthenticatedError } from '@/lib/api/server/routes'
import { NoWorkspaceAccessError } from '@/lib/core/application'
import { GET } from '@/app/api/table/[tableId]/rows/[rowId]/enrichment/[groupId]/route'

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
  vi.clearAllMocks()
  mocks.authenticate.mockResolvedValue({
    kind: 'session',
    userId: 'user-1',
    sessionId: 'session-1',
  })
  mocks.readDetail.mockResolvedValue({ table: TABLE, detail: DETAIL })
})

describe('GET /api/table/[tableId]/rows/[rowId]/enrichment/[groupId]', () => {
  it('returns 401 when the caller is not authenticated', async () => {
    mocks.authenticate.mockRejectedValue(new InternalUnauthenticatedError())

    const response = await GET(request(), routeContext())

    expect(response.status).toBe(401)
    expect(mocks.readDetail).not.toHaveBeenCalled()
  })

  it('returns the enrichment detail', async () => {
    const response = await GET(request(), routeContext())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, data: { detail: DETAIL } })
  })

  it('returns null when there is no recorded run', async () => {
    mocks.readDetail.mockResolvedValue({ table: TABLE, detail: null })

    const body = await (await GET(request(), routeContext())).json()

    expect(body).toEqual({ success: true, data: { detail: null } })
  })

  it('passes the row and group through to the use case', async () => {
    await GET(request(), routeContext())

    expect(mocks.readDetail.mock.calls[0][0].input).toMatchObject({
      tableId: 'tbl_1',
      rowId: 'row_1',
      groupId: 'grp_1',
    })
  })

  it('conceals a cross-tenant table rather than confirming it exists', async () => {
    mocks.readDetail.mockRejectedValue(new NoWorkspaceAccessError())

    const response = await GET(request(), routeContext())

    expect(response.status).toBe(404)
  })
})
