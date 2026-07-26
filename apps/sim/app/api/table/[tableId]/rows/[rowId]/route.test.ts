/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuth, mockCheckAccess, mockUpdateRow } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCheckAccess: vi.fn(),
  mockUpdateRow: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockAuth,
}))

vi.mock('@/lib/table', () => ({
  updateRow: mockUpdateRow,
  deleteRow: vi.fn(),
}))

vi.mock('@/app/api/table/row-wire', () => ({
  rowWireTranslators: () => ({
    dataIn: (data: unknown) => data,
    dataOut: (data: unknown) => data,
  }),
}))

vi.mock('@/app/api/table/utils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    checkAccess: mockCheckAccess,
    accessError: (result: { status: number }) =>
      NextResponse.json({ error: 'denied' }, { status: result.status }),
    rowWriteErrorResponse: () => undefined,
    tableLockErrorResponse: () => undefined,
    rootErrorMessage: (error: unknown) => (error instanceof Error ? error.message : ''),
  }
})

import { PATCH } from '@/app/api/table/[tableId]/rows/[rowId]/route'

const TABLE = {
  id: 'tbl_1',
  name: 'People',
  workspaceId: 'ws-1',
  schema: { columns: [{ id: 'col_1', name: 'name', type: 'text' }] },
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/table/tbl_1/rows/row_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/table/[tableId]/rows/[rowId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ success: true, userId: 'user-1', authType: 'session' })
    mockCheckAccess.mockResolvedValue({ ok: true, table: TABLE })
    mockUpdateRow.mockResolvedValue({
      id: 'row_1',
      data: { col_1: 'Bob' },
      position: 0,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:01.000Z'),
    })
  })

  it("writes only the edited cells (dataWriteMode: 'patch') so a concurrent edit to another cell of the same row is not clobbered", async () => {
    const res = await PATCH(patchRequest({ workspaceId: 'ws-1', data: { col_1: 'Bob' } }), {
      params: Promise.resolve({ tableId: 'tbl_1', rowId: 'row_1' }),
    })

    expect(res.status).toBe(200)
    expect(mockUpdateRow).toHaveBeenCalledTimes(1)
    // The 4th argument is the options object; it must opt into cell-atomic JSONB patch mode.
    expect(mockUpdateRow.mock.calls[0][3]).toEqual({ dataWriteMode: 'patch' })
  })
})
