/**
 * @vitest-environment node
 */
import { hybridAuthMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckAccess, mockUpdateTableMetadata } = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockUpdateTableMetadata: vi.fn(),
}))

vi.mock('@/lib/table', () => ({
  updateTableMetadata: mockUpdateTableMetadata,
}))

vi.mock('@/app/api/table/utils', () => ({
  accessError: (result: { status: number }) => new Response('denied', { status: result.status }),
  checkAccess: mockCheckAccess,
}))

import { PUT } from '@/app/api/table/[tableId]/metadata/route'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

describe('PUT /api/table/[tableId]/metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
  })

  it('rejects synthetic Memory metadata writes through shared access', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 423 })
    const tableId = `system_memory_${WORKSPACE_ID}`
    const response = await PUT(
      new NextRequest(`http://localhost/api/table/${tableId}/metadata`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          metadata: { columnWidths: { transcript: 320 } },
        }),
      }),
      { params: Promise.resolve({ tableId }) }
    )

    expect(response.status).toBe(423)
    expect(mockCheckAccess).toHaveBeenCalledWith(tableId, 'user-1', 'write')
    expect(mockUpdateTableMetadata).not.toHaveBeenCalled()
  })
})
