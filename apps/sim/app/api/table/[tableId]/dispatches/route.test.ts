/**
 * @vitest-environment node
 */
import { hybridAuthMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'

const { mockCheckAccess, mockListActiveDispatches, mockCountRunningCells } = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockListActiveDispatches: vi.fn(),
  mockCountRunningCells: vi.fn(),
}))

vi.mock('@/lib/table/dispatcher', () => ({
  listActiveDispatches: mockListActiveDispatches,
  countRunningCells: mockCountRunningCells,
}))
vi.mock('@/app/api/table/utils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    checkAccess: mockCheckAccess,
    accessError: (result: { status: number }) =>
      NextResponse.json({ error: 'denied' }, { status: result.status }),
  }
})

import { GET } from '@/app/api/table/[tableId]/dispatches/route'

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

function makeRequest(tableId = 'tbl_1') {
  const req = new NextRequest(`http://localhost:3000/api/table/${tableId}/dispatches`)
  return GET(req, { params: Promise.resolve({ tableId }) })
}

function buildDispatchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dispatch-1',
    tableId: 'tbl_1',
    workspaceId: 'workspace-1',
    requestId: 'req-1',
    mode: 'all',
    scope: { groupIds: ['group-1'] },
    status: 'dispatching',
    cursor: 4,
    limit: null,
    isManualRun: true,
    processedCount: 5,
    ...overrides,
  }
}

describe('GET /api/table/[tableId]/dispatches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable() })
    mockListActiveDispatches.mockResolvedValue([])
    mockCountRunningCells.mockResolvedValue({})
  })

  it('returns dispatches and the per-row running map, without a total field', async () => {
    mockListActiveDispatches.mockResolvedValue([buildDispatchRow()])
    mockCountRunningCells.mockResolvedValue({ 'row-1': 2, 'row-2': 1 })

    const response = await makeRequest()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data.dispatches).toEqual([
      {
        id: 'dispatch-1',
        status: 'dispatching',
        mode: 'all',
        isManualRun: true,
        cursor: 4,
        scope: { groupIds: ['group-1'] },
      },
    ])
    expect(data.data.runningByRowId).toEqual({ 'row-1': 2, 'row-2': 1 })
    expect(data.data).not.toHaveProperty('runningCellCount')
  })

  it('includes unclaimed pre-stamps only while a dispatch is active', async () => {
    mockListActiveDispatches.mockResolvedValue([buildDispatchRow()])
    await makeRequest()
    expect(mockCountRunningCells).toHaveBeenCalledWith('tbl_1', {
      includeUnclaimedPreStamps: true,
    })

    mockListActiveDispatches.mockResolvedValue([])
    await makeRequest()
    expect(mockCountRunningCells).toHaveBeenLastCalledWith('tbl_1', {
      includeUnclaimedPreStamps: false,
    })
  })

  it('returns 401 when unauthenticated', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({ success: false })
    const response = await makeRequest()
    expect(response.status).toBe(401)
    expect(mockListActiveDispatches).not.toHaveBeenCalled()
  })
})
