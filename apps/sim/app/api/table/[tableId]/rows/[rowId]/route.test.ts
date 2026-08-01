/**
 * @vitest-environment node
 */
import { hybridAuthMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckAccess, mockDeleteRow, mockUpdateRow } = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockDeleteRow: vi.fn(),
  mockUpdateRow: vi.fn(),
}))

vi.mock('@/lib/table', () => ({
  deleteRow: mockDeleteRow,
  updateRow: mockUpdateRow,
}))

vi.mock('@/app/api/table/utils', () => ({
  accessError: (result: { status: number }) => new Response('denied', { status: result.status }),
  checkAccess: mockCheckAccess,
  rootErrorMessage: vi.fn(),
  rowWriteErrorResponse: vi.fn(),
  tableLockErrorResponse: vi.fn(),
}))

import { DELETE, PATCH } from '@/app/api/table/[tableId]/rows/[rowId]/route'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

describe('PATCH /api/table/[tableId]/rows/[rowId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
  })

  it('rejects synthetic Memory value writes with a read-only explanation', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 423 })
    const tableId = `system_memory_${WORKSPACE_ID}`
    const response = await PATCH(
      new NextRequest(`http://localhost/api/table/${tableId}/rows/memory-1`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: WORKSPACE_ID, data: { transcript: [] } }),
      }),
      { params: Promise.resolve({ tableId, rowId: 'memory-1' }) }
    )

    expect(response.status).toBe(423)
    expect(mockCheckAccess).toHaveBeenCalledWith(tableId, 'user-1', 'write')
    expect(mockUpdateRow).not.toHaveBeenCalled()
  })

  it('rejects synthetic Memory row deletion through shared access', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 423 })
    const tableId = `system_memory_${WORKSPACE_ID}`
    const response = await DELETE(
      new NextRequest(`http://localhost/api/table/${tableId}/rows/memory-1`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: WORKSPACE_ID }),
      }),
      { params: Promise.resolve({ tableId, rowId: 'memory-1' }) }
    )

    expect(response.status).toBe(423)
    expect(mockCheckAccess).toHaveBeenCalledWith(tableId, 'user-1', 'write')
    expect(mockDeleteRow).not.toHaveBeenCalled()
  })
})
